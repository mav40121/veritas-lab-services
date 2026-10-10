"""Swap the 'CFR:' line of the Accreditor Crosswalk in stored per-lab policy DOCX for the approved master-list
crosswalk (Michael Q52 = 1, 2026-10-09). Only that one text run changes; TJC/CAP/COLA lines, letterhead and layout
stay. Input: a folder per lab of DOCX (the corrected 10/9 set). Output: same filenames in <out>/labN plus a ZIP per
lab for the admin bulk upload. Nothing is uploaded here.
Usage: python patch_artifact_crosswalk.py <in_dir> <out_dir>"""
import glob, io, json, os, re, sys, zipfile
from xml.dom import minidom
from xml.sax.saxutils import escape

HERE = os.path.dirname(os.path.abspath(__file__))
X = lambda s: escape(s, {'"': "&quot;", "'": "&apos;"})


def main():
    src, out = sys.argv[1], sys.argv[2]
    after = json.load(open(os.path.join(HERE, "crosswalk_changes_2026-10-09.json"), encoding="utf-8"))["after"]
    for lab_dir in sorted(d for d in glob.glob(os.path.join(src, "lab*")) if os.path.isdir(d)):
        lab = os.path.basename(lab_dir)
        os.makedirs(os.path.join(out, lab), exist_ok=True)
        changed = same = 0
        files = sorted(glob.glob(os.path.join(lab_dir, "*.docx")))
        for f in files:
            pid = str(int(re.match(r"(?:[A-Za-z]+_)?(\d{1,3})_", os.path.basename(f)).group(1)))
            z = zipfile.ZipFile(f)
            xml = z.read("word/document.xml").decode("utf-8")
            a = xml.index("Accreditor Crosswalk:")
            m = re.compile(r'(<w:t xml:space="preserve">  CFR:  )(.*?)(</w:t>)').search(xml, a)
            if not m:
                raise SystemExit(f"{f}: no CFR crosswalk line")
            new = X(after[pid])
            same += m.group(2) == new
            changed += m.group(2) != new
            xml2 = xml[: m.start(2)] + new + xml[m.end(2):]
            minidom.parseString(xml2.encode("utf-8"))
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as w:
                for item in z.infolist():
                    w.writestr(item, xml2.encode("utf-8") if item.filename == "word/document.xml" else z.read(item.filename))
            open(os.path.join(out, lab, os.path.basename(f)), "wb").write(buf.getvalue())
        zp = os.path.join(out, f"{lab}_VeritaPolicy_crosswalk_2026-10-09.zip")
        with zipfile.ZipFile(zp, "w", zipfile.ZIP_DEFLATED) as w:
            for f in files:
                w.write(os.path.join(out, lab, os.path.basename(f)), os.path.basename(f))
        print(f"{lab}: {len(files)} documents, crosswalk line changed on {changed}, already matching {same} -> {zp}")


if __name__ == "__main__":
    main()
