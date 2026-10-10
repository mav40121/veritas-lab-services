"""BUG-013 (Michael Q49 = 1, 2026-10-09): correct the CFR excerpts inside the per-lab house-format policy DOCX
stored in VeritaPolicy (veritapolicy_lab_artifacts: San Carlos lab 2, Troy lab 17), without regenerating them.

For each stored DOCX:
  1. Find the References run sequence "Federal Regulations: ... Verbatim Excerpts: ..." up to "Accreditor Crosswalk:".
  2. Parse it and prove the format is understood: rebuilding the parsed items must reproduce the original XML
     byte for byte, or the file is skipped and reported.
  3. Rebuild it from the corrected template's cfr_text_blocks (exact eCFR text, corrected citations and labels).
  4. Apply the in-text citation fixes (apply_intext_citations.EDITS for that template) to the policy body only
     (text before the References block); the letterhead, crosswalk and everything else stay as they are.
  5. Check: the XML parses, every corrected quote is present, and no quote from the old set that was not CFR text remains.
Writes the patched DOCX (same filenames) and one ZIP per lab for the admin bulk upload. Nothing is uploaded here.

Usage: python patch_lab_artifacts.py <snapshot.db> <out_dir>
"""
import io, json, os, re, sqlite3, sys, zipfile
from xml.dom import minidom
from xml.sax.saxutils import escape

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from apply_intext_citations import EDITS, EDITS2, EDITS3, EDITS4  # noqa: E402

DATA = os.path.join(os.path.dirname(os.path.dirname(HERE)), "server", "policyTemplates", "data")
T = lambda s: f'<w:r><w:t xml:space="preserve">{s}</w:t></w:r>' if s else "<w:r><w:t/></w:r>"
BR = "<w:r><w:br/></w:r>"
X = lambda s: escape(s, {'"': "&quot;", "'": "&apos;"})


def build(blocks):
    """The References run sequence for a list of {citation, label, verbatim}, in the artifacts' own format."""
    out = [T("Federal Regulations:"), BR]
    for k, b in enumerate(blocks, 1):
        out += [T(X(f"  {k}. {b['citation']}: {b['label']}")), BR]
    out += [T(""), BR, T("Verbatim Excerpts:"), BR]
    for b in blocks:
        out += [T(X(f"  {b['citation']}")), BR, T(X(f'  "{b["verbatim"]}"')), BR, T(""), BR]
    return "".join(out)


def parse(seg):
    """Inverse of build() for an existing artifact: -> list of {citation, label, verbatim}."""
    texts = [m.group(1) if m.group(1) is not None else "" for m in re.finditer(r'<w:r><w:t(?: xml:space="preserve")?>(.*?)</w:t></w:r>|<w:r><w:t/></w:r>', seg)]
    un = lambda s: s.replace("&quot;", '"').replace("&apos;", "'").replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")
    texts = [un(t) for t in texts]
    i = texts.index("Verbatim Excerpts:")
    items = [re.match(r"\s*\d+\.\s(.*?):\s(.*)$", t) for t in texts[1:i] if t]
    ex = [t for t in texts[i + 1:] if t]
    blocks = []
    for n, m in enumerate(items):
        q = ex[2 * n + 1].strip()
        blocks.append({"citation": m.group(1), "label": m.group(2), "verbatim": q[1:-1] if q.startswith('"') and q.endswith('"') else q})
    return blocks


def main():
    snap, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    db = sqlite3.connect(snap)
    rows = db.execute("select lab_id, policy_id, filename, docx_blob from veritapolicy_lab_artifacts order by lab_id, cast(policy_id as int)").fetchall()
    tmpl = {}
    for f in os.listdir(DATA):
        if f.endswith(".json"):
            d = json.load(open(os.path.join(DATA, f), encoding="utf-8"))
            tmpl[str(d["policy_id"])] = (f, d)
    edits_for = {}
    for e in EDITS + EDITS2 + EDITS3 + EDITS4:
        edits_for.setdefault(e[0], []).append(e)
    report, zips = [], {}
    for lab, pid, fn, blob in rows:
        z = zipfile.ZipFile(io.BytesIO(blob))
        xml = z.read("word/document.xml").decode("utf-8")
        a = xml.find(T("Federal Regulations:"))
        b = xml.find(T("Accreditor Crosswalk:"), a)
        if a < 0 or b < 0:
            report.append((lab, fn, "SKIP: no References block found")); continue
        seg = xml[a:b]
        old = parse(seg)
        if build(old) != seg:
            report.append((lab, fn, "SKIP: References format not understood (round-trip differs)")); continue
        tf, td = tmpl[str(pid)]
        new_seg = build(td["cfr_text_blocks"])
        body, tail = xml[:a], xml[b:]
        changed_intext = 0
        for _, oldt, rep, n, _why in edits_for.get(tf, []):
            if isinstance(oldt, re.Pattern):
                cnt = len(oldt.findall(body)); body = oldt.sub(X(rep), body)
            else:
                cnt = body.count(X(oldt)); body = body.replace(X(oldt), X(rep))
            changed_intext += cnt
        new_xml = body + new_seg + tail
        minidom.parseString(new_xml.encode("utf-8"))  # must still be well-formed XML
        plain = re.sub(r"<[^>]+>", "", new_xml).replace("&quot;", '"').replace("&apos;", "'").replace("&amp;", "&")
        missing = [blk["citation"] for blk in td["cfr_text_blocks"] if blk["verbatim"][:120] not in plain]
        new_texts = [blk["verbatim"] for blk in td["cfr_text_blocks"]]
        # stale = an old quote still printed that is not part of any corrected (exact eCFR) text
        stale = [o["citation"] for o in old if o["verbatim"] in plain and not any(o["verbatim"] in t for t in new_texts)]
        if missing or stale:
            report.append((lab, fn, f"FAIL: missing {missing} stale {stale}")); continue
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as w:
            for item in z.infolist():
                w.writestr(item, new_xml.encode("utf-8") if item.filename == "word/document.xml" else z.read(item.filename))
        lab_dir = os.path.join(out_dir, f"lab{lab}")
        os.makedirs(lab_dir, exist_ok=True)
        open(os.path.join(lab_dir, fn), "wb").write(buf.getvalue())
        zips.setdefault(lab, []).append(fn)
        diff = sum(1 for o, nb in zip(old, td["cfr_text_blocks"]) if o != {k: nb[k] for k in ("citation", "label", "verbatim")}) + abs(len(old) - len(td["cfr_text_blocks"]))
        report.append((lab, fn, f"OK: {len(old)} -> {len(td['cfr_text_blocks'])} excerpts, {diff} changed; in-text citations fixed {changed_intext}"))
    for lab, files in zips.items():
        zp = os.path.join(out_dir, f"lab{lab}_VeritaPolicy_CFR_corrected_2026-10-09.zip")
        with zipfile.ZipFile(zp, "w", zipfile.ZIP_DEFLATED) as w:
            for f in files:
                w.write(os.path.join(out_dir, f"lab{lab}", f), f)
        print(f"lab {lab}: {len(files)} documents -> {zp}")
    for r in report:
        print(*r, sep=" | ")
    json.dump(report, open(os.path.join(out_dir, "patch_report.json"), "w", encoding="utf-8"), indent=1)


if __name__ == "__main__":
    main()
