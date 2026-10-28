// Fight-night effects: synthesized bell and punch sounds, the knockout scene
// that plays when a race is won, and the slot-machine reveal for a random matchup.

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- sound ----------
class Sfx {
  constructor() {
    this.ctx = null;
    try { this.on = localStorage.getItem('arena-sound') !== 'off'; } catch { this.on = true; }
    // Browsers only allow audio after a gesture, so open the context on the first one.
    addEventListener('pointerdown', () => this._ctx(), { once: true });
  }

  toggle() {
    this.on = !this.on;
    try { localStorage.setItem('arena-sound', this.on ? 'on' : 'off'); } catch {}
    return this.on;
  }

  _ctx() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  // A ring bell: a few inharmonic partials with a long decay.
  bell(times = 1) {
    const ctx = this.on && this._ctx();
    if (!ctx) return;
    for (let k = 0; k < times; k++) {
      const t0 = ctx.currentTime + k * 0.32;
      const out = ctx.createGain();
      out.gain.setValueAtTime(0.0001, t0);
      out.gain.exponentialRampToValueAtTime(0.22, t0 + 0.005);
      out.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.6);
      out.connect(ctx.destination);
      for (const [ratio, amp] of [[1, 1], [2.32, 0.5], [4.25, 0.3], [6.8, 0.15]]) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.frequency.value = 820 * ratio;
        g.gain.value = amp;
        osc.connect(g).connect(out);
        osc.start(t0);
        osc.stop(t0 + 1.7);
      }
    }
  }

  // A thump: a falling sine plus a burst of filtered noise.
  punch(heavy = false) {
    const ctx = this.on && this._ctx();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.setValueAtTime(heavy ? 160 : 210, t0);
    osc.frequency.exponentialRampToValueAtTime(45, t0 + 0.18);
    g.gain.setValueAtTime(heavy ? 0.7 : 0.45, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.25);

    const len = Math.floor(ctx.sampleRate * 0.12);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const noise = ctx.createBufferSource();
    const lp = ctx.createBiquadFilter();
    const ng = ctx.createGain();
    noise.buffer = buf;
    lp.type = 'lowpass';
    lp.frequency.value = heavy ? 900 : 1400;
    ng.gain.value = heavy ? 0.5 : 0.3;
    noise.connect(lp).connect(ng).connect(ctx.destination);
    noise.start(t0);
  }
}

export const sfx = new Sfx();

// ---------- avatars ----------
const PALETTE = ['#e2322b', '#2f6fe0', '#f2b531', '#2fa36b', '#b34ad8', '#e8743b'];

// The member's photo, or a monogram stand-in when they have none.
export function avatar(name, photo) {
  if (photo) return photo;
  const n = String(name || '?').trim();
  const initials = (n.split(/\s+/).map((w) => w[0]).join('').slice(0, 2) || '?').toUpperCase();
  let h = 0;
  for (const c of n) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const bg = PALETTE[h % PALETTE.length];
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' fill='${bg}'/><text x='50' y='64' font-size='42' font-family='Impact, Anton, sans-serif' text-anchor='middle' fill='#0d0b0a'>${initials.replace(/[<>&'"]/g, '')}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// ---------- knockout ----------
const POWS = ['POW!', 'BAM!', 'WHAM!', 'BOOM!', 'SMACK!', 'THWACK!'];

// Plays the knockout scene. winner and loser are {name, photo}; sub is the line
// under "K.O."; role is 'winner', 'loser' or null (spectator).
export async function playKO({ winner, loser, sub, role }) {
  const ko = document.getElementById('ko');
  const $ = (s) => ko.querySelector(s);
  $('.ko-winner img').src = avatar(winner.name, winner.photo);
  $('.ko-loser img').src = avatar(loser.name, loser.photo);
  $('.ko-winner .ko-name').textContent = winner.name;
  $('.ko-loser .ko-name').textContent = loser.name;
  $('.ko-sub').textContent = sub;
  $('.ko-tag').textContent = role === 'loser' ? 'You got knocked out' : role === 'winner' ? 'Winner by knockout' : 'Knockout';
  ko.querySelectorAll('*').forEach((el) => el.getAnimations().forEach((a) => a.cancel()));
  ko.className = 'ko';
  ko.dataset.role = role || '';

  let done;
  const finished = new Promise((r) => (done = r));
  const close = () => {
    ko.classList.add('leaving');
    setTimeout(() => {
      ko.className = 'ko hidden';
      done();
    }, 350);
  };
  const auto = setTimeout(close, 9000);
  ko.onclick = () => {
    clearTimeout(auto);
    close();
  };

  if (reducedMotion()) {
    ko.classList.add('down', 'titled');
    sfx.bell(3);
    return finished;
  }

  const stage = $('.ko-stage');
  const loserFace = $('.ko-loser .ko-frame');
  const hit = $('.ko-loser .ko-hit');
  const pow = $('.ko-pow');
  const gloves = [$('.glove.g1'), $('.glove.g2')];

  await wait(650);

  const reach = (glove) => {
    const g = glove.getBoundingClientRect();
    const f = loserFace.getBoundingClientRect();
    return Math.max(40, f.left + f.width * 0.35 - g.right + g.width * 0.15);
  };

  const impact = (heavy) => {
    sfx.punch(heavy);
    hit.animate([{ opacity: 0.75 }, { opacity: 0 }], { duration: 260, easing: 'ease-out' });
    stage.animate(
      [{ transform: 'translate(0,0)' }, { transform: `translate(${heavy ? 14 : 7}px, ${heavy ? -8 : 3}px)` }, { transform: 'translate(0,0)' }],
      { duration: 160 }
    );
    pow.textContent = POWS[Math.floor(Math.random() * POWS.length)];
    const rot = Math.round(Math.random() * 30 - 15);
    pow.animate(
      [
        { opacity: 0, transform: `translate(-50%, -50%) rotate(${rot}deg) scale(.3)` },
        { opacity: 1, transform: `translate(-50%, -50%) rotate(${rot}deg) scale(${heavy ? 1.5 : 1.15})`, offset: 0.25 },
        { opacity: 0, transform: `translate(-50%, -50%) rotate(${rot}deg) scale(1)` },
      ],
      { duration: 650, easing: 'ease-out' }
    );
  };

  // Three jabs, alternating hands.
  for (let i = 0; i < 3; i++) {
    const glove = gloves[i % 2];
    const d = reach(glove);
    const jab = glove.animate(
      [
        { transform: 'translateX(0)' },
        { transform: `translateX(${d}px) scale(1.15)`, offset: 0.45 },
        { transform: 'translateX(0)' },
      ],
      { duration: 300, easing: 'cubic-bezier(.2,.9,.3,1)' }
    );
    await wait(135);
    impact(false);
    loserFace.animate(
      [
        { transform: 'translateX(0) rotate(0)' },
        { transform: `translateX(26px) rotate(${i % 2 ? -7 : 9}deg)` },
        { transform: 'translateX(0) rotate(0)' },
      ],
      { duration: 340, easing: 'ease-out' }
    );
    await jab.finished;
    await wait(110);
  }

  // The uppercut.
  await wait(200);
  const g = gloves[1];
  const d = reach(g);
  g.animate(
    [
      { transform: 'translate(0, 70px) rotate(35deg)' },
      { transform: `translate(${d}px, -50px) rotate(-40deg) scale(1.35)`, offset: 0.5 },
      { transform: 'translate(0, 0) rotate(0)' },
    ],
    { duration: 520, easing: 'cubic-bezier(.2,.9,.3,1)' }
  );
  await wait(250);
  impact(true);
  ko.classList.add('down');
  loserFace.animate(
    [
      { transform: 'translate(0, 0) rotate(0)', filter: 'grayscale(0)' },
      { transform: 'translate(10px, -70px) rotate(-22deg)', filter: 'grayscale(.3)', offset: 0.3 },
      { transform: 'translate(70px, 120px) rotate(84deg)', filter: 'grayscale(.85)' },
    ],
    { duration: 900, easing: 'cubic-bezier(.5,0,.7,1)', fill: 'forwards' }
  );
  await wait(800);
  ko.classList.add('titled');
  sfx.bell(3);
  return finished;
}

// ---------- matchup reveal ----------
// Spins each slot through the room's members before landing on the real pick.
// slots: [{el, finalName, finalPhoto}]; members: [{name, photo}].
export async function spinMatchup(slots, members) {
  if (reducedMotion() || members.length < 2) return;
  const steps = 16;
  for (let i = 0; i < steps; i++) {
    slots.forEach(({ el }, k) => {
      const m = members[(i * 3 + k * 5 + Math.floor(Math.random() * members.length)) % members.length];
      el.querySelector('.slot-photo').src = avatar(m.name, m.photo);
      el.querySelector('.slot-name').textContent = m.name;
    });
    sfx.punch(false);
    await wait(50 + i * i * 1.6);
  }
  slots.forEach(({ el, finalName, finalPhoto }) => {
    el.querySelector('.slot-photo').src = avatar(finalName, finalPhoto);
    el.querySelector('.slot-name').textContent = finalName;
    el.animate([{ transform: 'scale(1.06)' }, { transform: 'scale(1)' }], { duration: 300, easing: 'ease-out' });
  });
  sfx.bell(1);
}
