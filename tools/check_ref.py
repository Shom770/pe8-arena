import os, re, shutil, subprocess, sys, tempfile
sys.path.insert(0, os.path.dirname(__file__))
from reference import REF, NON_TAIL

def patch(src, table):
    def rep(m):
        ind, msg = m.group(1), m.group(2)
        if msg not in table: return m.group(0)
        body = table[msg].split("\n")
        return "\n".join([ind + "(" + body[0]] + [ind + l for l in body[1:]]) + ")"
    return re.sub(r'^( *)failwith "([^"]*)"', rep, src, flags=re.M)

def run(folder, table):
    tmp = tempfile.mkdtemp()
    dst = os.path.join(tmp, "q"); shutil.copytree(folder, dst)
    main = open(os.path.join(dst, "run.sh")).read().split("ocamlc -w -a -o test.byte ")[1].split("\n")[0].split()[-1]
    p = os.path.join(dst, main)
    src = open(p).read()
    with open(p, "w") as f: f.write(patch(src, table))
    r = subprocess.run(["bash", os.path.join(dst, "run.sh")], capture_output=True, text=True, timeout=120)
    return r.stdout + r.stderr

def main():
  only = sys.argv[1:]
  for d in sorted(os.listdir("problems")):
      if only and not any(d.startswith(o) for o in only): continue
      out = run(os.path.join("problems", d), REF)
      s = [l for l in out.splitlines() if l.startswith("SUMMARY")]
      fails = [l for l in out.splitlines() if l.startswith("FAIL")]
      ok = s and (lambda a: a[0] == a[1])(s[0].split()[1].split("/"))
      print(("ok   " if ok else "BAD  ") + d + "  " + (s[0] if s else out[-600:]))
      for f in fails: print("     " + f)
  print("--- non-tail-recursive versions (should FAIL the 1000-element test):")
  for d in ("q07_contains", "q46_reverse"):
      out = run(os.path.join("problems", d), {**REF, **NON_TAIL})
      print(d, [l for l in out.splitlines() if "1000" in l or l.startswith("SUMMARY")])

if __name__ == "__main__":
  main()
