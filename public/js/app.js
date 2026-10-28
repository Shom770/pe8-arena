import { Room } from './room.js';
import { Grader } from './grader.js';
import { SupabaseTransport, LocalTransport } from './transport.js';

const $ = (sel, root = document) => root.querySelector(sel);
const cfg = window.ARENA_CONFIG || {};
const params = new URLSearchParams(location.search);
const useLocal = params.has('local') || !cfg.supabaseUrl || !cfg.supabaseAnonKey;

let problems = [];
let room = null;
let lanes = [];
let lastRaceId = null;
let lastRendered = { phase: null };

// ---------- helpers ----------
function show(el, on = true) {
  el.classList.toggle('hidden', !on);
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtTime(ms) {
  if (ms == null || ms < 0) ms = 0;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const t = Math.floor((ms % 1000) / 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${t}`;
}
function roomCode() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 5 }, () => a[Math.floor(Math.random() * a.length)]).join('');
}
function myId() {
  try {
    let id = sessionStorage.getItem('arena-id');
    if (!id) {
      id = Math.random().toString(36).slice(2, 12);
      sessionStorage.setItem('arena-id', id);
    }
    return id;
  } catch {
    return Math.random().toString(36).slice(2, 12);
  }
}
function savedName() {
  try { return localStorage.getItem('arena-name') || ''; } catch { return ''; }
}
function saveName(n) {
  try { localStorage.setItem('arena-name', n); } catch {}
}

// ---------- home ----------
async function boot() {
  const banner = $('#mode-banner');
  if (useLocal) {
    banner.innerHTML = cfg.supabaseUrl
      ? 'Local mode: rooms only connect tabs in this browser.'
      : 'Local mode: no Supabase project is configured, so rooms only connect tabs in this browser. See the README to go online.';
    show(banner);
  }
  $('#name').value = params.get('name') || savedName();
  const res = await fetch('problems.json');
  problems = (await res.json()).problems;

  const code = (params.get('room') || '').toUpperCase();
  if (code) $('#join-code').value = code;

  $('#create').onclick = () => enter(roomCode());
  $('#join').onclick = () => {
    const c = $('#join-code').value.trim().toUpperCase();
    if (!c) return homeError('Enter a room code.');
    enter(c);
  };
  $('#join-code').addEventListener('keydown', (e) => e.key === 'Enter' && $('#join').click());
  if (code && $('#name').value.trim()) enter(code);
}

function homeError(msg) {
  const el = $('#home-error');
  el.textContent = msg;
  show(el, !!msg);
}

async function enter(code) {
  const name = $('#name').value.trim();
  if (!name) return homeError('Enter your name first.');
  homeError('');
  saveName(name);
  const me = { id: myId(), name, joinedAt: Date.now() };
  const transport = useLocal
    ? new LocalTransport({ room: code, me })
    : new SupabaseTransport({ url: cfg.supabaseUrl, anonKey: cfg.supabaseAnonKey, room: code, me });
  const grader = new Grader({ stressN: cfg.stressN, timeoutMs: (cfg.gradeTimeoutSeconds || 15) * 1000 });
  room = new Room({ transport, me, problems, grader });

  const url = new URL(location.href);
  url.searchParams.set('room', code);
  url.searchParams.delete('name');
  history.replaceState(null, '', url);

  $('#create').disabled = $('#join').disabled = true;
  try {
    await room.join();
  } catch (err) {
    $('#create').disabled = $('#join').disabled = false;
    return homeError(`Couldn't connect: ${err.message || err}`);
  }

  show($('#home'), false);
  show($('#room'));
  show($('#room-meta'));
  $('#room-code').textContent = code;
  $('#copy-link').onclick = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      $('#copy-link').textContent = 'Copied';
      setTimeout(() => ($('#copy-link').textContent = 'Copy invite link'), 1500);
    } catch {
      prompt('Invite link', location.href);
    }
  };

  buildLanes();
  fillProblemSelect();
  room.on('change', render);
  room.on('race', onNewRace);
  room.on('code', onRemoteCode);
  render();
  setInterval(tick, 100);
  // Load the OCaml runtime in the background so the first grade is quick.
  grader.warm().catch(() => {});
}

// ---------- lanes / editors ----------
function buildLanes() {
  const tpl = $('#lane-template');
  lanes = [0, 1].map((i) => {
    const el = $(`.lane[data-lane="${i}"]`);
    el.appendChild(tpl.content.cloneNode(true));
    const cm = CodeMirror($('.editor', el), {
      mode: 'text/x-ocaml',
      lineNumbers: true,
      matchBrackets: true,
      indentUnit: 2,
      tabSize: 2,
      readOnly: true,
      extraKeys: {
        Tab: (c) => c.replaceSelection('  '),
        'Ctrl-Enter': () => runTests(),
        'Cmd-Enter': () => runTests(),
      },
    });
    cm.on('change', (c, change) => {
      if (change.origin === 'setValue') return;
      if (room && room.mySlot === i) room.setMyCode(c.getValue());
    });
    $('.run', el).onclick = runTests;
    return { el, cm };
  });
}

function fillProblemSelect() {
  const sel = $('#problem-select');
  sel.innerHTML =
    `<option value="random">Random problem</option>` +
    problems.map((p) => `<option value="${p.id}">Q${p.id}. ${esc(p.title)}</option>`).join('');
  $('#start').onclick = () => {
    let id = sel.value === 'random' ? problems[Math.floor(Math.random() * problems.length)].id : Number(sel.value);
    room.hostStart(id);
  };
}

function onNewRace() {
  const p = room.problem;
  if (!p) return;
  lastRaceId = room.state.raceId;
  $('#problem-title').textContent = `Q${p.id}. ${p.title}  ·  ${p.filename}`;
  $('#problem-text').textContent = p.prompt;
  $('#problem-panel').open = true;
  lanes.forEach(({ cm }, i) => {
    cm.setValue(room.codes[i]);
    cm.clearHistory();
  });
}

function onRemoteCode(slot) {
  const { cm } = lanes[slot];
  if (cm.getValue() === room.codes[slot]) return;
  const scroll = cm.getScrollInfo();
  const cursor = cm.getCursor();
  cm.setValue(room.codes[slot]);
  cm.setCursor(cursor);
  cm.scrollTo(scroll.left, scroll.top);
}

function runTests() {
  if (!room || room.mySlot < 0) return;
  if (room.state.phase !== 'racing' || Date.now() < room.localStart) return;
  room.submit();
  render();
}

// ---------- render ----------
function render() {
  if (!room) return;
  const s = room.state;
  const mySlot = room.mySlot;
  const inRace = s.phase === 'countdown' || s.phase === 'racing' || (s.phase === 'finished' && s.raceId);

  if (s.raceId && s.raceId !== lastRaceId && room.problem) onNewRace();

  $('#member-count').textContent = `${room.members.length} here`;
  show($('#lobby'), !inRace || s.phase === 'lobby');
  show($('#race'), inRace && s.phase !== 'lobby');
  show($('#clock'), s.phase === 'racing' || s.phase === 'finished');

  renderLobby(s, mySlot);
  if (inRace && s.phase !== 'lobby') renderRace(s, mySlot);
  lastRendered.phase = s.phase;
}

function renderLobby(s, mySlot) {
  [0, 1].forEach((i) => {
    const slotEl = $(`.slot[data-slot="${i}"]`);
    const id = s.slots[i];
    $('.slot-name', slotEl).innerHTML = id
      ? `${esc(s.names[i] || room.nameOf(id) || 'Player')}${id === room.me.id ? ' <span class="you">you</span>' : ''}`
      : '<span class="muted">Open</span>';
    slotEl.classList.toggle('filled', !!id);
    const actions = $('.slot-actions', slotEl);
    let html = '';
    if (!id) html = `<button class="btn" data-claim="${i}">${mySlot >= 0 ? 'Switch here' : 'Play'}</button>`;
    else if (id === room.me.id) html = `<button class="btn ghost" data-release>Spectate instead</button>`;
    else if (room.isHost) html = `<button class="btn ghost small" data-kick="${i}">Remove</button>`;
    actions.innerHTML = html;
  });
  $('#room').querySelectorAll('[data-claim]').forEach((b) => (b.onclick = () => room.claim(Number(b.dataset.claim))));
  $('#room').querySelectorAll('[data-release]').forEach((b) => (b.onclick = () => room.release()));
  $('#room').querySelectorAll('[data-kick]').forEach((b) => (b.onclick = () => room.hostClearSlot(Number(b.dataset.kick))));

  show($('#host-controls'), room.isHost);
  const ready = s.slots[0] && s.slots[1];
  $('#start').disabled = !ready;
  $('#start-hint').textContent = ready ? 'Both players are in. Start when ready.' : 'Waiting for two players to take a slot.';
  $('#lobby-note').textContent = room.isHost
    ? 'You are the host. Share the invite link, then pick a problem.'
    : `${esc(room.nameOf(room.hostId) || 'The host')} picks the problem and starts the race.`;

  $('#member-list').innerHTML = [...room.members]
    .sort((a, b) => a.joinedAt - b.joinedAt)
    .map((m) => {
      const slot = s.slots.indexOf(m.id);
      const role = slot >= 0 ? `Player ${slot + 1}` : 'Spectator';
      return `<li>${esc(m.name)}${m.id === room.hostId ? ' <span class="pill">host</span>' : ''}${m.id === room.me.id ? ' <span class="you">you</span>' : ''} <span class="muted">· ${role}</span></li>`;
    })
    .join('');
}

function renderRace(s, mySlot) {
  const iAmPlayer = mySlot >= 0;
  const locked = s.phase !== 'racing' || Date.now() < room.localStart;

  [0, 1].forEach((i) => {
    const { el, cm } = lanes[i];
    const mine = i === mySlot;
    const hideCode = iAmPlayer && !mine && s.phase !== 'finished';
    el.classList.toggle('mine', mine);
    el.classList.toggle('winner', !!(s.winner && s.winner.slot === i));
    $('.lane-tag', el).textContent = `Player ${i + 1}${mine ? ' · you' : ''}`;
    $('.lane-name', el).textContent = s.names[i] || 'Left the room';

    const r = s.results[i];
    const grading = s.grading[i] != null;
    let status = '<span class="pill">coding</span>';
    if (s.winner && s.winner.slot === i) status = '<span class="pill win">winner</span>';
    else if (grading) status = '<span class="pill busy">running tests…</span>';
    else if (r && !r.compiled) status = '<span class="pill bad">compile error</span>';
    else if (r) status = `<span class="pill ${r.allPassed ? 'win' : ''}">${r.passed}/${r.total} passing</span>`;
    else if (Date.now() - room.codeSeenAt[i] < 1500 && !mine) status = '<span class="pill">typing…</span>';
    $('.lane-status', el).innerHTML = status;

    const pct = r && r.total ? Math.round((100 * r.passed) / r.total) : 0;
    $('.progress-fill', el).style.width = `${pct}%`;

    show($('.editor', el), !hideCode);
    show($('.hidden-code', el), hideCode);
    const editable = mine && !locked;
    if (cm.getOption('readOnly') !== (editable ? false : 'nocursor')) cm.setOption('readOnly', editable ? false : 'nocursor');
    if (!hideCode) setTimeout(() => cm.refresh(), 0);

    show($('.lane-actions', el), mine && s.phase === 'racing');
    const runBtn = $('.run', el);
    runBtn.disabled = locked || grading;
    runBtn.textContent = grading ? 'Running…' : 'Run tests';

    const err = $('.lane-error', el);
    const showDetail = !hideCode || s.phase === 'finished';
    err.textContent = r && r.error && showDetail ? r.error : '';
    show(err, !!(r && r.error && showDetail));
    $('.tests', el).innerHTML = r && showDetail
      ? r.tests.map((t) => `<li class="${t.ok ? 'ok' : 'no'}"><span>${t.ok ? '✓' : '✗'}</span> ${esc(t.name)}${t.detail ? ` <span class="muted">· ${esc(t.detail)}</span>` : ''}</li>`).join('')
      : '';
  });

  const banner = $('#result-banner');
  if (s.phase === 'finished' && s.winner) {
    const w = s.winner;
    const you = w.id === room.me.id;
    const time = w.elapsedMs != null ? ` in ${fmtTime(w.elapsedMs)}` : '';
    banner.innerHTML = `<div><strong>${esc(w.name || 'Player ' + (w.slot + 1))}</strong> ${w.forfeit ? 'wins: their opponent left' : `wins${time}`}${you ? ' · nice work!' : ''}</div>` +
      (room.isHost ? '<button id="rematch" class="btn primary">Back to lobby</button>' : '<span class="muted">Waiting for the host…</span>');
    show(banner);
    const b = $('#rematch');
    if (b) b.onclick = () => room.hostBackToLobby();
  } else {
    show(banner, false);
  }
}

function tick() {
  if (!room) return;
  const s = room.state;
  const cd = $('#countdown');
  if (s.phase === 'countdown' || (s.phase === 'racing' && Date.now() < room.localStart)) {
    const left = Math.max(0, room.localStart - Date.now());
    cd.textContent = left > 0 ? Math.ceil(left / 1000) : 'Go!';
    show(cd);
  } else if (!cd.classList.contains('hidden')) {
    show(cd, false);
    render();
  }
  if (s.phase === 'racing' && room.localStart) {
    $('#clock').textContent = fmtTime(Date.now() - room.localStart);
  } else if (s.phase === 'finished' && s.winner && s.winner.elapsedMs != null) {
    $('#clock').textContent = fmtTime(s.winner.elapsedMs);
  }
  // Refresh "typing…" indicators.
  if (s.phase === 'racing') {
    [0, 1].forEach((i) => {
      if (i === room.mySlot || s.results[i] || s.grading[i] != null) return;
      const typing = Date.now() - room.codeSeenAt[i] < 1500;
      const el = $(`.lane[data-lane="${i}"] .lane-status`);
      const want = typing ? '<span class="pill">typing…</span>' : '<span class="pill">coding</span>';
      if (el && el.innerHTML !== want) el.innerHTML = want;
    });
  }
}

boot();
