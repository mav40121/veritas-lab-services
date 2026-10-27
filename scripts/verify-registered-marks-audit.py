# scripts/verify-registered-marks-audit.py
#
# Receipt for the trademark-symbol copy check in script/audit.py (Michael 2026-10-27: the USPTO registrations for
# VeritaAssure, VeritaMap, VeritaScan and VeritaCheck issued that day; those four carry the registered symbol and every
# other mark stays TM). Proves the check bites both ways, in every form the code uses, by running check_file on
# known lines in a scratch file.
# Run: python scripts/verify-registered-marks-audit.py
import importlib.util, os, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("audit", os.path.join(HERE, "..", "script", "audit.py"))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)

TM, REG, BS = "™", "®", "\\"
CASES = [
    # (line, expected number of trademark errors)
    (f"<h1>VeritaCheck{REG}</h1>", 0),
    (f"<h1>VeritaComp{TM}</h1>", 0),
    (f"<h1>VeritaCheck{TM}</h1>", 1),                       # registered mark with TM
    (f"<h1>VeritaComp{REG}</h1>", 1),                       # unregistered mark with the registered symbol
    (f'label: "VeritaMap{BS}u2122"', 1),                    # escape form
    (f'label: "VeritaStaff{BS}u00AE"', 1),                  # escape form, unregistered
    (f'<span>Linked to VeritaMap{{"{BS}u2122"}}</span>', 1),  # JSX escape form (the one the first pass missed)
    (f'<span>VeritaPace{{"{REG}"}}</span>', 1),             # JSX character form, unregistered
    ("<p>VeritaScan&trade; and VeritaAssure&#8482;</p>", 2), # HTML entities
    ("<p>VeritaLab&reg;</p>", 1),
    (f"<p>VeritaAssure{REG} suite with VeritaPT{TM}</p>", 0),
]

failures = 0
for line, want in CASES:
    audit.ERRORS.clear()
    with tempfile.NamedTemporaryFile("w", suffix=".tsx", delete=False, encoding="utf-8", dir=HERE) as f:
        f.write(line + "\n")
        path = f.name
    try:
        audit.check_file(os.path.basename(path), path)
    finally:
        os.remove(path)
    got = sum(1 for e in audit.ERRORS if "registered" in e.lower())
    ok = got == want
    failures += 0 if ok else 1
    print(f"{'PASS' if ok else 'FAIL'}  {want} expected, {got} found  :: {line}")

print("\nALL PASS" if not failures else f"\n{failures} FAILED")
sys.exit(1 if failures else 0)
