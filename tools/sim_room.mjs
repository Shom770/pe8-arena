// Simulates a room with several clients over an in-memory transport, grading with
// the real OCaml toplevel, to exercise the protocol in public/js/room.js.
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Room } from '../public/js/room.js';
import { buildProgram, parseResults } from '../public/js/program.js';

const problems = JSON.parse(fs.readFileSync('problems.json', 'utf8')).problems;
const refs = JSON.parse(execFileSync('python3', ['-c',
  'import json,sys; sys.path.insert(0,"tools"); from reference import REF; print(json.dumps(REF))']).toString());
const patch = (src) => src.replace(/^( *)failwith "([^"]*)"/gm, (all, ind, msg) => {
  if (!(msg in refs)) return all;
  const b = refs[msg].split('\n');
  return [ind + '(' + b[0], ...b.slice(1).map((l) => ind + l)].join('\n') + ')';
});

class OcamlGrader {
  constructor() { this.calls = 0; }
  grade(problem, code) {
    this.calls++;
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sim-')), 'p.ml');
    fs.writeFileSync(f, buildProgram(problem, code, { stressN: 1000 }));
    return new Promise((resolve) => execFile('ocaml', [f], { timeout: 60000 }, (err, stdout, stderr) => {
      const r = parseResults(stdout, err && !/SUMMARY/.test(stdout) ? [stderr] : []);
      if (!r.compiled) r.error = stderr;
      resolve(r);
    }));
  }
}

class Hub {
  constructor() { this.clients = new Map(); }
  presence() {
    const members = [...this.clients.values()].map((c) => c.me);
    for (const c of this.clients.values()) c.presenceHandlers.forEach((fn) => fn(members));
  }
}
class FakeTransport {
  constructor(hub, me) { this.hub = hub; this.me = me; this.handlers = {}; this.presenceHandlers = []; this.sent = 0; }
  async connect() { this.hub.clients.set(this.me.id, this); setTimeout(() => this.hub.presence(), 5); }
  send(event, payload) {
    this.sent++;
    const data = JSON.parse(JSON.stringify(payload));
    for (const c of this.hub.clients.values()) {
      if (c === this) continue;
      setTimeout(() => (c.handlers[event] || []).forEach((fn) => fn(data)), 1 + Math.random() * 15);
    }
  }
  on(e, fn) { (this.handlers[e] ||= []).push(fn); }
  onPresence(fn) { this.presenceHandlers.push(fn); }
  async leave() { this.hub.clients.delete(this.me.id); setTimeout(() => this.hub.presence(), 5); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(cond, what, ms = 30000) {
  const t = Date.now();
  while (!cond()) { if (Date.now() - t > ms) throw new Error('timeout waiting for ' + what); await sleep(20); }
}
let failures = 0;
function check(cond, msg) { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failures++; }

const hub = new Hub();
let clock = 1000;
async function client(name) {
  const me = { id: name.toLowerCase(), name, joinedAt: clock++ };
  const room = new Room({ transport: new FakeTransport(hub, me), me, problems, grader: new OcamlGrader() });
  await room.join();
  await sleep(30);
  return room;
}

console.log('joining');
const H = await client('Host');
const A = await client('Alice');
const B = await client('Bob');
const S = await client('Sam');
await sleep(100);
const all = [H, A, B, S];
check(all.every((r) => r.hostId === 'host'), 'everyone agrees Host is the host');

console.log('claiming slots');
A.claim(0); B.claim(1);
await until(() => all.every((r) => r.state.slots[0] === 'alice' && r.state.slots[1] === 'bob'), 'slots');
S.claim(1);
await sleep(200);
check(all.every((r) => r.state.slots[1] === 'bob'), 'Alice is player 1 and Bob is player 2 everywhere; Sam cannot take a filled slot');

console.log('race 1: Q46 reverse');
const q46 = problems.find((p) => p.id === 46);
H.hostStart(46);
await until(() => all.every((r) => r.state.phase === 'countdown'), 'countdown');
check(A.codes[0] === q46.starter && S.codes[1] === q46.starter, 'everyone starts from the starter code');
check(!A.submit(), 'submitting during the countdown is ignored');
await until(() => all.every((r) => r.state.phase === 'racing'), 'racing', 6000);
A.setMyCode(q46.starter + '\n(* thinking *)\n');
const solved = patch(q46.starter);
B.setMyCode(solved);
await sleep(400);
check(S.codes[0].includes('thinking') && S.codes[1] === solved, 'spectator sees both players\' live code');
check(H.codes[1] === solved, 'host sees live code too');
A.submit();
await until(() => H.state.results[0], 'Alice graded');
await until(() => S.state.results[0], 'Alice result reaches spectator');
check(!S.state.results[0].allPassed && S.state.phase === 'racing', `Alice's starter fails (${S.state.results[0].passed}/${S.state.results[0].total}); race continues`);
B.submit();
await until(() => all.every((r) => r.state.phase === 'finished'), 'finished');
check(all.every((r) => r.state.winner && r.state.winner.id === 'bob' && !r.state.winner.forfeit), 'Bob wins on every screen');
check(S.state.results[1].allPassed && S.state.results[1].tests.length === S.state.results[1].total, `spectator sees Bob's verified ${S.state.results[1].passed}/${S.state.results[1].total}`);
check(A.grader.calls === 0 && B.grader.calls === 0 && S.grader.calls === 0, 'only the host graded (players cannot self-report)');
A.submit();
await sleep(200);
check(H.grader.calls === 2, 'submissions after the race ends are ignored');

console.log('late joiner');
const L = await client('Lee');
await until(() => L.state.phase === 'finished' && L.state.winner?.id === 'bob', 'late joiner gets state');
check(true, 'a late joiner receives the current state and winner');

console.log('race 2: host leaves mid-race');
H.hostBackToLobby();
await until(() => all.every((r) => r.state.phase === 'lobby'), 'lobby');
H.hostStart(1);
await until(() => [A, B, S].every((r) => r.state.phase === 'racing'), 'racing 2', 6000);
await H.leave();
const rest = [A, B, S, L];
await until(() => rest.every((r) => r.hostId === 'alice'), 'host handoff');
check(true, 'Alice (earliest remaining) becomes host');
const q1 = problems.find((p) => p.id === 1);
B.setMyCode(patch(q1.starter));
await sleep(300);
B.submit();
await until(() => rest.every((r) => r.state.phase === 'finished'), 'finished 2');
check(rest.every((r) => r.state.winner.id === 'bob'), 'new host graded Bob\'s submission and declared him the winner');
check(A.grader.calls === 1, 'grading moved to the new host');

console.log('race 3: forfeit');
A.hostBackToLobby();
await until(() => rest.every((r) => r.state.phase === 'lobby'), 'lobby 3');
A.hostStart(2);
await until(() => rest.every((r) => r.state.phase === 'racing'), 'racing 3', 6000);
await B.leave();
const rest2 = [A, S, L];
await until(() => rest2.every((r) => r.state.phase === 'finished'), 'forfeit');
check(rest2.every((r) => r.state.winner.id === 'alice' && r.state.winner.forfeit), 'Alice wins by forfeit when Bob leaves');
check(rest2.every((r) => r.state.slots[1] === null), 'Bob\'s slot is freed');

console.log(failures ? `\n${failures} checks failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
