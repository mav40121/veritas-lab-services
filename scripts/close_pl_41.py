# Move the already-closed (in-body) #41 out of OPEN into CLOSED as C44, and note
# the audit-matcher fix that showed its "reopened debt" was a false positive.
import re, pathlib
MD = pathlib.Path(__file__).resolve().parent.parent / "PARKING_LOT.md"
text = MD.read_text(encoding="utf-8")

pat = re.compile(r"### 41\. Verify-script convention backfill.*?\n---\n", re.DOTALL)
new, n = pat.subn("", text, count=1)
if n != 1:
    raise SystemExit(f"expected to remove one #41 block, removed {n}")
text = new

closed = """### C44. Verify-script convention backfill (was #41) + audit matcher fix

**Closure evidence:** #41 was fully backfilled on 2026-06-13 (all 8 high-stakes scripts landed; see C30); it had only been mis-filed in OPEN. A 2026-09-24 re-audit initially reported 4 of 5 recent math/logic commits as missing a verify script, which was a FALSE POSITIVE: scripts/audit_verify_script_coverage.py matched only scripts/verify-*.js / .cjs, so it ignored the .mjs / .mts / .ts verify scripts the repo now ships (e.g. verify-ptcoag-multi.mts, verify-tea-criterion-format.mjs). Fixed the matcher to accept .js/.cjs/.mjs/.ts/.mts; re-run shows 5 of 5 covered, 0 debt. The convention is being followed. Closed 2026-09-24.

**Source:** 2026-09-24 session, "keep working" pass; audit tooling bug found + fixed.

---

"""
marker = "## CLOSED (audit trail)\n\n"
i = text.find(marker) + len(marker)
text = text[:i] + closed + text[i:]
MD.write_text(text, encoding="utf-8")
print("Moved #41 -> C44 (closed) and recorded the audit-matcher fix.")
