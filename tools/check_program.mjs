// Checks that buildProgram output runs under the real OCaml toplevel
// (`ocaml prog.ml`), for the starter code and for reference solutions.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildProgram, parseResults } from '../public/js/program.js';

const bank = JSON.parse(fs.readFileSync('problems.json', 'utf8')).problems;
const refs = JSON.parse(execFileSync('python3', ['-c',
  'import json,sys; sys.path.insert(0,"tools"); from reference import REF, NON_TAIL; print(json.dumps({"REF":REF,"NON_TAIL":NON_TAIL}))']).toString());

function patch(src, table) {
  return src.replace(/^( *)failwith "([^"]*)"/gm, (all, ind, msg) => {
    if (!(msg in table)) return all;
    const body = table[msg].split('\n');
    return [ind + '(' + body[0], ...body.slice(1).map((l) => ind + l)].join('\n') + ')';
  });
}

function run(program) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'prog-')), 'prog.ml');
  fs.writeFileSync(f, program);
  let out = '', errs = [];
  try {
    out = execFileSync('ocaml', [f], { env: { ...process.env, OCAMLRUNPARAM: 'l=200000' }, timeout: 60000 }).toString();
  } catch (e) {
    out = (e.stdout || '').toString();
    errs = [(e.stderr || '').toString()];
  }
  return { r: parseResults(out, errs), errs };
}

let bad = 0;
for (const p of bank) {
  const starter = run(buildProgram(p, p.starter, { stressN: 1000 }));
  const solved = run(buildProgram(p, patch(p.starter, refs.REF), { stressN: 1000 }));
  const ok = starter.r.compiled && starter.r.finished && !starter.r.allPassed && solved.r.allPassed;
  if (!ok) bad++;
  console.log(`${ok ? 'ok ' : 'BAD'} q${p.id} starter ${starter.r.passed}/${starter.r.total}  solved ${solved.r.passed}/${solved.r.total}` +
    (ok ? '' : '\n' + (solved.errs.join('') || starter.errs.join('')).slice(0, 800)));
}
console.log(bad ? `${bad} problems need attention` : 'all problems ok');
