#!/usr/bin/env python3
"""Extract CAP Surveys program codes and names from a catalog PDF (parking lot #80).

Input: the text of a CAP Surveys catalog as produced by `pdftotext -layout`.
Output: a CSV of candidate (code, program_name, discipline, page, confidence)
rows for OPERATOR VERIFICATION before anything is loaded into
pt_vendor_programs. Nothing here is loaded automatically: the loader's
never-fabricated rule stands, and the verifier is a CAP-enrolled director.

How the catalog reads (2026 and 2027 editions): every program family has a
"Program Information" header on the right-hand column. The program name sits
on the same line to the left (sometimes wrapped onto the line above or below),
the program codes appear on that line or the next few lines, and a
"Program Code" table header follows with the codes on the next line. Page
footers carry the page number and the discipline is the short line right
after the footer. The parser walks those blocks.

Usage:
  pdftotext -layout "CAP Surveys 2026.pdf" cap_2026.txt
  python scripts/cap_catalog/extract_cap_catalog.py cap_2026.txt 2026 out_2026.csv
"""
import csv
import re
import sys

CODE = re.compile(r"\b([A-Z][A-Z0-9]{0,7})\b")
# A code is an all-caps token (digits allowed) that ENDS at a non-alphanumeric:
# without the trailing lookahead the leading capital of every word matched.
# Ranges in the catalog use an en dash ("FH1-FH4" after normalisation) and are
# expanded when both ends share the alphabetic prefix.
TOKEN = r"[A-Z][A-Z0-9]{0,7}(?![A-Za-z0-9])"
CODE_LIST = re.compile(r"(?<![A-Za-z0-9])(" + TOKEN + r"(?:\s*-\s*" + TOKEN + r")?(?:/" + TOKEN + r")*(?:\s*,\s*" + TOKEN + r"(?:\s*-\s*" + TOKEN + r")?(?:/" + TOKEN + r")*)*)")
RANGE = re.compile(r"^([A-Z]+)(\d+)\s*-\s*([A-Z]+)(\d+)$")


def normalise(text: str) -> str:
    return text.replace("�", "-").replace("–", "-").replace("—", "-")
FOOTER = re.compile(r"^\s*(\d{1,3})\s+College of American Pathologists|cap\.org\s+(\d{1,3})\s*$")
# Words that look like codes but are prose or analyte abbreviations in these pages.
NOT_CODES = {
    "A", "I", "II", "III", "IV", "CE", "CME", "CAP", "CLIA", "CMS", "FDA", "ISO", "PT", "EQA", "US", "USA", "CA", "FL",
    # Analyte abbreviations are NOT excluded wholesale: ABL, ANA, CRP, TM, HCG and
    # others are real CAP program codes. Codes are read only from name lines and
    # Program Code rows, which keeps analyte columns out.
    "RBC", "WBC", "MCV", "MCH", "MCHC", "MPV", "RDW", "NRBC", "DNA", "RNA", "PCR", "NGS",
    "PDF", "ML", "MLS", "ASCP", "QC", "QA", "SI", "LIS",
    "HTML", "URL", "ID", "OK", "AM", "PM", "NOTE", "NEW", "AND", "OR", "FOR", "THE", "ON", "IN", "OF",
    "TO", "BY", "AT", "WITH", "PER", "SEE", "PAGE", "TOTAL", "YES", "NO", "X",
    # instrument and vendor names set in caps inside instrument matrices
    "ADVIA", "ALINITY", "ARCHITECT", "COBAS", "VITROS", "ATELLICA", "SYSMEX", "ABBOTT", "ROCHE", "SIEMENS", "BECKMAN",
    "COULTER", "DXH", "DXC", "DXI", "AU", "XN", "XE", "XT", "XS", "XP", "XQ", "KX", "CELL", "DYN", "EMERALD", "RUBY",
    "HORIBA", "ABX", "PENTRA", "YUMIZEN", "MINDRAY", "BC", "NIHON", "KOHDEN", "GEM", "RAPIDPOINT", "RAPIDLAB",
    "OPTI", "NOVA", "STAT", "ISTAT", "EPOC", "PICCOLO", "DIMENSION", "VISTA", "EXL", "RXL", "XPAND", "INTEGRA", "MODULAR",
    "UNICEL", "SYNCHRON", "ACCESS", "CENTAUR", "IMMULITE", "ELECSYS", "LIAISON", "VIDAS", "BIOPLEX", "PHADIA", "IMMUNOCAP",
    "ACL", "TOP", "STAGO", "COMPACT", "SYSTEM", "SERIES", "PLUS", "PRO", "MAX", "MINI", "FS", "II", "IV",
    "BD", "MAX", "BACTEC", "VIRTUO", "PHOENIX", "VITEK", "MALDI", "TOF", "GENEXPERT", "CEPHEID", "FILMARRAY", "BIOFIRE",
    "PANTHER", "HOLOGIC", "ALINITY", "M2000", "REALTIME", "AMPLIPREP", "TAQMAN", "CLINITEK", "IRIS", "IQ", "UF", "AUTION",
    "DCA", "VANTAGE", "HBA1C", "A1C", "ACCU", "CHEK", "ONETOUCH", "FREESTYLE", "PRECISION", "XCEED", "NEO",
}
SKIP_NAME_STARTS = ("Program Name", "Analyte", "Instrument", "Method", "Challenges", "Program Code", "Cases per", "Specimen")


def is_code(tok: str) -> bool:
    if tok in NOT_CODES:
        return False
    # Single-letter programs exist (J, D, F, G, U, K, Z, T, N, C, P...); codes_in()
    # only accepts them inside a comma list or on a Program Code row.
    return bool(re.fullmatch(r"[A-Z][A-Z0-9]{0,7}", tok)) and any(ch.isdigit() or ch.isupper() for ch in tok)


def expand(part: str) -> list[str]:
    m = RANGE.match(part.strip())
    if m and m.group(1) == m.group(3) and int(m.group(2)) <= int(m.group(4)) <= int(m.group(2)) + 30:
        return [f"{m.group(1)}{n}" for n in range(int(m.group(2)), int(m.group(4)) + 1)]
    return [part.strip()]


def codes_in(text: str, allow_single: bool = False) -> list[str]:
    """Codes in a text fragment. Single-letter codes (J, D, F, P, K, Z, T, N, C)
    are real CAP programs but also column letters in prose, so they count only
    inside a comma list of two or more codes, or on a Program Code row."""
    out: list[str] = []
    for m in CODE_LIST.finditer(normalise(text)):
        parts = re.split(r"\s*,\s*", m.group(1))
        many = len(parts) >= 2
        for part in parts:
            for cc0 in part.split("/"):
                for cc in expand(cc0):
                    if not cc or not is_code(cc) or cc in out:
                        continue
                    if len(cc) == 1 and not (many or allow_single):
                        continue
                    out.append(cc)
    return out


def strip_codes(text: str) -> str:
    t = CODE_LIST.sub(" ", normalise(text))
    return re.sub(r"\s+", " ", t).strip(" -,")


def main() -> int:
    if len(sys.argv) < 4:
        print(__doc__)
        return 2
    src, year, out = sys.argv[1], sys.argv[2], sys.argv[3]
    lines = open(src, encoding="utf-8", errors="replace").read().split("\n")

    # Page + discipline map: footer line -> page number; the next non-empty
    # short line is the discipline label for the pages that follow.
    page_at = [0] * len(lines)
    disc_at = [""] * len(lines)
    page, disc = 0, ""
    for i, ln in enumerate(lines):
        m = FOOTER.search(ln)
        if m:
            page = int(m.group(1) or m.group(2) or 0) + 1  # footer closes a page; the next page starts
            for k in range(1, 4):
                if i + k < len(lines):
                    cand = lines[i + k].strip()
                    if 3 <= len(cand) <= 60 and not CODE_LIST.fullmatch(cand) and not cand[0].isdigit():
                        disc = cand
                        break
        page_at[i] = page
        disc_at[i] = disc

    rows = []
    for i, ln in enumerate(lines):
        if "Program Information" not in ln:
            continue
        col = ln.find("Program Information")
        left = ln[:col]
        name = strip_codes(left)
        codes = codes_in(left)
        # Name wraps: the previous and next lines' left columns, when they are
        # prose (no table header words) and sit in the same column band.
        for k in (-1, 1, 2):
            j = i + k
            if j < 0 or j >= len(lines):
                continue
            seg = lines[j][:col] if col > 0 else lines[j]
            segs = seg.strip()
            if not segs or segs.startswith(SKIP_NAME_STARTS) or "Program Information" in lines[j]:
                continue
            frag_codes = codes_in(seg)
            frag_name = strip_codes(seg)
            if k == -1 and frag_name and not frag_codes and len(frag_name) < 70 and name and name[0].isupper():
                # a wrapped first line only when the header line itself is a continuation (lowercase start or short)
                if ln[:col].strip() and (ln[:col].strip()[0].islower() or len(name) < 25):
                    name = (frag_name + " " + name).strip()
            elif k >= 1:
                for c in frag_codes:
                    if c not in codes:
                        codes.append(c)
                if frag_name and not frag_codes and len(frag_name) < 70 and k == 1 and not name.endswith(")"):
                    # continuation of the name (e.g. "Cardiac Markers HCRQ" after "Quality Cross Check--High-Sensitivity")
                    name = (name + " " + frag_name).strip()
                elif frag_name and frag_codes and k == 1 and len(frag_name) < 50:
                    name = (name + " " + frag_name).strip()
        # Codes from the "Program Code" table: the first code row after the header.
        for j in range(i + 1, min(i + 16, len(lines))):
            if "Program Code" in lines[j]:
                for jj in range(j + 1, min(j + 5, len(lines))):
                    seg = lines[jj][:max(col, 60)]
                    found = codes_in(seg, allow_single=True)
                    for c in found:
                        if c not in codes:
                            codes.append(c)
                    if found:
                        # a second code row (e.g. "/FH3Q" continuations) directly below
                        seg2 = lines[jj + 1][:max(col, 60)] if jj + 1 < len(lines) else ""
                        for c in codes_in(seg2, allow_single=False):
                            if c not in codes:
                                codes.append(c)
                        break
                break
        name = re.sub(r"\s+", " ", name).strip(" -,")
        name = re.sub(r"^\d+\s+", "", name)  # a stray cases-per-year number from the table column
        conf = "high" if name and codes else ("name-only" if name else ("codes-only" if codes else "empty"))
        if not name and not codes:
            continue
        rows.append({"year": year, "page": page_at[i], "discipline": disc_at[i], "program_name": name, "codes": ", ".join(codes), "confidence": conf, "line": i + 1})

    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["year", "page", "discipline", "program_name", "codes", "confidence", "line"])
        w.writeheader()
        w.writerows(rows)
    distinct = {c for r in rows for c in r["codes"].split(", ") if c}
    print(f"{year}: {len(rows)} program blocks, {len(distinct)} distinct codes, "
          f"{sum(1 for r in rows if r['confidence']=='high')} high, "
          f"{sum(1 for r in rows if r['confidence']=='name-only')} name-only, "
          f"{sum(1 for r in rows if r['confidence']=='codes-only')} codes-only")
    for key in ("FH2", "FH2P", "FH9", "RT4", "C1", "AQ", "J", "FH1"):
        hits = [r["program_name"] for r in rows if key in r["codes"].split(", ")]
        print(f"  {key}: {hits[:2]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
