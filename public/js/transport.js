// Room messaging. Two interchangeable implementations with the same shape:
//
//   SupabaseTransport - Supabase Realtime (broadcast + presence). Used in production,
//                       since Vercel functions cannot hold WebSocket connections.
//   LocalTransport    - BroadcastChannel between tabs of one browser, for trying the
//                       app without a Supabase project (add ?local to the URL).
//
// Shape: await t.connect(); t.send(event, payload); t.on(event, fn(payload));
//        t.onPresence(fn(members)); t.leave(). Members are {id, name, joinedAt}.

export const EVENTS = ['state', 'hello', 'claim', 'release', 'code', 'submit', 'host_action'];

export class SupabaseTransport {
  constructor({ url, anonKey, room, me }) {
    this.url = url;
    this.anonKey = anonKey;
    this.room = room;
    this.me = me;
    this.handlers = {};
    this.presenceHandlers = [];
  }

  async connect() {
    const { createClient } = await import('../vendor/supabase.js');
    this.client = createClient(this.url, this.anonKey, {
      realtime: { params: { eventsPerSecond: 20 } },
    });
    this.channel = this.client.channel(`arena-${this.room}`, {
      config: { broadcast: { self: false, ack: false }, presence: { key: this.me.id } },
    });
    for (const event of EVENTS) {
      this.channel.on('broadcast', { event }, ({ payload }) => this._emit(event, payload));
    }
    this.channel.on('presence', { event: 'sync' }, () => {
      const state = this.channel.presenceState();
      const members = [];
      for (const metas of Object.values(state)) {
        if (metas && metas[0]) {
          const { id, name, joinedAt } = metas[0];
          members.push({ id, name, joinedAt });
        }
      }
      this.presenceHandlers.forEach((fn) => fn(members));
    });
    await new Promise((resolve, reject) => {
      this.channel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await this.channel.track({ ...this.me });
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          reject(new Error(`Realtime connection failed (${status})`));
        }
      });
    });
  }

  send(event, payload) {
    if (!this.channel) return;
    this.channel.send({ type: 'broadcast', event, payload });
  }

  on(event, fn) {
    (this.handlers[event] ||= []).push(fn);
  }

  onPresence(fn) {
    this.presenceHandlers.push(fn);
  }

  _emit(event, payload) {
    (this.handlers[event] || []).forEach((fn) => fn(payload));
  }

  async leave() {
    if (this.channel) await this.channel.unsubscribe();
  }
}

export class LocalTransport {
  constructor({ room, me }) {
    this.room = room;
    this.me = me;
    this.handlers = {};
    this.presenceHandlers = [];
    this.peers = new Map();
  }

  async connect() {
    this.bc = new BroadcastChannel(`arena-${this.room}`);
    this.bc.onmessage = (e) => {
      const { kind, event, payload, from } = e.data || {};
      if (kind === 'ping') {
        const known = this.peers.has(from.id);
        this.peers.set(from.id, { ...from, seen: Date.now() });
        if (!known) {
          this._ping();
          this._presence();
        }
      } else if (kind === 'bye') {
        this.peers.delete(from.id);
        this._presence();
      } else if (kind === 'msg') {
        (this.handlers[event] || []).forEach((fn) => fn(payload));
      }
    };
    this.timer = setInterval(() => {
      this._ping();
      const before = this.peers.size;
      for (const [id, p] of this.peers) if (Date.now() - p.seen > 5000) this.peers.delete(id);
      if (this.peers.size !== before) this._presence();
    }, 1500);
    window.addEventListener('beforeunload', () => this.leave());
    this._ping();
    this._presence();
  }

  _ping() {
    this.bc.postMessage({ kind: 'ping', from: this.me });
  }

  _presence() {
    const members = [this.me, ...[...this.peers.values()].map(({ id, name, joinedAt }) => ({ id, name, joinedAt }))];
    this.presenceHandlers.forEach((fn) => fn(members));
  }

  send(event, payload) {
    this.bc.postMessage({ kind: 'msg', event, payload, from: this.me });
  }

  on(event, fn) {
    (this.handlers[event] ||= []).push(fn);
  }

  onPresence(fn) {
    this.presenceHandlers.push(fn);
  }

  async leave() {
    clearInterval(this.timer);
    if (this.bc) {
      this.bc.postMessage({ kind: 'bye', from: this.me });
      this.bc.close();
      this.bc = null;
    }
  }
}
