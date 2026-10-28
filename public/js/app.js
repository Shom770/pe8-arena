import { Room } from './room.js';
import { Grader } from './grader.js';
import { SupabaseTransport, LocalTransport } from './transport.js';
import { Booth } from './camera.js';
import { sfx, avatar, playKO, spinMatchup } from './fx.js';
import { ZONES, zoneOf, zoneForRound, pickFromZone } from './zones.js';

const $ = (sel, root = document) => root.querySelector(sel);
const cfg = window.ARENA_CONFIG || {};
const params = new URLSearchParams(location.search);
const useLocal = params.has('local') || !cfg.supabaseUrl || !cfg.supabaseAnonKey;
const CORNERS = ['Red corner', 'Blue corner'];

let problems = [];
let room = null;
let booth = null;
let lanes = [];
let lastRaceId = null;
let lastMatchup = null;
let spinning = false;
let selectKey = null;
let sawRacing = null; // raceId we watched while it was live, so a late joiner doesn't get a KO replay
let koShown = null;
let bellRung = null;

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
function pic(id, name) {
  return avatar(name, room && room.photoOf(id));
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
  const soundBtn = $('#sound');
  soundBtn.textContent = sfx.on ? 'Bell on' : 'Bell off';
  soundBtn.onclick = () => (soundBtn.textContent = sfx.toggle() ? 'Bell on' : 'Bell off');

  booth = new Booth($('#booth'), () => homeError(''));
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
  if (code && $('#name').value.trim() && booth.photo) enter(code);
}

function homeError(msg) {
  const el = $('#home-error');
  el.textContent = msg;
  show(el, !!msg);
}

async function enter(code) {
  const name = $('#name').value.trim();
  if (!booth.photo) return homeError('Take your weigh-in photo first (camera or upload).');
  if (!name) return homeError('Enter your fighter name first.');
  homeError('');
  saveName(name);
  booth.stop();
  const me = { id: myId(), name, joinedAt: Date.now() };
  const transport = useLocal
    ? new LocalTransport({ room: code, me })
    : new SupabaseTransport({ url: cfg.supabaseUrl, anonKey: cfg.supabaseAnonKey, room: code, me });
  const grader = new Grader({ stressN: cfg.stressN, timeoutMs: (cfg.gradeTimeoutSeconds || 15) * 1000 });
  room = new Room({ transport, me, problems, grader, photo: booth.photo });

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
  $('#start').onclick = startRace;
  $('#random-match').onclick = () => room.hostRandomMatch();
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

// The host's problem picker: "next up" climbs the zone ladder, or pick a zone or a problem.
function fillProblemSelect(s) {
  const played = s.played || [];
  const key = `${s.round}|${played.join(',')}`;
  if (key === selectKey) return;
  selectKey = key;
  const sel = $('#problem-select');
  const keep = sel.value && sel.value !== 'next' ? sel.value : 'next';
  const next = zoneForRound(s.round || 0);
  sel.innerHTML =
    `<option value="next">Next up · Zone ${next.n}: ${esc(next.name)} (random)</option>` +
    ZONES.map((z) => {
      const opts = z.ids
        .map((id) => problems.find((p) => p.id === id))
        .filter(Boolean)
        .map((p) => `<option value="${p.id}">${played.includes(p.id) ? '✓ ' : ''}Q${p.id}. ${esc(p.title)}</option>`)
        .join('');
      return `<optgroup label="Zone ${z.n} · ${esc(z.name)} · ${esc(z.blurb)}"><option value="zone:${z.n}">Random from Zone ${z.n}</option>${opts}</optgroup>`;
    }).join('');
  sel.value = keep;
  if (sel.value !== keep) sel.value = 'next';
}

function startRace() {
  const s = room.state;
  const v = $('#problem-select').value;
  let id;
  if (v === 'next') id = pickFromZone(zoneForRound(s.round || 0), s.played);
  else if (v.startsWith('zone:')) id = pickFromZone(ZONES[Number(v.slice(5)) - 1], s.played);
  else id = Number(v);
  $('#problem-select').value = 'next';
  room.hostStart(id);
}

function onNewRace() {
  const p = room.problem;
  if (!p) return;
  lastRaceId = room.state.raceId;
  const z = zoneOf(p.id);
  $('#problem-title').textContent = `Q${p.id}. ${p.title} · ${p.filename}`;
  $('.problem-panel summary .label').textContent = `Zone ${z.n} · ${z.name}`;
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
  if (s.phase === 'racing' || s.phase === 'countdown') sawRacing = s.raceId;

  $('#member-count').textContent = `${room.members.length} in the building`;
  show($('#lobby'), !inRace || s.phase === 'lobby');
  show($('#race'), inRace && s.phase !== 'lobby');
  show($('#clock'), s.phase === 'racing' || s.phase === 'finished');

  renderLobby(s, mySlot);
  if (inRace && s.phase !== 'lobby') renderRace(s, mySlot);
  maybeKnockout(s);
}

function renderLobby(s, mySlot) {
  const matchup = s.matchup || 0;
  if (lastMatchup !== null && matchup === lastMatchup + 1 && !spinning) {
    lastMatchup = matchup;
    runSpin(s);
  }
  lastMatchup = matchup;

  if (!spinning) {
    [0, 1].forEach((i) => {
      const slotEl = $(`.slot[data-slot="${i}"]`);
      const id = s.slots[i];
      const name = s.names[i] || room.nameOf(id) || 'Fighter';
      $('.slot-name', slotEl).innerHTML = id
        ? `${esc(name)}${id === room.me.id ? '<span class="you">you</span>' : ''}`
        : '<span class="muted">Open</span>';
      if (id) $('.slot-photo', slotEl).src = pic(id, name);
      slotEl.classList.toggle('filled', !!id);
    });
  }
  [0, 1].forEach((i) => {
    const slotEl = $(`.slot[data-slot="${i}"]`);
    const id = s.slots[i];
    let html = '';
    if (!id) html = `<button class="btn" data-claim="${i}">${mySlot >= 0 ? 'Switch corners' : 'Take this corner'}</button>`;
    else if (id === room.me.id) html = `<button class="btn ghost small" data-release>Back to ringside</button>`;
    else if (room.isHost) html = `<button class="btn ghost small" data-kick="${i}">Remove</button>`;
    $('.slot-actions', slotEl).innerHTML = html;
  });
  $('#room').querySelectorAll('[data-claim]').forEach((b) => (b.onclick = () => room.claim(Number(b.dataset.claim))));
  $('#room').querySelectorAll('[data-release]').forEach((b) => (b.onclick = () => room.release()));
  $('#room').querySelectorAll('[data-kick]').forEach((b) => (b.onclick = () => room.hostClearSlot(Number(b.dataset.kick))));

  show($('#host-controls'), room.isHost);
  if (room.isHost) fillProblemSelect(s);
  const ready = s.slots[0] && s.slots[1];
  $('#start').disabled = !ready || spinning;
  $('#random-match').disabled = room.members.length < 2 || spinning;
  const next = zoneForRound(s.round || 0);
  $('#start-hint').textContent = ready
    ? `Round ${(s.round || 0) + 1} is a Zone ${next.n} bout (${next.blurb.toLowerCase()}). Bouts climb a zone each round.`
    : room.members.length < 2
      ? 'Waiting for someone to fight. Send the invite link.'
      : 'Need two fighters. Hit Random matchup, or let people take a corner.';
  $('#lobby-note').textContent = room.isHost
    ? ''
    : `${room.nameOf(room.hostId) || 'The host'} is promoting tonight: they set the matchup and ring the bell.`;
  show($('#lobby-note'), !room.isHost);

  $('#member-list').innerHTML = [...room.members]
    .sort((a, b) => a.joinedAt - b.joinedAt)
    .map((m) => {
      const slot = s.slots.indexOf(m.id);
      const role = slot >= 0 ? CORNERS[slot] : 'Ringside';
      return `<li class="${slot >= 0 ? 'p' + slot : ''}"><img src="${esc(pic(m.id, m.name))}" alt="">${esc(m.name)}${m.id === room.hostId ? ' <span class="pill host">host</span>' : ''}${m.id === room.me.id ? '<span class="you">you</span>' : ''} <span class="muted">· ${role}</span></li>`;
    })
    .join('');
}

async function runSpin(s) {
  spinning = true;
  const slotEls = [0, 1].map((i) => $(`.slot[data-slot="${i}"]`));
  slotEls.forEach((el) => el.classList.add('spinning'));
  const members = room.members.map((m) => ({ name: m.name, photo: room.photoOf(m.id) }));
  await spinMatchup(
    slotEls.map((el, i) => ({ el, finalName: s.names[i] || 'Fighter', finalPhoto: room.photoOf(s.slots[i]) })),
    members
  );
  slotEls.forEach((el) => el.classList.remove('spinning'));
  spinning = false;
  render();
}

function renderRace(s, mySlot) {
  const iAmPlayer = mySlot >= 0;
  const locked = s.phase !== 'racing' || Date.now() < room.localStart;
  const z = room.problem ? zoneOf(room.problem.id) : ZONES[0];
  $('#round-label').textContent = `Round ${s.round || 1} · Zone ${z.n}`;

  [0, 1].forEach((i) => {
    const { el, cm } = lanes[i];
    const mine = i === mySlot;
    const hideCode = iAmPlayer && !mine && s.phase !== 'finished';
    const name = s.names[i] || 'Left the ring';
    const photo = pic(s.slots[i], name);
    const won = !!(s.winner && s.winner.slot === i);
    el.classList.toggle('mine', mine);
    el.classList.toggle('winner', won);
    el.classList.toggle('loser', !!(s.winner && !won));
    $('.lane-tag', el).textContent = `${CORNERS[i]}${mine ? ' · you' : ''}`;
    $('.lane-name', el).textContent = name;
    $('.lane-photo', el).src = photo;

    const r = s.results[i];
    const grading = s.grading[i] != null;
    let status = '<span class="pill">coding</span>';
    if (won) status = '<span class="pill win">winner</span>';
    else if (grading) status = '<span class="pill busy">running tests…</span>';
    else if (r && !r.compiled) status = '<span class="pill bad">compile error</span>';
    else if (r) status = `<span class="pill ${r.allPassed ? 'win' : ''}">${r.passed}/${r.total} passing</span>`;
    else if (Date.now() - room.codeSeenAt[i] < 1500 && !mine) status = '<span class="pill">typing…</span>';
    $('.lane-status', el).innerHTML = status;

    // The HUD: health-bar style progress through the tests.
    const hud = $(`.hud-side[data-hud="${i}"]`);
    const pct = r && r.total ? Math.round((100 * r.passed) / r.total) : 0;
    $('.hud-photo', hud).src = photo;
    $('.hud-name', hud).textContent = name;
    $('.hud-fill', hud).style.width = `${pct}%`;
    $('.hud-score', hud).textContent = r ? (r.compiled ? `${r.passed}/${r.total}` : 'ERR') : '–';
    hud.classList.toggle('full', !!(r && r.allPassed));

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
    const how = w.forfeit ? 'by forfeit: their opponent left the ring' : `in ${fmtTime(w.elapsedMs)}`;
    banner.innerHTML =
      `<div><div class="belt"><em>${esc(w.name || CORNERS[w.slot])}</em> takes the belt${you ? ' · that’s you' : ''}</div><div class="muted">${how}</div></div>` +
      `<div class="actions">${w.forfeit ? '' : '<button id="replay-ko" class="btn ghost small">Replay KO</button>'}` +
      (room.isHost
        ? '<button id="rematch" class="btn">Back to lobby</button><button id="next-match" class="btn gold">Random matchup</button>'
        : '<span class="muted">Waiting for the host…</span>') +
      '</div>';
    show(banner);
    const b = $('#rematch');
    if (b) b.onclick = () => room.hostBackToLobby();
    const n = $('#next-match');
    if (n) n.onclick = () => room.hostRandomMatch();
    const k = $('#replay-ko');
    if (k) k.onclick = () => knockout(s);
  } else {
    show(banner, false);
  }
}

// ---------- knockout ----------
function maybeKnockout(s) {
  if (s.phase !== 'finished' || !s.winner || s.winner.forfeit) return;
  if (sawRacing !== s.raceId || koShown === s.raceId) return;
  koShown = s.raceId;
  knockout(s);
}

function knockout(s) {
  const w = s.winner;
  const loserSlot = 1 - w.slot;
  const loserId = s.slots[loserSlot];
  const winnerName = w.name || CORNERS[w.slot];
  const loserName = s.names[loserSlot] || CORNERS[loserSlot];
  const role = room.me.id === w.id ? 'winner' : room.me.id === loserId ? 'loser' : null;
  const time = fmtTime(w.elapsedMs);
  const sub =
    role === 'loser' ? `${winnerName} passed every test in ${time}. Shake it off and run it back.`
    : role === 'winner' ? `Every test passed in ${time}. ${loserName} is down for the count.`
    : `${winnerName} passed every test in ${time}. ${loserName} is down for the count.`;
  playKO({
    winner: { name: winnerName, photo: room.photoOf(w.id) },
    loser: { name: loserName, photo: room.photoOf(loserId) },
    sub,
    role,
  });
}

// ---------- clock ----------
function tick() {
  if (!room) return;
  const s = room.state;
  const cd = $('#countdown');
  // "Fight!" stays up for a moment after the start, the same for both players.
  if (s.phase === 'countdown' || (s.phase === 'racing' && Date.now() < room.localStart + 700)) {
    const left = Math.max(0, room.localStart - Date.now());
    const z = room.problem ? zoneOf(room.problem.id) : ZONES[0];
    $('.cd-round', cd).textContent = `Round ${s.round || 1} · Zone ${z.n}: ${z.name}`;
    const num = $('.cd-num', cd);
    const text = left > 0 ? String(Math.ceil(left / 1000)) : 'Fight!';
    if (num.textContent !== text) {
      num.textContent = text;
      num.classList.toggle('go', left <= 0);
      if (left <= 0 && bellRung !== s.raceId) {
        bellRung = s.raceId;
        sfx.bell(1);
      }
    }
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
