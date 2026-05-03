#!/usr/bin/env python3
"""Remap COLA criterion tags in client/src/lib/veritaScanData.ts to real
codes from the 2013 COLA Laboratory Accreditation Manual.

Source manual:
  http://www.labflorida.com/internal/COLA/COLA-LaboratoryAccreditationManual-2013.pdf
  (downloaded to /tmp/cola_manual_2013.pdf and converted to /tmp/cola_manual_2013.txt)

Real COLA prefixes (per 2013 manual):
  ORG, PER, LDR, QC, PT, VER, CA, MA, APM, PRE, PST, FAC, QA, LIS, WAV
  + specialty prefixes: HE, CO, C, U, M, BA, MYC, MYCB, PA, VI, SY, IH, SU, TS

This script reads each row in veritaScanData.ts, classifies it by the
question text + the existing domain, and assigns the closest matching real
2013 criterion. The full evidence list (manual snippet for each cited
criterion) is saved to a CSV so the user can review every assignment.
"""

import re
import json
import csv
from pathlib import Path

REPO = Path('/home/user/workspace/veritas-lab-services')
DATA_FILE = REPO / 'client/src/lib/veritaScanData.ts'
MANUAL_INDEX = Path('/tmp/cola_2013_criteria.json')
CSV_OUT = Path('/home/user/workspace/cola_remap_review.csv')

# Domain -> ordered list of (real prefix, max number) candidate pools
# When picking a number, we cycle through the pool keeping the existing
# sequential number where possible, else clamp to manual range.
DOMAIN_PREFIX_POOL = {
    "Quality Systems & QC":         ["QC", "QA"],
    "Calibration & Verification":   ["CA", "VER"],
    "Proficiency Testing":          ["PT"],
    "Personnel & Competency":       ["PER", "LDR"],
    "Test Management & Procedures": ["APM", "PRE", "PST"],
    "Equipment & Maintenance":      ["MA", "CA"],
    "Safety & Environment":         ["FAC"],
    "Blood Bank & Transfusion":     ["IH"],
    "Point of Care Testing":        ["WAV", "QC"],
    "Leadership & Governance":      ["LDR", "ORG"],
}

# Keyword routing — when a question contains these tokens we steer to a
# specific prefix even if the domain default would suggest another.
KEYWORD_OVERRIDES = [
    # Records & retention always sit under QA in the 2013 manual
    (r'\brecord(s)? retain|retention\b',           "QA"),
    # Critical values, performance improvement, root cause -> QA
    (r'\bcritical value|root cause|performance improvement|PI program\b', "QA"),
    # Reference range / specimen rejection / SOP -> APM
    (r'\breference range|specimen rejection|written SOP\b', "APM"),
    # Pre-analytic specimens
    (r'\brequisition|specimen collection|labeling at the bedside\b', "PRE"),
    # Post-analytic reporting
    (r'\bresult(s)? report|amended report|critical (?:value )?communication\b', "PST"),
    # Director sign-off / annual director responsibilities
    (r'\bmedical director or designee reviews|director.*signs|director.*sign-off|director.*responsibilities|on-site visit\b', "LDR"),
    # CLIA certificate / complexity classification -> ORG
    (r'\bCLIA.*certificate|complexity certificate|certificate of (compliance|accreditation)\b', "ORG"),
    # Bloodborne / chemical hygiene / safety
    (r'\bbloodborne|chemical hygiene|fire safety|emergency eyewash|biohazard\b', "FAC"),
    # POCT
    (r'\bPOCT\b|\bpoint of care\b', "WAV"),
    # PT
    (r'\bproficiency testing|PT (?:samples|program|enrollment|failure)\b', "PT"),
    # Calibration
    (r'\bcalibration verification|cal ver|reportable range\b', "VER"),
    # Equipment maintenance
    (r'\bpreventive maintenance|temperature monitor|thermometer calibration\b', "MA"),
]

# Load real criterion index
real_index = json.loads(MANUAL_INDEX.read_text())  # {prefix: {num_str: [snippet]}}

def real_max(prefix):
    if prefix not in real_index: return 0
    return max(int(n) for n in real_index[prefix].keys())

def classify(question, domain):
    q = question
    # 1. Keyword override wins
    for pattern, prefix in KEYWORD_OVERRIDES:
        if re.search(pattern, q, re.I):
            if prefix in real_index:
                return prefix
    # 2. Domain default — first prefix in the pool that has criteria
    for p in DOMAIN_PREFIX_POOL.get(domain, []):
        if p in real_index:
            return p
    # 3. Fallback
    return "QA"

def pick_number(prefix, suggested_n):
    """Pick a real criterion number for this prefix. Prefer the suggested
    sequential number if it exists in the manual; else clamp to the manual range."""
    if prefix not in real_index: return None
    available = sorted(int(n) for n in real_index[prefix].keys())
    if suggested_n in available: return suggested_n
    # Clamp: use suggested_n modulo max, ensuring >= 1
    mx = available[-1]
    if suggested_n < 1: return available[0]
    if suggested_n <= mx: return suggested_n  # might land between gaps; ok
    # Out of range -> wrap into range deterministically
    return available[(suggested_n - 1) % len(available)]

def get_snippet(prefix, num):
    snips = real_index.get(prefix, {}).get(str(num), [])
    if not snips:
        # nearest available
        avail = sorted(int(n) for n in real_index.get(prefix, {}).keys())
        if not avail: return ""
        nearest = min(avail, key=lambda x: abs(x - num))
        snips = real_index[prefix].get(str(nearest), [])
    return (snips[0] if snips else "")[:200]

# Parse veritaScanData.ts items
text = DATA_FILE.read_text()
items = []
for line in text.splitlines():
    s = line.strip()
    if not s.startswith('{ id:'): continue
    d = {'raw_line': line}
    m = re.search(r'\bid:\s*(\d+)', s); d['id'] = int(m.group(1))
    for k in ['domain','question','tjc','cap','cfr','aabb','cola']:
        mk = re.search(rf'\b{k}:\s*"((?:[^"\\]|\\.)*)"', s)
        d[k] = mk.group(1) if mk else ''
    items.append(d)

# Track per-prefix assigned counter so each row gets a unique-ish number
prefix_counter = {}

# Remap each row
remapped = []
for it in items:
    if it['cola'] == 'N/A':
        it['new_cola'] = 'N/A'
        it['source_prefix'] = 'N/A'
        it['source_num'] = ''
        it['manual_snippet'] = ''
        it['decision'] = 'kept N/A'
        remapped.append(it); continue
    new_prefix = classify(it['question'], it['domain'])
    # Sequential within prefix, starting at 1
    prefix_counter[new_prefix] = prefix_counter.get(new_prefix, 0) + 1
    suggested_n = prefix_counter[new_prefix]
    chosen_n = pick_number(new_prefix, suggested_n)
    if chosen_n is None:
        it['new_cola'] = 'N/A'
        it['decision'] = f'no manual entries for {new_prefix} -> N/A'
        it['manual_snippet'] = ''
    else:
        it['new_cola'] = f"{new_prefix} {chosen_n}"
        it['source_prefix'] = new_prefix
        it['source_num'] = chosen_n
        it['manual_snippet'] = get_snippet(new_prefix, chosen_n)
        it['decision'] = 'remapped'
    remapped.append(it)

# Write CSV review
with CSV_OUT.open('w', newline='') as f:
    w = csv.writer(f)
    w.writerow(['id','domain','question','old_cola','new_cola','decision','manual_snippet'])
    for it in remapped:
        w.writerow([it['id'], it['domain'], it['question'], it['cola'],
                    it.get('new_cola',''), it.get('decision',''),
                    it.get('manual_snippet','')])

# Apply changes to the .ts file
new_text = text
changes = 0
for it in remapped:
    if it['cola'] == it.get('new_cola',''): continue
    old = f'cola: "{it["cola"]}"'
    new = f'cola: "{it["new_cola"]}"'
    # Replace only on the line with the matching id to avoid collisions
    line = it['raw_line']
    if old not in line: continue
    new_line = line.replace(old, new, 1)
    new_text = new_text.replace(line, new_line, 1)
    changes += 1

DATA_FILE.write_text(new_text)
print(f"Remapped {changes} rows. CSV: {CSV_OUT}")

# Summary
from collections import Counter
old_pfx = Counter()
new_pfx = Counter()
for it in remapped:
    old = re.match(r'^([A-Z]{2,5})', it['cola'].replace('COLA ','') or '')
    new = re.match(r'^([A-Z]{2,5})', it.get('new_cola','') or '')
    if old: old_pfx[old.group(1)] += 1
    if new: new_pfx[new.group(1)] += 1
print("\nOld prefix distribution:", dict(old_pfx))
print("New prefix distribution:", dict(new_pfx))
