"""
Post-rebuild cleanup:
1. Remap id 4080 (cites fictitious "42 CFR 493.69" — section doesn't exist)
   to its real eCFR section 42 CFR §493.553 (Approval process for
   accreditation organizations), which matches its description.
2. Replace em-dashes with hyphens in all descriptions per CLAUDE.md §3.
   eCFR text contains verbatim em-dashes (e.g., "§ 493.2 As used in this
   part, unless the context indicates otherwise—") that must be normalized
   for our stored copy.
"""
import re

REPO_FILE = r'C:\Users\veril\projects\veritas-lab-services\server\cfrRequirements.ts'
PART493_XML = r'C:/Users/veril/AppData/Local/Temp/part493.xml'

# Get text of 493.553 from eCFR
import xml.etree.ElementTree as ET
tree = ET.parse(PART493_XML)
section_553 = None
for s in tree.getroot().iter('DIV8'):
    if s.get('TYPE') == 'SECTION' and s.get('N') == '493.553':
        section_553 = s
        break

assert section_553 is not None, '493.553 missing from eCFR XML'
head = ''.join(section_553.find('HEAD').itertext()).strip()
title = re.sub(r'^§\s*\d+\.\d+\s*', '', head).strip().rstrip('.')
paragraphs = [
    ''.join(p.itertext()).strip()
    for p in section_553.iter('P')
    if ''.join(p.itertext()).strip()
]
text = next((p for p in paragraphs if len(p) > 30), paragraphs[0] if paragraphs else '')
if len(text) > 700:
    cut = 600
    np = text.find('. ', cut)
    cut = np + 1 if 0 < np < 750 else 700
    text = text[:cut].rstrip() + ' [...]'

# Read repo file
with open(REPO_FILE, 'r', encoding='utf-8') as f:
    src = f.read()

# Replace id 4080 entry. Match the full single-line entry.
def escape_for_json(t):
    return t.replace('\\', '\\\\').replace('"', '\\"').replace('\n', ' ')

new_4080 = (
    f'  {{"id": 4080, "chapter": "CFR_Part493_Subpart_E", '
    f'"chapter_label": "42 CFR Part 493 Subpart E: Accreditation by a Private, Nonprofit Accreditation Organization", '
    f'"standard": "42 CFR §493.553", '
    f'"name": "{escape_for_json(title)}", '
    f'"description": "{escape_for_json(text)}", '
    f'"service_line": "all", "source": "cfr"}},'
)

src = re.sub(
    r'\{"id":\s*4080,[^}]*\}\s*,',
    new_4080,
    src,
    count=1,
)
print('Remapped id 4080 to 42 CFR §493.553')

# Now replace em-dashes (U+2014) and en-dashes (U+2013) with hyphens.
# Only inside description strings? Safer: globally on the data file content,
# since the file shouldn't contain em-dashes in any field per CLAUDE.md §3.
before_em = src.count('—')
before_en = src.count('–')
src = src.replace('—', '-').replace('–', '-')
print(f'Replaced em-dashes: {before_em}')
print(f'Replaced en-dashes: {before_en}')

with open(REPO_FILE, 'w', encoding='utf-8', newline='\n') as f:
    f.write(src)
print('Saved.')
