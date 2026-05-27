"""
One-time: take SCAHC's empty policy template (.docx) and add docxtemplater
{{tag}} markers in place of the literal "Enter X" placeholders so we can
fill it programmatically from VeritaPolicy JSON templates.

Input:  server/policyTemplates/lab_overlays/scahc.docx        (raw, untagged)
Output: server/policyTemplates/lab_overlays/scahc_tagged.docx (with tags)

The output is what scripts/generate_scahc_policies.js consumes.

We touch ONLY the placeholder text. SCAHC boilerplate (disclaimer,
responsibility, education, approval/responsibility, references heading,
header logo, footer page numbers) is preserved verbatim.
"""
import re
import zipfile
import shutil
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SRC = REPO / "server" / "policyTemplates" / "lab_overlays" / "scahc.docx"
DST = REPO / "server" / "policyTemplates" / "lab_overlays" / "scahc_tagged.docx"

# Map: literal text in SCAHC template  ->  docxtemplater placeholder.
# Order matters when one phrase is a prefix of another; longer first.
REPLACEMENTS = [
    # Identity table cells (in document order):
    ("Enter if applicable, ex. MM.07.03.01; NPSG.06.01.03", "{tjc_reference}"),
    # PURPOSE
    ("Enter purpose statement", "{purpose}"),
    # POLICY
    ("Enter policy statement – no outlining is required if only one paragraph", "{policy_text}"),
    # PROCEDURE: SCAHC's original was "Enter procedure steps as indicated in SCAHC Policy & Procedure Development section C-10"
    # which is author-guidance text, not actual procedure content. Replace the whole thing with our tag.
    ("Enter procedure", "{procedure_text}"),
    # The identity table's "Title" cell currently reads "Policy Name" as a literal value (twice — once in body, once in footer).
    # We only want to replace the BODY occurrence, NOT the footer one (the footer fires on every page and "Policy Name" is the literal header label there).
    # docxtemplater can't selectively edit just one occurrence via simple substitution. We handle by editing only the body section, not footer1.xml.
    ("Policy Name", "{policy_name}"),
]


def tag_xml(xml: str) -> tuple[str, list[tuple[str, bool]]]:
    """Return (new_xml, results) where results is list of (replacement, was_applied)."""
    results = []
    for src_text, tag in REPLACEMENTS:
        # docx splits text across <w:t> runs sometimes — but the SCAHC
        # placeholders we identified all appear in single <w:t> elements
        # (confirmed by reading the extracted text earlier).
        if src_text in xml:
            xml = xml.replace(src_text, tag)
            results.append((f"{src_text!r}  ->  {tag}", True))
        else:
            results.append((f"{src_text!r}  ->  NOT FOUND", False))
    return xml, results


def main():
    if not SRC.exists():
        raise SystemExit(f"Source template missing: {SRC}")

    # Re-zip the docx with the modified document.xml. footer1.xml is left untouched.
    shutil.copy2(SRC, DST)
    # Read all entries
    with zipfile.ZipFile(SRC, "r") as zin:
        entries = {name: zin.read(name) for name in zin.namelist()}

    # Edit body XML
    doc_xml = entries["word/document.xml"].decode("utf-8")
    new_doc_xml, results = tag_xml(doc_xml)

    # XML-level cleanup of SCAHC author-guidance leftovers that can't be removed
    # with simple find-replace because they're split across multiple <w:r> runs.

    # (a) Strip the trailing " steps as indicated in SCAHC Policy & Procedure
    #     Development section C-10" runs from the procedure list-item paragraph.
    #     After tagging, that paragraph has 3 runs: {procedure_text} / space / tail.
    #     We delete the space + tail runs, leaving the paragraph as just our content.
    c10_pattern = re.compile(
        r'(<w:r><w:rPr><w:spacing w:val="-4"/></w:rPr><w:t xml:space="preserve"> </w:t></w:r>)'
        r'<w:r><w:t>steps as indicated in SCAHC Policy &amp; Procedure Development section C-10</w:t></w:r>'
    )
    c10_count = len(c10_pattern.findall(new_doc_xml))
    new_doc_xml = c10_pattern.sub("", new_doc_xml)
    results.append((f"strip C-10 author-guidance tail ({c10_count} match)", c10_count > 0))

    # (b) Delete entire <w:p>...</w:p> paragraphs containing "Subtext" -- these
    #     are SCAHC's example sub-bullets the original human author would replace.
    #     The \b word boundary after w:p stops the regex from matching <w:pPr> too.
    #     The (?:</w:p>)?  is to handle paragraphs without nested w:p.
    subtext_pattern = re.compile(r'<w:p\b[^>]*>(?:(?!<w:p\b).)*?<w:t>Subtext</w:t>.*?</w:p>', re.DOTALL)
    subtext_count = len(subtext_pattern.findall(new_doc_xml))
    new_doc_xml = subtext_pattern.sub("", new_doc_xml)
    results.append((f"delete Subtext example paragraphs ({subtext_count} matches)", subtext_count > 0))

    entries["word/document.xml"] = new_doc_xml.encode("utf-8")

    # Also tag footer's "Policy Name" so each page shows the current policy title
    if "word/footer1.xml" in entries:
        ftr_xml = entries["word/footer1.xml"].decode("utf-8")
        ftr_changes = 0
        if "Policy Name" in ftr_xml:
            ftr_xml = ftr_xml.replace("Policy Name", "{policy_name}")
            ftr_changes += 1
        entries["word/footer1.xml"] = ftr_xml.encode("utf-8")
        results.append((f"footer 'Policy Name'  ->  {{policy_name}} ({ftr_changes} replacement)", ftr_changes > 0))

    # Re-pack with same compression
    with zipfile.ZipFile(DST, "w", compression=zipfile.ZIP_DEFLATED) as zout:
        for name, data in entries.items():
            zout.writestr(name, data)

    print(f"Wrote {DST}")
    print()
    print("Replacements applied:")
    for label, ok in results:
        mark = "OK" if ok else "MISS"
        print(f"  [{mark}] {label}")
    misses = [r for r in results if not r[1]]
    if misses:
        raise SystemExit(f"\nFATAL: {len(misses)} placeholder(s) not found in SCAHC template")


if __name__ == "__main__":
    main()
