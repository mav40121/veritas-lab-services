# scripts/verify-adlm-claim-audit.py
#
# Receipt for the ADLM check in script/audit.py (Michael 2026-11-06, Q210 = 1: no source exists for an "ADLM recommends
# half of CLIA TEa" goal). Proves the check bites on each way the claim was written, leaves the real ADLM mentions alone,
# stays inside client, server and shared, and that the tree is clean today. script/audit.py runs in the pre-commit hook;
# this receipt runs in CI, so a commit that skipped the hook is still caught.
# Run: python scripts/verify-adlm-claim-audit.py
import importlib.util, os, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
spec = importlib.util.spec_from_file_location("audit", os.path.join(ROOT, "script", "audit.py"))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)

BITES = [
    "the ADLM recommends an internal goal of 5%",
    "also meets the ADLM-recommended internal goal of 5%",
    "ADLM recommends half of CLIA PT TEa for enhanced quality",
    "<div>ADLM recommendation</div>",
    "The ADLM Recommendation: Half of CLIA TEa",
    "the report additionally surfaces the ADLM internal goal alongside it",
    "shows the ADLM goal next to the CLIA TEa",
    "the ADLM internal precision goal",
    "What is the ADLM half-TEa recommendation?",
    "the ADLM half-TEa convention",
    "ADLM suggests an internal goal",
    'className="x">Association for Diagnostics & Laboratory Medicine (ADLM)</a> recommends performance goals',
    "The Association for Diagnostics & Laboratory Medicine (ADLM) recommends using half",
    "half-TEa",
    "half TEa as an internal standard",
    "half of TEa for precision",
    "half of the CLIA TEa",
    "half of CLIA PT TEa",
    "half of the CLIA allowable error",
    "half the allowable error",
    "half of the\n    CLIA TEa",  # broken over two JSX lines
    "use\n  half-TEa",
    "the ADLM\n  internal goal",
    "TEa/2",
    "const adlmPct = (cliaError * 50).toFixed(1);",
    "const meetsAdlm = true;",
    "maxErr <= study.cliaAllowableError * 50",
    "maxErr <= cliaError * 0.5",
    "Quality Management Guidelines for Clinical Laboratories",
    "Laboratory Medicine. (2024). Quality Management Guidelines.",
    '<a href="https://www.adlm.org" target="_blank">adlm.org</a>',
]
# Real, unrelated uses: these must not fail, or people would learn to skip the check.
LEAVES_ALONE = [
    'name: "ADLM Learning Lab (formerly AACC)",',
    'url: "https://myadlm.org/education/learning-lab",',
    'source: "CAP Q-Probes 2014; AACC/ADLM 2020",',
    'source: "AACC/ADLM POCT Guidance 2020",',
    'title: "ADLM/AACC Critical Values Consensus Statement",',
    'publisher: "Association for Diagnostics and Laboratory Medicine (ADLM)",',
    "the AACC (now ADLM) Annual Meeting & Clinical Lab Expo, and the AMP Annual Meeting",
    "//     Clinical Chemistry; CLSI EP09 worked examples; ADLM guidance",
    "Use half the censoring threshold for the math.",
    "Substitute LLD/2 (Helsel)",
    "Lab-Set Internal Goal",
    "a medical director or designee-set internal goal",
    "CLIA sets no internal goal; the laboratory sets its own criterion. Some laboratories budget a fraction of allowable total error for a given study, and rules of thumb differ: Westgard uses one-third of TEa for bias on calibration verification, and Data Innovations recommends 25 to 50 percent for systematic error. The medical director or designee decides and should document why.",
    "const interceptInterp = Math.abs(interceptVal) < cliaError * 100 * 0.1",
    "if SD <= absolute_floor / 2",
    "on behalf of the organization",
]

failures = 0


def run(text, rel):
    """Run the real check_file on a scratch file that the audit is told lives at rel."""
    audit.ERRORS.clear()
    suffix = os.path.splitext(rel)[1]
    with tempfile.NamedTemporaryFile("w", suffix=suffix, delete=False, encoding="utf-8", dir=HERE) as f:
        f.write(text + "\n")
        path = f.name
    try:
        audit.check_file(rel, path)
    finally:
        os.remove(path)
    return [e for e in audit.ERRORS if "ADLM half-TEa claim" in e]


def report(ok, label, text):
    global failures
    failures += 0 if ok else 1
    print(f"{'PASS' if ok else 'FAIL'}  {label}  :: {' '.join(text.split())[:110]}")


for text in BITES:
    report(len(run(text, "client/src/pages/Fake.tsx")) >= 1, "fails the audit", text)
for text in LEAVES_ALONE:
    report(len(run(text, "client/src/pages/Fake.tsx")) == 0, "left alone", text)

phrase = "ADLM-recommended internal goal"
for rel, want in [
    ("client/src/pages/Fake.tsx", 1),
    ("client/src/lib/fake.ts", 1),
    ("server/fake.ts", 1),
    ("shared/fake.ts", 1),
    ("client/public/fake.txt", 1),  # a plain-text file takes the marks-only path through check_file; this check runs first
    ("server/fake.json", 1),
    ("server/fake.mjs", 1),
    ("CLAUDE.md", 0),               # the rule itself names the claim
    ("scripts/fake.ts", 0),
    ("docs/receipts/fake.md", 0),
]:
    got = len(run(phrase, rel))
    report(got == want, f"{rel}: {want} expected, {got} found", phrase)

found = run("first line\nsecond line\nADLM goal on line three", "server/fake.ts")
report(len(found) == 1 and "[server/fake.ts:3]" in found[0], "names the file and line", found[0] if found else "nothing found")

# The tree as it stands. Walks every file under the three folders, including any collect_files() skips by name.
audit.ERRORS.clear()
scanned = 0
for top in ("client", "server", "shared"):
    for root, dirs, files in os.walk(os.path.join(ROOT, top)):
        dirs[:] = [d for d in dirs if d not in audit.SKIP_DIRS]
        for fname in files:
            if os.path.splitext(fname)[1].lower() not in audit.SCAN_EXTENSIONS:
                continue
            fpath = os.path.join(root, fname)
            rel = os.path.relpath(fpath, ROOT).replace("\\", "/")
            with open(fpath, "r", encoding="utf-8", errors="replace") as f:
                audit.check_adlm_claim(rel, f.read())
            scanned += 1
print(f"\nScanned {scanned} files under client, server and shared.")
for e in audit.ERRORS:
    print(f"  {e}")
report(not audit.ERRORS and scanned > 500, f"the tree is clean ({len(audit.ERRORS)} found)", "client, server, shared")

print("\nALL PASS" if not failures else f"\n{failures} FAILED")
sys.exit(1 if failures else 0)
