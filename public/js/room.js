// Room logic, independent of the page.
//
// There is no server: the earliest-joined member is the host and holds the
// authoritative state (phase, who is in each player slot, the problem, the
// latest verified results and the winner). The host broadcasts the whole
// state whenever it changes; everyone else only renders it. If the host
// leaves, the next earliest member takes over with the last state it saw.
//
// Players stream their code to the room as they type. "Run tests" sends the
// code to the host, which grades it in its own browser, so a player cannot
// report a pass their code did not earn. Submissions are graded in the order
// the host receives them; the first one that passes every test wins.
//
// In free-for-all mode ('brawl') everyone in the room at the bell races. Code
// is not streamed; the host keeps a scoreboard of each player's best result and
// sends each player their own detailed result on a 'result' event. The round
// ends once the podium is decided: when the top three have finished (fewer in
// a smaller field), or when the host ends it.
//
// Each member's weigh-in photo travels on its own 'photo' event rather than in
// presence, and is re-sent whenever someone new says hello.

const COUNTDOWN_MS = 3000;
const CODE_THROTTLE_MS = 200;

const rand = () => Math.random().toString(36).slice(2, 10);
const PHOTO_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_PHOTO_CHARS = 80000;

function freshState() {
  return {
    seq: 0,
    hostId: null,
    phase: 'lobby', // lobby | countdown | racing | finished
    slots: [null, null],
    names: [null, null],
    problemId: null,
    raceId: null,
    countdownMs: COUNTDOWN_MS,
    startedAt: null,
    results: [null, null],
    grading: [null, null],
    winner: null,
    matchup: 0, // bumped by each random matchup, so every page can play the reveal
    round: 0, // races started in this room
    played: [], // problem ids raced so far, so random picks don't repeat
    mode: 'duel', // duel | brawl
    field: [], // brawl: [{id, name}] of everyone racing
    board: {}, // brawl: id -> {passed, total, compiled, finishMs, bestAt, grading, left}
    standings: null, // brawl: final ranking, set when the round ends
  };
}

// Finishers by time, then everyone else by tests passed (earliest to reach it
// first), with players who left last.
export function brawlStandings(s) {
  const far = 1e15;
  return (s.field || [])
    .map((f) => ({ id: f.id, name: f.name, ...s.board[f.id] }))
    .sort((a, b) =>
      (a.finishMs ?? far) - (b.finishMs ?? far) ||
      (a.left ? 1 : 0) - (b.left ? 1 : 0) ||
      b.passed - a.passed ||
      (a.bestAt ?? far) - (b.bestAt ?? far)
    );
}

function trimResult(r) {
  return {
    n: r.n,
    compiled: r.compiled,
    finished: r.finished,
    passed: r.passed,
    total: r.total,
    allPassed: r.allPassed,
    error: r.error ? r.error.slice(0, 1500) : null,
    ms: r.ms,
    tests: (r.tests || []).slice(0, 60).map((t) => ({ ok: t.ok, name: t.name.slice(0, 120), detail: (t.detail || '').slice(0, 160) })),
  };
}

export class Room {
  constructor({ transport, me, problems, grader, photo = null }) {
    this.t = transport;
    this.me = me;
    this.problems = problems;
    this.grader = grader;
    this.members = [me];
    this.state = freshState();
    this.codes = ['', ''];
    this.codeSeenAt = [0, 0];
    this.localStart = null;
    this.submitCount = 0;
    this.listeners = {};
    this._sendTimer = null;
    this._pendingCode = null;
    this.photos = {};
    if (photo) this.photos[me.id] = photo;
    this.myCode = '';
    this.myResult = null;
  }

  // ---- events for the page ----
  on(event, fn) {
    (this.listeners[event] ||= []).push(fn);
  }
  _emit(event, ...args) {
    (this.listeners[event] || []).forEach((fn) => fn(...args));
  }

  // ---- derived ----
  get hostId() {
    const sorted = [...this.members].sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : 1));
    return sorted.length ? sorted[0].id : this.me.id;
  }
  get isHost() {
    return this.hostId === this.me.id;
  }
  get mySlot() {
    if (this.state.mode === 'brawl') return -1;
    return this.state.slots.indexOf(this.me.id);
  }
  get inField() {
    return this.state.mode === 'brawl' && (this.state.field || []).some((f) => f.id === this.me.id);
  }
  get problem() {
    return this.problems.find((p) => p.id === this.state.problemId) || null;
  }
  nameOf(id) {
    const m = this.members.find((x) => x.id === id);
    return m ? m.name : null;
  }
  photoOf(id) {
    return this.photos[id] || null;
  }

  // ---- lifecycle ----
  async join() {
    this.t.on('state', (s) => this._onState(s));
    this.t.on('hello', (p) => this._onHello(p));
    this.t.on('claim', (p) => this.isHost && this._hostClaim(p.id, p.slot));
    this.t.on('release', (p) => this.isHost && this._hostRelease(p.id));
    this.t.on('code', (p) => this._onCode(p));
    this.t.on('submit', (p) => this.isHost && this._hostSubmit(p));
    this.t.on('photo', (p) => this._onPhoto(p));
    this.t.on('result', (p) => this._onResult(p));
    this.t.onPresence((members) => this._onPresence(members));
    await this.t.connect();
    this.t.send('hello', { id: this.me.id });
    this._sendPhoto();
    this._emit('change');
  }

  async leave() {
    await this.t.leave();
  }

  // ---- incoming ----
  _onPresence(members) {
    const byId = new Map(members.map((m) => [m.id, m]));
    if (!byId.has(this.me.id)) byId.set(this.me.id, this.me);
    this.members = [...byId.values()];
    if (this.isHost) {
      const wasHost = this.state.hostId === this.me.id;
      this._commit((s) => {
        s.hostId = this.me.id;
        s.slots.forEach((id, i) => {
          if (id && !byId.has(id)) {
            s.slots[i] = null;
            s.names[i] = null;
            if ((s.phase === 'racing' || s.phase === 'countdown') && !s.winner && s.mode !== 'brawl') {
              const other = 1 - i;
              if (s.slots[other]) {
                s.phase = 'finished';
                s.winner = { slot: other, id: s.slots[other], name: s.names[other], elapsedMs: null, forfeit: true };
              } else {
                s.phase = 'lobby';
              }
            }
          }
        });
        if (s.mode === 'brawl' && (s.phase === 'racing' || s.phase === 'countdown')) {
          for (const f of s.field) if (!byId.has(f.id) && !s.board[f.id].left) s.board[f.id].left = true;
          this._maybeEndBrawl(s);
        }
      }, !wasHost);
    }
    this._emit('change');
  }

  _onState(s) {
    // Before presence has synced we cannot tell who the host is; take the first state we see.
    const fromHost = s.hostId === this.hostId || this.members.length <= 1;
    if (!fromHost) return;
    if (this.state.hostId === s.hostId && s.seq < this.state.seq) return;
    const newRace = s.raceId && s.raceId !== this.state.raceId;
    this.state = s;
    if (newRace) this._resetRace(s.phase === 'countdown' ? s.countdownMs : 0);
    this._emit('change');
  }

  _onHello() {
    if (this.isHost) this.t.send('state', this.state);
    this._sendPhoto();
    const slot = this.mySlot;
    if (slot >= 0 && this.state.raceId) {
      this.t.send('code', { raceId: this.state.raceId, slot, code: this.codes[slot] });
    }
  }

  _onCode(p) {
    if (p.raceId !== this.state.raceId || p.slot === this.mySlot) return;
    this.codes[p.slot] = p.code;
    this.codeSeenAt[p.slot] = Date.now();
    this._emit('code', p.slot);
  }

  _sendPhoto() {
    const photo = this.photos[this.me.id];
    if (photo) this.t.send('photo', { id: this.me.id, photo });
  }

  _onPhoto(p) {
    if (!p || typeof p.id !== 'string' || typeof p.photo !== 'string') return;
    if (p.photo.length > MAX_PHOTO_CHARS || !PHOTO_RE.test(p.photo)) return;
    if (this.photos[p.id] === p.photo) return;
    this.photos[p.id] = p.photo;
    this._emit('change');
  }

  _onResult(p) {
    if (!p || p.id !== this.me.id || p.raceId !== this.state.raceId) return;
    if (this.myResult && this.myResult.n > p.result.n) return;
    this.myResult = p.result;
    this._emit('change');
  }

  _resetRace(countdownMs) {
    const starter = this.problem ? this.problem.starter : '';
    this.codes = [starter, starter];
    this.myCode = starter;
    this.myResult = null;
    this.codeSeenAt = [0, 0];
    this.submitCount = 0;
    this.localStart = Date.now() + countdownMs;
    this._emit('race');
  }

  // ---- host ----
  _commit(mutate, force = true) {
    if (!this.isHost) return;
    const before = JSON.stringify(this.state);
    mutate(this.state);
    if (!force && JSON.stringify(this.state) === before) return;
    this.state.seq += 1;
    this.state.hostId = this.me.id;
    this.t.send('state', this.state);
    this._emit('change');
  }

  _hostClaim(id, slot) {
    if (this.state.phase !== 'lobby' && this.state.phase !== 'finished') return;
    if (slot !== 0 && slot !== 1 || this.state.slots[slot]) return;
    this._commit((s) => {
      const cur = s.slots.indexOf(id);
      if (cur >= 0) {
        s.slots[cur] = null;
        s.names[cur] = null;
      }
      s.slots[slot] = id;
      s.names[slot] = this.nameOf(id) || 'Player';
    });
  }

  _hostRelease(id) {
    if (this.state.phase === 'racing' || this.state.phase === 'countdown') return;
    this._commit((s) => {
      const i = s.slots.indexOf(id);
      if (i >= 0) {
        s.slots[i] = null;
        s.names[i] = null;
      }
    });
  }

  hostSetMode(mode) {
    if (mode !== 'duel' && mode !== 'brawl') return;
    if (this.state.phase === 'countdown' || this.state.phase === 'racing') return;
    this._commit((s) => {
      s.mode = mode;
      s.phase = 'lobby';
      s.winner = null;
      s.standings = null;
    });
  }

  hostStart(problemId) {
    if (!this.isHost) return;
    const brawl = this.state.mode === 'brawl';
    if (brawl ? this.members.length < 2 : !this.state.slots[0] || !this.state.slots[1]) return;
    if (this.state.phase === 'countdown' || this.state.phase === 'racing') return;
    const raceId = rand();
    this._commit((s) => {
      if (brawl) {
        s.field = [...this.members].sort((a, b) => a.joinedAt - b.joinedAt).map((m) => ({ id: m.id, name: m.name }));
        s.board = Object.fromEntries(
          s.field.map((f) => [f.id, { passed: 0, total: 0, compiled: true, finishMs: null, bestAt: null, grading: null, left: false }])
        );
        s.standings = null;
      }
      s.phase = 'countdown';
      s.problemId = problemId;
      s.round = (s.round || 0) + 1;
      s.played = [...(s.played || []), problemId].slice(-60);
      s.raceId = raceId;
      s.countdownMs = COUNTDOWN_MS;
      s.startedAt = null;
      s.results = [null, null];
      s.grading = [null, null];
      s.winner = null;
    });
    this._resetRace(COUNTDOWN_MS);
    setTimeout(() => {
      if (this.state.raceId !== raceId || this.state.phase !== 'countdown') return;
      this._commit((s) => {
        s.phase = 'racing';
        s.startedAt = Date.now();
      });
    }, COUNTDOWN_MS);
  }

  // Puts two random members of the room in the player slots.
  hostRandomMatch() {
    if (!this.isHost || this.members.length < 2) return;
    if (this.state.phase === 'countdown' || this.state.phase === 'racing') return;
    const pool = [...this.members];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    this._commit((s) => {
      s.phase = 'lobby';
      s.mode = 'duel';
      s.winner = null;
      s.slots = [pool[0].id, pool[1].id];
      s.names = [pool[0].name, pool[1].name];
      s.matchup = (s.matchup || 0) + 1;
    });
  }

  hostBackToLobby() {
    this._commit((s) => {
      s.phase = 'lobby';
      s.winner = null;
    });
  }

  hostEndRound() {
    if (this.state.mode !== 'brawl' || this.state.phase !== 'racing') return;
    this._commit((s) => this._finishBrawl(s));
  }

  _finishBrawl(s) {
    s.phase = 'finished';
    s.winner = null;
    s.standings = brawlStandings(s);
  }

  // Ends the round once the podium is decided: the top three (or everyone but
  // one, in a field of three or fewer) have finished, or nobody is left racing.
  _maybeEndBrawl(s) {
    if (s.mode !== 'brawl' || (s.phase !== 'racing' && s.phase !== 'countdown')) return;
    const active = s.field.filter((f) => !s.board[f.id].left);
    const done = active.filter((f) => s.board[f.id].finishMs != null).length;
    if (active.length <= 1 || done >= Math.min(3, active.length - 1)) this._finishBrawl(s);
  }

  async _hostBrawlSubmit(p) {
    const s = this.state;
    const entry = s.board[p.id];
    if (p.raceId !== s.raceId || s.phase !== 'racing' || !entry || entry.left || entry.finishMs != null) return;
    const problem = this.problem;
    if (!problem) return;
    const raceId = s.raceId;
    this._commit((st) => {
      st.board[p.id].grading = p.n;
    });
    const result = await this.grader.grade(problem, p.code);
    if (this.state.raceId !== raceId) return;
    const detail = trimResult({ ...result, n: p.n });
    this.t.send('result', { raceId, id: p.id, result: detail });
    this._onResult({ raceId, id: p.id, result: detail });
    this._commit((st) => {
      const b = st.board[p.id];
      if (b.grading === p.n) b.grading = null;
      if (st.phase !== 'racing' || b.finishMs != null) return;
      const elapsed = Date.now() - st.startedAt;
      b.compiled = result.compiled;
      if (result.compiled && result.total) b.total = result.total;
      if (result.passed > b.passed) {
        b.passed = result.passed;
        b.bestAt = elapsed;
      }
      if (result.allPassed) b.finishMs = elapsed;
      this._maybeEndBrawl(st);
    });
  }

  hostClearSlot(slot) {
    if (this.state.phase === 'racing' || this.state.phase === 'countdown') return;
    this._commit((s) => {
      s.slots[slot] = null;
      s.names[slot] = null;
    });
  }

  async _hostSubmit(p) {
    const s = this.state;
    if (s.mode === 'brawl') return this._hostBrawlSubmit(p);
    if (p.raceId !== s.raceId || s.slots[p.slot] !== p.id || s.phase !== 'racing') return;
    const problem = this.problem;
    if (!problem) return;
    const raceId = s.raceId;
    this._commit((st) => {
      st.grading[p.slot] = p.n;
    });
    const result = await this.grader.grade(problem, p.code);
    if (this.state.raceId !== raceId) return;
    this._commit((st) => {
      st.results[p.slot] = trimResult({ ...result, n: p.n });
      if (st.grading[p.slot] === p.n) st.grading[p.slot] = null;
      if (result.allPassed && st.phase === 'racing' && !st.winner) {
        st.phase = 'finished';
        st.winner = { slot: p.slot, id: p.id, name: st.names[p.slot], elapsedMs: Date.now() - st.startedAt, forfeit: false };
      }
    });
  }

  // ---- actions from this page ----
  claim(slot) {
    if (this.isHost) this._hostClaim(this.me.id, slot);
    else this.t.send('claim', { id: this.me.id, slot });
  }

  release() {
    if (this.isHost) this._hostRelease(this.me.id);
    else this.t.send('release', { id: this.me.id });
  }

  setMyCode(code) {
    if (this.state.mode === 'brawl') {
      // Nobody else sees your code in a free-for-all, so it stays here until you run it.
      this.myCode = code;
      return;
    }
    const slot = this.mySlot;
    if (slot < 0) return;
    this.codes[slot] = code;
    this._pendingCode = code;
    if (this._sendTimer) return;
    this._sendTimer = setTimeout(() => {
      this._sendTimer = null;
      if (this._pendingCode === null) return;
      this.t.send('code', { raceId: this.state.raceId, slot, code: this._pendingCode });
      this._pendingCode = null;
    }, CODE_THROTTLE_MS);
  }

  submit() {
    if (this.state.mode === 'brawl') {
      if (!this.inField || this.state.phase !== 'racing') return false;
      const payload = { raceId: this.state.raceId, id: this.me.id, code: this.myCode, n: ++this.submitCount };
      if (this.isHost) this._hostSubmit(payload);
      else this.t.send('submit', payload);
      return true;
    }
    const slot = this.mySlot;
    if (slot < 0 || this.state.phase !== 'racing') return false;
    const payload = { raceId: this.state.raceId, slot, id: this.me.id, code: this.codes[slot], n: ++this.submitCount };
    // Make sure spectators have the exact code being graded.
    this.t.send('code', { raceId: payload.raceId, slot, code: payload.code });
    if (this.isHost) this._hostSubmit(payload);
    else this.t.send('submit', payload);
    return true;
  }
}
