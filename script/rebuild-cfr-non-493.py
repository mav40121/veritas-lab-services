"""
Source-ground the 21 CFR / 29 CFR / 45 CFR / 42 CFR 482-485 portions of
server/cfrRequirements.ts against the official eCFR XML.

This is the follow-up to PR #105 (which source-grounded 42 CFR Part 493).
The 74 remaining entries citing other CFR titles still carried agent-
paraphrased descriptions. This script replaces name + description with
verbatim eCFR text, standardizes the standard format, and updates
chapter_label to a real CFR Title/Part identifier.

Scope:
  - 43 entries citing 21 CFR (Parts 606, 610, 640 - blood bank cGMP)
  - 12 entries citing 29 CFR 1910.x (OSHA bloodborne pathogens, chemical hygiene)
  - 10 entries citing 45 CFR 164.x (HIPAA Security Rule)
  -  9 entries citing 42 CFR 482 / 483 (hospital and LTC Conditions of Participation)

Out of scope (already source-grounded by PR #105):
  - 42 CFR Part 493 entries (use "42 CFR §493.X" format with verbatim eCFR text)

Run:
    python script/rebuild-cfr-non-493.py
"""
import json
import re
import sys
import xml.etree.ElementTree as ET
import urllib.request
from pathlib import Path
from datetime import date

REPO_FILE = Path('server/cfrRequirements.ts')
ECFR_DATE = '2024-12-31'  # eCFR date constant; pick a stable past date present in eCFR data

# CFR parts to fetch and parse. Each entry: (title, part_or_subpart_marker, label_template)
# label_template builds the user-facing chapter_label per section using
# {part} substitution.
ECFR_PARTS = [
    ('21', '606', '21 CFR Part 606: Current Good Manufacturing Practice for Blood and Blood Components'),
    ('21', '610', '21 CFR Part 610: General Biological Products Standards'),
    ('21', '630', '21 CFR Part 630: Requirements for Blood and Blood Components for Transfusion or for Further Manufacturing Use'),
    ('21', '640', '21 CFR Part 640: Additional Standards for Human Blood and Blood Products'),
    ('29', '1910', '29 CFR Part 1910: OSHA Occupational Safety and Health Standards'),
    ('45', '164', '45 CFR Part 164: HIPAA Security and Privacy Rules'),
    ('42', '482', '42 CFR Part 482: Conditions of Participation for Hospitals'),
    ('42', '483', '42 CFR Part 483: Conditions for Long-Term Care Facilities'),
]


def fetch_part_xml(title, part, retries=3):
    """Fetch eCFR XML for a single (title, part) combination. Retries on
    transient IncompleteRead failures which the eCFR endpoint occasionally
    serves on larger parts."""
    import time
    url = f'https://www.ecfr.gov/api/versioner/v1/full/{ECFR_DATE}/title-{title}.xml?part={part}'
    last_err = None
    for attempt in range(retries):
        try:
            print(f'  Fetching {url} (attempt {attempt+1})', flush=True)
            req = urllib.request.Request(url, headers={'User-Agent': 'VeritasLabServices/1.0 (Source-Grounding Script)'})
            with urllib.request.urlopen(req, timeout=120) as resp:
                return resp.read()
        except Exception as e:
            last_err = e
            print(f'    attempt {attempt+1} failed: {e}', flush=True)
            time.sleep(2)
    raise last_err


def parse_part(xml_bytes, label):
    """Extract section_id -> {title, first_text} from eCFR XML.
    Returns dict keyed by section number (e.g. '606.100', '164.308').
    """
    root = ET.fromstring(xml_bytes)
    sections = {}
    for section in root.iter('DIV8'):
        if section.get('TYPE') != 'SECTION':
            continue
        section_id = section.get('N')  # e.g. "606.100"
        head_el = section.find('HEAD')
        if head_el is None:
            continue
        head_full = ''.join(head_el.itertext()).strip()
        # "§ 606.100 SOP requirements." -> "SOP requirements."
        title_text = re.sub(r'^§\s*\d+\.\d+[a-z]?\s*', '', head_full).strip().rstrip('.')

        # Pull first substantive paragraph
        paragraphs = []
        for p in section.iter('P'):
            txt = ' '.join(p.itertext()).strip()
            txt = re.sub(r'\s+', ' ', txt)
            if txt and len(txt) > 30:
                paragraphs.append(txt)
        if not paragraphs:
            for fp in section.iter('FP'):
                txt = ' '.join(fp.itertext()).strip()
                txt = re.sub(r'\s+', ' ', txt)
                if txt and len(txt) > 30:
                    paragraphs.append(txt)
        first_text = paragraphs[0] if paragraphs else ''

        sections[section_id] = {
            'title': title_text,
            'first_text': first_text,
            'label': label,
        }
    return sections


def truncate_clean(text, target=700):
    """Truncate at sentence boundary near target chars, append [...]"""
    if len(text) <= target:
        return text
    cut = target - 100
    next_period = text.find('. ', cut)
    if 0 < next_period < target + 50:
        return text[:next_period + 1].rstrip() + ' [...]'
    return text[:target].rstrip() + ' [...]'


def main():
    print(f'Fetching eCFR data for {len(ECFR_PARTS)} parts...')
    all_sections = {}  # section_number -> {title, first_text, label}
    for title, part, label in ECFR_PARTS:
        try:
            xml_data = fetch_part_xml(title, part)
            sections = parse_part(xml_data, label)
            all_sections.update(sections)
            print(f'    Title {title} Part {part}: {len(sections)} sections parsed')
        except Exception as e:
            print(f'    FAILED Title {title} Part {part}: {e}', file=sys.stderr)
            return 1

    print(f'\nTotal eCFR sections loaded: {len(all_sections)}')

    # ─── Read repo file ─────────────────────────────────────────────────
    src = REPO_FILE.read_text(encoding='utf-8')

    # ─── Extract entries (each entry is one line) ───────────────────────
    # The entries have accreditor cross-refs appended. Find each entry
    # by its opening `{"id":` and matching closing `}`. Then JSON-parse it.
    entries = []
    line_offsets = []
    for line in src.split('\n'):
        if line.lstrip().startswith('{"id":'):
            # Strip trailing comma if present
            body = line.strip()
            if body.endswith(','):
                body = body[:-1]
            try:
                obj = json.loads(body)
                entries.append(obj)
                line_offsets.append(line)
            except json.JSONDecodeError as e:
                print(f'JSON parse error on line: {body[:100]}... ({e})', file=sys.stderr)

    print(f'Parsed {len(entries)} entries from cfrRequirements.ts')

    # ─── Identify non-493 entries to update ────────────────────────────
    # Pattern matches:
    #   "21 CFR 606.151", "29 CFR 1910.1030", "45 CFR 164.308", "42 CFR 482.13"
    # Does NOT match:
    #   "42 CFR §493.X" (already source-grounded)
    non_493_pat = re.compile(r'^(21|29|45|42) CFR\s+(\d+)\.(\d+(?:\([a-z0-9]+\))*)')

    updated = 0
    skipped_already_grounded = 0
    missing = []
    for e in entries:
        std = e.get('standard', '')
        m = non_493_pat.match(std)
        if not m:
            skipped_already_grounded += 1
            continue
        title, part, section_qualifier = m.group(1), m.group(2), m.group(3)
        # Strip paragraph qualifier for section lookup
        base_section = section_qualifier.split('(')[0]
        section_id = f'{part}.{base_section}'
        if section_id not in all_sections:
            missing.append((e['id'], std))
            continue
        sec = all_sections[section_id]
        # Update fields
        # Standardize standard format with §
        paragraph_qual = section_qualifier[len(base_section):]
        e['standard'] = f'{title} CFR §{section_id}{paragraph_qual}'
        e['name'] = sec['title']
        e['description'] = truncate_clean(sec['first_text'], 700)
        e['chapter_label'] = sec['label']
        # Update chapter slug to a clean, non-leaky form
        e['chapter'] = f'CFR_Title{title}_Part{part}'
        updated += 1

    print(f'\nUpdated: {updated} entries')
    print(f'Skipped (already source-grounded 42 CFR §493 entries + 42 CFR 416 etc.): {skipped_already_grounded}')
    print(f'Missing in eCFR (likely section number drift or fabricated): {len(missing)}')
    for eid, std in missing[:10]:
        print(f'  id={eid}  standard={std!r}')

    # ─── Write entries back ─────────────────────────────────────────────
    # Reuse the original structure: header comment + export const + entries
    # Reproduce the existing top-of-file header but bump the issue date.
    header = (
        '// Auto-generated from eCFR + master citation index -- DO NOT EDIT MANUALLY\n'
        '// 42 CFR Part 493 portion rebuilt 2026-05-11 against official eCFR XML\n'
        '//   https://www.ecfr.gov/api/versioner/v1/full/2026-05-07/title-42.xml?part=493\n'
        f'// 21 CFR / 29 CFR / 45 CFR / 42 CFR 482-483 portions rebuilt {ECFR_DATE}\n'
        '// against eCFR XML for the respective titles (parts 606, 610, 640,\n'
        '// 1910, 164, 482, 483). Source-grounding applies the same verbatim\n'
        '// title + first-paragraph replacement that PR #105 applied to Part 493.\n'
        '// Accreditor cross-references (cap_ids, tjc_ids, cola_ids, aabb_ids) added\n'
        '// 2026-05-11 from the master citation index CFR_Crosswalk + CAP_Uncompressed\n'
        '// tabs (veritaassure_master_citation_index (12).xlsx). CFR is the spine;\n'
        '// the accreditor arrays are cross-references on each CFR row, not separate\n'
        '// rows. Empty arrays mean the master document has no accreditor mapping for\n'
        '// that CFR citation (CFR sections that are administrative-only or\n'
        '// out-of-scope for the supported accreditors).\n'
        '\n'
        'export const CFR_REQUIREMENTS = [\n'
    )

    # Preserve original order (don't re-sort; honor history)
    out_lines = [header]
    for e in entries:
        out_lines.append('  ' + json.dumps(e, ensure_ascii=False) + ',\n')
    out_lines.append('];\n')

    REPO_FILE.write_text(''.join(out_lines), encoding='utf-8', newline='\n')
    print(f'\nWritten: {REPO_FILE}')

    if missing:
        print('\nWARNING: Some entries cite CFR sections not found in eCFR.')
        print('Either the section is in a reserved/repealed range or the')
        print('citation was fabricated by an earlier agent. Review each.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
