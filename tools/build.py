"""Decode the PrairieLearn dumps into per-question folders plus problems.json.

Usage: python3 build.py <dir with raw*.txt> <output root>
"""
import json
import os
import re
import shutil
import sys

sys.path.insert(0, os.path.dirname(__file__))
from extras import EXTRAS, INSIDE_MODULE, QUEUE_SIGS, SET_SIGS  # noqa: E402

DNA = {9, 23, 24, 25, 37, 38, 42}


def unescape(s: str) -> str:
    s = s.replace("≡", "=").replace("；", ";").replace("＆", "&")
    return re.sub(r"^⟨(\d+)⟩", lambda m: " " * int(m.group(1)), s, flags=re.M)


def parse(raw_dir: str):
    text = ""
    for name in sorted(os.listdir(raw_dir)):
        if name.startswith("raw") and name.endswith(".txt"):
            with open(os.path.join(raw_dir, name), encoding="utf-8") as f:
                text += f.read().rstrip("\n") + "\n"
    qs = []
    for block in re.split(r"^@@@@ ", text, flags=re.M)[1:]:
        header, rest = block.split("\n", 1)
        num, filename = header.split()
        prompt, code = rest.split("@@ FILE\n", 1)
        prompt = prompt.replace("@@ PROMPT\n", "", 1)
        qs.append({
            "id": int(num[1:]),
            "filename": filename,
            "prompt": strip_gutters(unescape(prompt).strip()),
            "starter": unescape(code).rstrip() + "\n",
        })
    qs.sort(key=lambda q: q["id"])
    return qs


def strip_gutters(prompt: str) -> str:
    """Remove PrairieLearn code-block line numbers glued onto the text
    ("1\n2\n3let x = ..." or "1compose : ...")."""
    lines = prompt.split("\n")
    out, i = [], 0
    while i < len(lines):
        k = 0
        while i + k < len(lines) and lines[i + k] == str(k + 1):
            k += 1
        m = re.match(rf"^{k + 1}(\D.*)$", lines[i + k]) if i + k < len(lines) else None
        if m and (k > 0 or not m.group(1).startswith(" ")):
            out.append(m.group(1))
            i += k + 1
        else:
            out.append(lines[i])
            i += 1
    return "\n".join(out)


def title_of(prompt: str) -> str:
    first = prompt.split("\n", 1)[0].strip()
    return first.split(":", 1)[1].strip() if ":" in first else first


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")[:40]


def deps_for(qid: int):
    deps = ["assert.ml"]
    if qid in DNA:
        deps.append("helices.ml")
    if qid in (28, 45):
        deps.append("higherOrder.ml")
    if qid == 15:
        deps.append("tree.ml")
    if qid in QUEUE_SIGS:
        deps.append("queueInterface.ml")
    if qid in SET_SIGS:
        deps.append("setInterface.ml")
    return deps


def generated_deps(qid: int):
    out = {}
    if qid in QUEUE_SIGS:
        out["queueInterface.ml"] = (
            "(* The QUEUE interface, cut down to the operations this question uses. *)\n"
            "module type QUEUE = sig\n  type 'a queue\n" + QUEUE_SIGS[qid] + "\nend\n")
    if qid in SET_SIGS:
        out["setInterface.ml"] = (
            "(* The SET interface, cut down to the operations this question uses. *)\n"
            "module type SET = sig\n  type 'a set\n" + SET_SIGS[qid] + "\nend\n")
    return out


def prelude(qid: int, lib: str) -> str:
    """Dependencies wrapped as modules, for running everything as one program."""
    gen = generated_deps(qid)
    parts = []
    for dep in deps_for(qid):
        if dep in gen:
            text = gen[dep]
        else:
            with open(os.path.join(lib, dep)) as f:
                text = f.read()
        text = re.sub(r"\(\* BEGIN-LOCAL.*?END-LOCAL \*\)\n?", "", text, flags=re.S)
        name = dep[:-3][0].upper() + dep[:-3][1:]
        parts.append(f"module {name} = struct\n{text.rstrip()}\nend\n")
    return "\n".join(parts)


def with_extras(qid: int, code: str) -> str:
    """The file as graded: the given code plus the extra tests."""
    extra = EXTRAS.get(qid, "")
    if not extra:
        return code
    header = "\n(* ---- Extra tests from the problem statement ---- *)\n"
    if qid in INSIDE_MODULE:
        idx = code.rstrip().rfind("\nend")
        return code[:idx] + "\n" + header + extra + code[idx:]
    prefix = "" if ";; open Assert" in code else ";; open Assert\n"
    return code.rstrip() + "\n" + header + prefix + extra


RUN_SH = """#!/usr/bin/env bash
# Compile and run this question's tests with a small stack, like the grader.
set -e
cd "$(dirname "$0")"
mkdir -p _build
cp {deps} {main} _build/
cd _build
ocamlc -w -a -o test.byte {deps} {main}
OCAMLRUNPARAM='l={stack}' ./test.byte
"""

STACK_WORDS = 2000


def main():
    raw_dir, out_root = sys.argv[1], sys.argv[2]
    lib = os.path.join(os.path.dirname(__file__), "..", "lib")
    qs = parse(raw_dir)
    assert [q["id"] for q in qs] == list(range(1, 47)), [q["id"] for q in qs]
    prob_root = os.path.join(out_root, "problems")
    if os.path.exists(prob_root):
        shutil.rmtree(prob_root)
    os.makedirs(prob_root)
    bank = []
    for q in qs:
        qid = q["id"]
        title = title_of(q["prompt"])
        folder = f"q{qid:02d}_{slug(title)}"
        d = os.path.join(prob_root, folder)
        os.makedirs(d)
        deps = deps_for(qid)
        gen = generated_deps(qid)
        for dep in deps:
            if dep in gen:
                with open(os.path.join(d, dep), "w") as f:
                    f.write(gen[dep])
            else:
                shutil.copy(os.path.join(lib, dep), d)
        with open(os.path.join(d, q["filename"]), "w") as f:
            f.write(with_extras(qid, q["starter"]))
        with open(os.path.join(d, "PROBLEM.md"), "w") as f:
            f.write(f"# Question {qid}: {title}\n\nFile: `{q['filename']}`\n\n```\n{q['prompt']}\n```\n")
        sh = os.path.join(d, "run.sh")
        with open(sh, "w") as f:
            f.write(RUN_SH.format(deps=" ".join(deps), main=q["filename"], stack=STACK_WORDS))
        os.chmod(sh, 0o755)
        bank.append({
            "id": qid,
            "title": title,
            "folder": folder,
            "filename": q["filename"],
            "prompt": q["prompt"],
            "starter": q["starter"],
            "deps": deps,
            "generatedDeps": gen,
            "extraTests": EXTRAS.get(qid, ""),
            "extraInsideModule": qid in INSIDE_MODULE,
            "prelude": prelude(qid, lib),
        })
    with open(os.path.join(out_root, "problems.json"), "w") as f:
        json.dump({"stackWords": STACK_WORDS, "problems": bank}, f, indent=1)
    print(f"wrote {len(bank)} problems to {prob_root}")


if __name__ == "__main__":
    main()
