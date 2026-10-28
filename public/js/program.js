// Turns a player's file into one self-contained OCaml program that the
// browser toplevel can run: dependency modules first, then the player's code
// with the hidden extra tests added, then a line that prints the score.

export const DEFAULT_STRESS_N = 20000;

export function withExtras(problem, code) {
  const extra = problem.extraTests || '';
  if (!extra) return code;
  const header = '\n(* ---- Extra tests from the problem statement ---- *)\n';
  if (problem.extraInsideModule) {
    const trimmed = code.replace(/\s+$/, '');
    const idx = trimmed.lastIndexOf('\nend');
    if (idx >= 0) return trimmed.slice(0, idx) + '\n' + header + extra + trimmed.slice(idx) + '\n';
  }
  const prefix = code.includes(';; open Assert') ? '' : ';; open Assert\n';
  return code.replace(/\s+$/, '') + '\n' + header + prefix + extra;
}

export function buildProgram(problem, code, { stressN = DEFAULT_STRESS_N } = {}) {
  const prelude = problem.prelude.replace(
    /let stress_n = \d+/,
    `let stress_n = ${Math.max(1, Math.floor(stressN))}`
  );
  return `${prelude}\n${withExtras(problem, code)}\n;; let () = Assert.summary ()\n`;
}

// Reads the PASS/FAIL lines the Assert module prints.
export function parseResults(stdout, errors = []) {
  const lines = (stdout || '').split('\n');
  const tests = [];
  let summary = null;
  for (const line of lines) {
    let m;
    if ((m = line.match(/^PASS {2}(.*)$/))) tests.push({ ok: true, name: m[1] });
    else if ((m = line.match(/^FAIL {2}(.*?)(?: {2}\((.*)\))?$/))) tests.push({ ok: false, name: m[1], detail: m[2] || '' });
    else if ((m = line.match(/^SUMMARY (\d+)\/(\d+) passed/))) summary = { passed: +m[1], total: +m[2] };
  }
  const compiled = !errors || errors.length === 0;
  const passed = summary ? summary.passed : tests.filter((t) => t.ok).length;
  const total = summary ? summary.total : tests.length;
  return {
    compiled,
    finished: summary !== null,
    passed,
    total,
    tests,
    allPassed: compiled && summary !== null && total > 0 && passed === total,
  };
}
