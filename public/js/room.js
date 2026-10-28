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

const COUNTDOWN_MS = 3000;
const CODE_THROTTLE_MS = 200;

const rand = () => Math.random().toString(36).slice(2, 10);

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
  };
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
  constructor({ transport, me, problems, grader }) {
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
    return this.state.slots.indexOf(this.me.id);
  }
  get problem() {
    return this.problems.find((p) => p.id === this.state.problemId) || null;
  }
  nameOf(id) {
    const m = this.members.find((x) => x.id === id);
    return m ? m.name : null;
  }

  // ---- lifecycle ----
  async join() {
    this.t.on('state', (s) => this._onState(s));
    this.t.on('hello', (p) => this._onHello(p));
    this.t.on('claim', (p) => this.isHost && this._hostClaim(p.id, p.slot));
    this.t.on('release', (p) => this.isHost && this._hostRelease(p.id));
    this.t.on('code', (p) => this._onCode(p));
    this.t.on('submit', (p) => this.isHost && this._hostSubmit(p));
    this.t.onPresence((members) => this._onPresence(members));
    await this.t.connect();
    this.t.send('hello', { id: this.me.id });
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
            if ((s.phase === 'racing' || s.phase === 'countdown') && !s.winner) {
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

  _resetRace(countdownMs) {
    const starter = this.problem ? this.problem.starter : '';
    this.codes = [starter, starter];
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

  hostStart(problemId) {
    if (!this.isHost || !this.state.slots[0] || !this.state.slots[1]) return;
    if (this.state.phase === 'countdown' || this.state.phase === 'racing') return;
    const raceId = rand();
    this._commit((s) => {
      s.phase = 'countdown';
      s.problemId = problemId;
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

  hostBackToLobby() {
    this._commit((s) => {
      s.phase = 'lobby';
      s.winner = null;
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
