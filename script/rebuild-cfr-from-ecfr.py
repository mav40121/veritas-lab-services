"""
Rebuild the 42 CFR Part 493 portion of server/cfrRequirements.ts against the
official eCFR XML.

Strategy:
1. Parse eCFR Part 493 XML; extract every section (220 total) with its
   subpart, title (HEAD), and text body.
2. For each existing repo entry that cites "42 CFR 493":
   - Parse the section number (strip paragraph parts like (d)(2)).
   - Look up in eCFR.
   - Replace `name` with the section's authoritative title.
   - Replace `description` with the eCFR title + first paragraph (verbatim
     where short enough; truncated cleanly to ~600 chars when longer).
   - Replace `chapter` / `chapter_label` with the real Subpart name.
   - Standardize `standard` format to "42 CFR §493.X".
3. Entries that cite paragraph-level (e.g. "42 CFR 493.1256(d)(2)") preserve
   the paragraph qualifier but base description on the section's eCFR text.
4. Leave 21 CFR / 29 CFR / 45 CFR / 42 CFR 482-485 entries alone (out of
   scope for this rebuild; flagged for follow-up).
5. Repo entries citing CFR 493 sections that do NOT exist in eCFR are
   flagged (logged, not silently dropped) so the operator can review.
"""
import re
import json
import xml.etree.ElementTree as ET
from pathlib import Path

PART493_XML = r'C:/Users/veril/AppData/Local/Temp/part493.xml'
REPO_FILE = r'C:\Users\veril\projects\veritas-lab-services\server\cfrRequirements.ts'

# ─── Step 1: parse eCFR ──────────────────────────────────────────────────────
tree = ET.parse(PART493_XML)
root = tree.getroot()

# Subpart map: section_id → subpart_letter + subpart_label
sections = {}
for subpart in root.iter('DIV6'):
    if subpart.get('TYPE') != 'SUBPART':
        continue
    sp_letter = subpart.get('N')
    sp_head = subpart.find('HEAD')
    sp_label = ''
    if sp_head is not None:
        sp_label_full = ''.join(sp_head.itertext()).strip()
        # "Subpart A—General Provisions" -> "General Provisions"
        sp_label = re.sub(r'^Subpart [A-Z]+[—-]', '', sp_label_full).strip()
    for section in subpart.iter('DIV8'):
        if section.get('TYPE') != 'SECTION':
            continue
        section_id = section.get('N')  # e.g. "493.1256"
        head_el = section.find('HEAD')
        if head_el is None:
            continue
        head_full = ''.join(head_el.itertext()).strip()
        # "§ 493.1256 Standard: Control procedures." -> "Standard: Control procedures."
        title = re.sub(r'^§\s*\d+\.\d+\s*', '', head_full).strip().rstrip('.')

        # Pull first paragraph or two of section text
        paragraphs = []
        for p in section.iter('P'):
            txt = ''.join(p.itertext()).strip()
            if txt:
                paragraphs.append(txt)
        for fp in section.iter('FP'):
            txt = ''.join(fp.itertext()).strip()
            if txt:
                paragraphs.append(txt)
        # First substantive paragraph (skip very short)
        first_text = ''
        for p in paragraphs:
            if len(p) > 30:
                first_text = p
                break
        if not first_text and paragraphs:
            first_text = paragraphs[0]

        sections[section_id] = {
            'title': title,
            'subpart_letter': sp_letter,
            'subpart_label': sp_label,
            'first_text': first_text,
        }

print(f'Parsed {len(sections)} sections from eCFR Part 493')

# ─── Step 2: read repo file ─────────────────────────────────────────────────
with open(REPO_FILE, 'r', encoding='utf-8') as f:
    src = f.read()

# Each entry is on one line. Use regex to extract entries.
# Pattern: {"id": <N>, "chapter": "...", "chapter_label": "...", "standard": "...", "name": "...", "description": "...", "service_line": "...", "source": "..."},
entry_pat = re.compile(
    r'\{"id":\s*(\d+),\s*'
    r'"chapter":\s*"([^"]*)",\s*'
    r'"chapter_label":\s*"([^"]*)",\s*'
    r'"standard":\s*"([^"]*)",\s*'
    r'"name":\s*"([^"]*)",\s*'
    r'"description":\s*"((?:[^"\\]|\\.)*)",\s*'
    r'"service_line":\s*"([^"]*)",\s*'
    r'"source":\s*"([^"]*)"\}'
)

entries = []
for m in entry_pat.finditer(src):
    entries.append({
        'id': int(m.group(1)),
        'chapter': m.group(2),
        'chapter_label': m.group(3),
        'standard': m.group(4),
        'name': m.group(5),
        'description': m.group(6),
        'service_line': m.group(7),
        'source': m.group(8),
        'match_span': m.span(),
    })

print(f'Parsed {len(entries)} entries from cfrRequirements.ts')

# ─── Step 3: classify + remap ───────────────────────────────────────────────
# Only touch 42 CFR 493 entries this pass.
section_cite_pat = re.compile(r'^42 CFR\s*§?\s*(493\.\d+(?:[a-z])?)(.*)$')
section_id_pat = re.compile(r'^(493\.\d+)')

remapped = 0
skipped_non_493 = 0
missing_in_ecfr = []
for e in entries:
    std = e['standard']
    m = section_cite_pat.match(std)
    if not m:
        # Not 42 CFR 493 — leave alone
        skipped_non_493 += 1
        continue
    section_num = m.group(1)
    paragraph_qual = m.group(2).strip()  # e.g. "(d)(2)"
    # Some standards stored as "42 CFR 493.1256(d)(2)" — strip the paragraph
    base_section_id = section_id_pat.match(section_num).group(1)
    if base_section_id not in sections:
        missing_in_ecfr.append((e['id'], std))
        continue
    sec = sections[base_section_id]
    # Standardize standard format
    if paragraph_qual:
        e['standard'] = f'42 CFR §{base_section_id}{paragraph_qual}'
    else:
        e['standard'] = f'42 CFR §{base_section_id}'
    # Replace name with eCFR title
    e['name'] = sec['title']
    # Replace description with verbatim eCFR text (cap at 700 chars on a clean
    # boundary). Always end with a citation pointer for traceability.
    text = sec['first_text']
    if len(text) > 700:
        # Cut on sentence boundary near 600
        cut = 600
        next_period = text.find('. ', cut)
        cut = next_period + 1 if 0 < next_period < 750 else 700
        text = text[:cut].rstrip() + ' [...]'
    e['description'] = text
    # Replace chapter / chapter_label with real Subpart
    e['chapter'] = f'CFR_Part493_Subpart_{sec["subpart_letter"]}'
    e['chapter_label'] = f'42 CFR Part 493 Subpart {sec["subpart_letter"]}: {sec["subpart_label"]}'
    remapped += 1

print(f'Remapped 42 CFR 493 entries: {remapped}')
print(f'Skipped non-493 entries (left alone): {skipped_non_493}')
print(f'Repo entries citing CFR 493 sections NOT in eCFR: {len(missing_in_ecfr)}')
if missing_in_ecfr:
    print('  First 10:')
    for eid, std in missing_in_ecfr[:10]:
        print(f'    id={eid}  standard={std!r}')

# ─── Step 4: write new file ─────────────────────────────────────────────────
# Reuse the same single-line-per-entry style.
def emit(e):
    # Escape backslashes and quotes in description for JSON-in-TS
    desc = e['description'].replace('\\', '\\\\').replace('"', '\\"').replace('\n', ' ')
    name = e['name'].replace('"', '\\"')
    chap_label = e['chapter_label'].replace('"', '\\"')
    return (
        f'  {{"id": {e["id"]}, "chapter": "{e["chapter"]}", '
        f'"chapter_label": "{chap_label}", "standard": "{e["standard"]}", '
        f'"name": "{name}", "description": "{desc}", '
        f'"service_line": "{e["service_line"]}", "source": "{e["source"]}"}},\n'
    )

# Sort: 42 CFR 493 sections first (by numeric order), then 21 CFR, then others
def sort_key(e):
    std = e['standard']
    if std.startswith('42 CFR') and '493' in std:
        m = re.search(r'493\.(\d+)', std)
        return (0, int(m.group(1)) if m else 99999, e['id'])
    if std.startswith('21 CFR'):
        return (1, 0, e['id'])
    if std.startswith('29 CFR'):
        return (2, 0, e['id'])
    if std.startswith('45 CFR'):
        return (3, 0, e['id'])
    if std.startswith('42 CFR'):
        return (4, 0, e['id'])
    return (9, 0, e['id'])

entries_sorted = sorted(entries, key=sort_key)

# Build the file
out_lines = [
    '// Auto-generated from eCFR + master citation index -- DO NOT EDIT MANUALLY\n',
    '// 42 CFR Part 493 portion rebuilt 2026-05-11 against official eCFR XML\n',
    '//   https://www.ecfr.gov/api/versioner/v1/full/2026-05-07/title-42.xml?part=493\n',
    '// 21 CFR / 29 CFR / 45 CFR / 42 CFR 482-485 entries preserved from prior\n',
    '// build pending similar source-grounded rebuild against their respective\n',
    '// eCFR endpoints. Source: 42 CFR Part 493 (public domain U.S. government work),\n',
    '// 21 CFR Parts 606/610/640, 29 CFR 1910, 45 CFR 164.\n',
    'export const CFR_REQUIREMENTS = [\n',
]
for e in entries_sorted:
    out_lines.append(emit(e))
out_lines.append('];\n')

with open(REPO_FILE, 'w', encoding='utf-8', newline='\n') as f:
    f.writelines(out_lines)

print(f'\nWritten: {REPO_FILE}')
print(f'Total entries: {len(entries_sorted)}')
print(f'42 CFR 493 entries remapped to eCFR: {remapped}')

# Audit notes
print()
print('=== Audit notes ===')
print(f'- {len(missing_in_ecfr)} entries cite CFR 493 sections that do not exist in eCFR.')
print(f'  These are likely either:')
print(f'    (a) reserved/repealed sections (e.g. Subpart G, L, N-P are reserved per eCFR structure)')
print(f'    (b) fabricated citations by the prior agent')
print(f'  Each is logged with id + standard above for operator review.')
