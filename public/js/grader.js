// Runs OCaml programs in the browser with the @live-codes/ocaml toplevel.
//
// Its worker (worker-entry.js, copied into /ocaml/ at build time) answers one
// message protocol: post {code, input, args, files}; it replies
// ['ready', banner] once at start and ['result', exitCode, stdout, stderr,
// outcome, output, diagnostics] per run. exitCode is null when the program
// did not compile.
//
// Every grade gets a fresh worker so one submission cannot leave definitions
// behind for the next, and an infinite loop is cut off by terminating it.
// A spare worker is kept warm so a grade does not wait for start-up.

import { buildProgram, parseResults, toPlayerLines } from './program.js';

export class Grader {
  constructor({ baseUrl = new URL('/ocaml/', location.href), timeoutMs = 15000, stressN } = {}) {
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
    this.stressN = stressN;
    this.spare = null;
    this.queue = Promise.resolve();
    this.cache = new Map();
  }

  _spawn() {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('worker-entry.js', this.baseUrl));
      const onMessage = (e) => {
        if (e.data && e.data[0] === 'ready') {
          worker.removeEventListener('message', onMessage);
          resolve(worker);
        }
      };
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', (e) => reject(new Error(`OCaml runtime failed to load: ${e.message || 'unknown error'}`)));
    });
  }

  warm() {
    if (!this.spare) {
      this.spare = this._spawn();
      this.spare.catch(() => { this.spare = null; });
    }
    return this.spare;
  }

  async _runRaw(program) {
    let worker;
    try {
      worker = await (this.spare || this._spawn());
    } finally {
      this.spare = null;
    }
    this.warm();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        worker.terminate();
        resolve({ timedOut: true, stdout: '', diagnostics: '', exitCode: 1 });
      }, this.timeoutMs);
      worker.addEventListener('message', (e) => {
        const m = e.data;
        if (!m || m[0] !== 'result') return;
        clearTimeout(timer);
        worker.terminate();
        const [, exitCode, stdout, stderr, , , diagnostics] = m;
        resolve({ timedOut: false, exitCode, stdout, stderr, diagnostics: diagnostics || '' });
      });
      worker.postMessage({ code: program, input: '', args: [], files: [] });
    });
  }

  // Grades a player's code for a problem. Results are cached by code.
  grade(problem, code) {
    const key = `${problem.id}\u0000${code}`;
    if (this.cache.has(key)) return Promise.resolve(this.cache.get(key));
    const job = this.queue.then(async () => {
      const started = performance.now();
      let raw;
      try {
        raw = await this._runRaw(buildProgram(problem, code, { stressN: this.stressN }));
      } catch (err) {
        return { error: String(err.message || err), compiled: false, finished: false, passed: 0, total: 0, tests: [], allPassed: false };
      }
      const errors = raw.exitCode === null ? toPlayerLines(problem, raw.diagnostics).split('\n').filter(Boolean) : [];
      const result = parseResults(raw.stdout, errors);
      result.ms = Math.round(performance.now() - started);
      if (raw.timedOut) result.error = `Timed out after ${this.timeoutMs / 1000}s (infinite loop?)`;
      else if (!result.compiled) result.error = errors.join('\n');
      else if (!result.finished) result.error = (raw.stderr || raw.diagnostics || 'The program stopped before all tests ran.').trim();
      if (result.error && result.error.length > 2000) result.error = result.error.slice(0, 2000) + '\n…';
      if (!raw.timedOut) this.cache.set(key, result);
      return result;
    });
    this.queue = job.catch(() => {});
    return job;
  }
}
