"""VeritaPolicy master-list CFR crosswalk review (Michael Q51 = 1, 2026-10-09). PREP ONLY: nothing in
server/veritapolicyMasterList.ts changes until Michael approves the sheet.

Every CFR citation in the 58 master rows (523 citations) was checked against the eCFR (2026-10-01): it must
exist, and its section must be about what the policy covers. CHANGES below are Claude's picks with reasons;
every other citation stays. Writes the review workbook and crosswalk_changes_2026-10-09.json for the apply step.

Usage: python crosswalk_review.py <out.xlsx>
"""
import json, os, re, sys
import rebuild_cfr_quotes as R

HERE = os.path.dirname(os.path.abspath(__file__))
MASTER = os.path.join(os.path.dirname(os.path.dirname(HERE)), "server", "veritapolicyMasterList.ts")
MICRO = ["42 CFR 493.1261", "42 CFR 493.1262", "42 CFR 493.1263", "42 CFR 493.1264", "42 CFR 493.1265"]
SEC = ["45 CFR 164.306", "45 CFR 164.308", "45 CFR 164.310", "45 CFR 164.312"]
R_MICRO = "Microbiology subspecialty standard; this policy does not cover microbiology testing."
R_SEC = "HIPAA Security Rule safeguard for electronic PHI systems; not what this policy covers."
R_GONE = "Not in the CFR (the eCFR has no version of this section)."
R_LTC = "Long-term care facility requirement (42 CFR 483); not a laboratory policy requirement."
R_640 = "21 CFR 640 blood-product standard; this policy does not cover blood products."
R_HISTO = "493.1273 is Histopathology; the immunohematology standard 493.1271 is already listed."

# (policy_id, action, citation, reason, replacement)
CHANGES = [
    ("1", "remove", "42 CFR 493.1773", "Inspection requirements, not change notification.", None),
    ("1", "remove", "42 CFR 493.1775", "Inspection of waiver/PPM laboratories, not change notification.", None),
    ("1", "add", "42 CFR 493.51", "The 30-day change notice for a certificate of compliance.", None),
    ("1", "add", "42 CFR 493.63", "The 30-day change notice to HHS and the accreditation program (certificate of accreditation).", None),
    ("4", "remove", "42 CFR 493.821", "Lists the microbiology PT subspecialties only; this policy covers PT in every specialty.", None),
    ("6", "remove", "42 CFR 483.50", R_LTC, None),
    ("7", "remove", "42 CFR 483.50", R_LTC, None),
    ("8", "remove", "42 CFR 493.1202", "Mycobacteriology condition; specimen identification applies to every specialty under 493.1232.", None),
    ("8", "remove", "42 CFR 493.1264", "Parasitology standard; not specimen identification.", None),
    *[("9", "remove", c, "Specialty QC standard; the procedure manual requirement (493.1251) is the same for every specialty.", None) for c in MICRO + ["42 CFR 493.1269", "42 CFR 493.1276"]],
    ("10", "replace", "42 CFR 493.1276", "493.1276 is clinical cytogenetics; continuity of records during downtime is record retention.", "42 CFR 493.1105"),
    *[("11", "remove", c, R_SEC, None) for c in SEC],
    *[("12", "remove", c, "Specialty QC standard; record retention periods are all in 493.1105.", None) for c in MICRO + ["42 CFR 493.1269"]],
    ("12", "remove", "42 CFR 493.1107", R_GONE, None),
    ("33", "remove", "42 CFR 493.1351", "Condition for PPM laboratories; not procedure approval.", None),
    ("33", "remove", "42 CFR 493.1471", "Cytology general supervisor responsibilities; not procedure approval.", None),
    *[("36", "remove", c, R_SEC, None) for c in ["45 CFR 164.308", "45 CFR 164.310", "45 CFR 164.312"]],
    ("36", "remove", "21 CFR 606.140", "FDA blood-establishment laboratory controls; method verification is CLIA 493.1253.", None),
    ("39", "remove", "21 CFR 606.110", "Plateletpheresis and plasmapheresis; not reagent labeling.", None),
    ("39", "remove", "21 CFR 640.27", R_GONE, None),
    ("39", "remove", "21 CFR 640.30", R_640, None),
    *[("66", "remove", c, R_MICRO, None) for c in MICRO],
    ("66", "remove", "42 CFR 493.829", "Parasitology proficiency testing; not hematology QC.", None),
    ("66", "remove", "42 CFR 493.831", "Virology proficiency testing; not hematology QC.", None),
    ("66", "remove", "42 CFR 493.1217", "Immunohematology condition; not hematology QC.", None),
    *[("67", "remove", c, R_MICRO, None) for c in MICRO],
    ("67", "remove", "42 CFR 493.829", "Parasitology proficiency testing; not coagulation.", None),
    ("67", "remove", "42 CFR 493.831", "Virology proficiency testing; not coagulation.", None),
    ("67", "remove", "42 CFR 493.859", "ABO group and D typing proficiency testing; not coagulation.", None),
    ("67", "remove", "42 CFR 493.1217", "Immunohematology condition; not coagulation.", None),
    ("67", "remove", "42 CFR 493.1267", "Routine chemistry standard; coagulation QC is 493.1269.", None),
    ("67", "remove", "21 CFR 606.140", "FDA blood-establishment laboratory controls; not coagulation testing.", None),
    ("68", "remove", "42 CFR 493.1262", "Mycobacteriology; histocompatibility is 493.1278 (already listed).", None),
    ("70", "remove", "21 CFR 640.24", R_640, None),
    ("70", "remove", "21 CFR 640.27", R_GONE, None),
    ("70", "remove", "21 CFR 640.30", R_640, None),
    *[("71", "remove", c, "HCT/P good tissue practice; radioactive surgical tissue is not an HCT/P.", None) for c in ["21 CFR 1271.155", "21 CFR 1271.160", "21 CFR 1271.170"]],
    ("71", "remove", "21 CFR 640.24", R_640, None),
    ("71", "remove", "21 CFR 640.27", R_GONE, None),
    ("71", "remove", "21 CFR 640.30", R_640, None),
    *[("72", "remove", c, "NRC rule for radioactive materials; electron microscope X-rays are machine-produced radiation (state rules and 21 CFR 1020).", None) for c in ["10 CFR 20.1003", "10 CFR 20.1502"]],
    ("73", "remove", "45 CFR 164.308", R_SEC, None),
    ("78", "replace", "42 CFR 493.1262", "493.1262 is mycobacteriology; the parasitology standard is 493.1264.", "42 CFR 493.1264"),
    *[("79", "remove", c, "Specialty QC standard unrelated to radiobioassay.", None) for c in MICRO + ["42 CFR 493.1269"]],
    ("79", "remove", "21 CFR 606.20", "Blood-establishment personnel; not radiobioassay.", None),
    *[("80", "remove", c, "Not virology; the virology standard 493.1265 stays.", None) for c in MICRO[:4] + ["42 CFR 493.1269"]],
    ("97", "remove", "42 CFR 493.1273", R_HISTO, None),
    ("98", "remove", "42 CFR 493.1273", R_HISTO, None),
    ("98", "remove", "42 CFR 493.831", "Virology proficiency testing; not pretransfusion testing.", None),
    ("98", "remove", "21 CFR 610.42", "Restrictions on blood used to make medical devices (collecting establishments); not pretransfusion testing.", None),
    ("99", "remove", "42 CFR 493.1273", R_HISTO, None),
    ("99", "remove", "21 CFR 640.27", R_GONE, None),
    ("99", "remove", "21 CFR 640.51", "Source Plasma donor eligibility; not blood component handling in a transfusion service.", None),
    ("99", "remove", "42 CFR 493.1202", "Mycobacteriology condition; not blood components.", None),
    ("99", "remove", "21 CFR 610.40", "Donor testing by collecting establishments; a transfusion service receives tested units.", None),
    ("100", "remove", "42 CFR 493.1273", R_HISTO, None),
    ("100", "remove", "21 CFR 610.40", "Donor testing by collecting establishments; not transfusion administration.", None),
    ("100", "remove", "21 CFR 610.42", "Restrictions on blood used to make medical devices; not transfusion administration.", None),
    ("100", "remove", "42 CFR 416.49", "Ambulatory surgical center condition for coverage; not a laboratory requirement.", None),
    ("100", "remove", "42 CFR 483.50", R_LTC, None),
    ("102", "remove", "42 CFR 493.845", "Toxicology proficiency testing; not donor operations.", None),
    ("102", "remove", "42 CFR 493.1267", "Routine chemistry standard; not donor operations.", None),
    ("102", "remove", "21 CFR 640.3", R_GONE + " Donor suitability moved to 21 CFR 630 (630.10, already listed).", None),
    *[("103", "remove", c, R_SEC, None) for c in SEC],
    ("103", "replace", "42 CFR 493.1775", "Inspection of waiver/PPM labs; the director-change notice is 493.63 (as the policy text now says).", "42 CFR 493.63"),
    ("104", "remove", "42 CFR 493.35", "Application for a certificate of waiver; not training and competency.", None),
    ("105", "remove", "42 CFR 493.1351", "Condition for PPM laboratories; not staff performance evaluation.", None),
    ("105", "remove", "42 CFR 493.1357", "PPM laboratory director qualifications; not staff performance evaluation.", None),
    *[("106", "remove", c, "Microbiology standard; waived tests are exempt from Subpart K and point-of-care testing is not microbiology QC.", None) for c in MICRO],
    ("106", "remove", "42 CFR 493.1269", "Manual cell count and coagulation QC; not point-of-care testing.", None),
    ("107", "remove", "42 CFR 493.1276", "Clinical cytogenetics; CLIA has no molecular pathology standard.", None),
    *[("107", "remove", c, "Microbiology standard other than virology; the virology standard 493.1265 stays.", None) for c in MICRO[:4]],
    ("107", "remove", "42 CFR 493.1269", "Hematology standard; not molecular testing.", None),
    ("107", "remove", "21 CFR 640.2", "Blood-product general requirements; not molecular testing.", None),
    ("107", "remove", "42 CFR 493.1202", "Mycobacteriology condition; not molecular testing.", None),
    ("108", "remove", "29 CFR 1910.1030", "Bloodborne pathogens; not health information management.", None),
    *[("109", "remove", c, "Cytology general supervisor rule; not general laboratory governance.", None) for c in ["42 CFR 493.1467", "42 CFR 493.1469", "42 CFR 493.1471"]],
    ("109", "remove", "42 CFR 493.1262", "Mycobacteriology; not laboratory governance.", None),
    ("109", "replace", "42 CFR 493.1775", "Inspection of waiver/PPM labs; change notification is 493.63 (as the policy text now says).", "42 CFR 493.63"),
    ("111", "remove", "42 CFR 493.1271", "Immunohematology; HCT/P handling is 21 CFR 1271.", None),
]


def load_master():
    src = open(MASTER, encoding="utf-8").read()
    a = src.index("= [", src.index("VERITAPOLICY_MASTER_LIST")) + 2
    depth, i = 0, a
    while True:
        if src[i] == "[":
            depth += 1
        elif src[i] == "]":
            depth -= 1
            if depth == 0:
                break
        i += 1
    return json.loads(src[a:i + 1])


def main():
    out = sys.argv[1]
    rows = {r["policy_id"]: r for r in load_master()}
    corpus = R.Corpus()
    for t, p in R.WHOLE_PARTS:
        corpus.load_part(t, p)

    def heading(cite):
        m = re.match(r"(\d+)\s*CFR\s*(\d+)\.(\d+[a-z]?)", cite)
        s = f"{m.group(2)}.{m.group(3)}"
        if s not in corpus.sections:
            try:
                corpus.load_section(m.group(1), m.group(2), s)
            except Exception:
                return "(not in the eCFR)"
        return R.clean(corpus.heads.get(s, "(not in the eCFR)"))

    after, log = {}, []
    for pid, r in rows.items():
        cites = [c.strip() for c in r["cfr_citations"].split(";") if c.strip()]
        after[pid] = list(cites)
    for pid, act, cite, why, rep in CHANGES:
        cur = after[pid]
        if act in ("remove", "replace"):
            if cite not in cur:
                raise SystemExit(f"policy {pid}: {cite} is not in its crosswalk")
            idx = cur.index(cite)
            if act == "remove" or rep in cur:  # a replacement already listed: just drop the wrong one
                cur.pop(idx)
            else:
                cur[idx] = rep
        elif act == "add":
            if cite in cur:
                raise SystemExit(f"policy {pid}: {cite} already listed")
            cur.append(cite)
        log.append({"policy_id": pid, "policy": rows[pid]["policy_name"], "action": act, "citation": cite, "heading": heading(cite),
                    "replacement": rep, "replacement_heading": heading(rep) if rep else "", "reason": why})
    after = {k: [c for c in v if c] for k, v in after.items()}
    json.dump({"changes": log, "after": {k: "; ".join(v) for k, v in after.items()}},
              open(os.path.join(HERE, "crosswalk_changes_2026-10-09.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    thin = Side(style="thin", color="D0D0D0")
    wb = Workbook()
    ab = wb.active
    ab.title = "About"
    total = sum(len([c for c in r["cfr_citations"].split(";") if c.strip()]) for r in rows.values())
    cnt = {a: sum(1 for x in log if x["action"] == a) for a in ("remove", "add", "replace")}
    for t in [
        "VeritaPolicy master-list CFR crosswalk review", "",
        f"The 'Accreditor Crosswalk' printed at the end of every policy, and the master list page and workbook, come from {total} CFR citations in {len(rows)} policies (server/veritapolicyMasterList.ts).",
        "Each was checked against the eCFR (2026-10-01): does the section exist, and is it about what the policy covers.",
        f"Claude's changes: {cnt['remove']} removals, {cnt['replace']} replacements, {cnt['add']} additions. Every other citation stays.",
        "Three cited sections do not exist (21 CFR 640.3, 21 CFR 640.27, 42 CFR 493.1107). Most other removals are microbiology, HIPAA Security, 21 CFR 640 or",
        "histopathology sections attached to policies they do not apply to. TJC, CAP, COLA and AABB crosswalks were not reviewed (not public regulation).",
        "", "Michael: mark column H 'Y' or write what to change. Nothing changes in the product until this sheet is approved.",
    ]:
        ab.append([t])
    ab["A1"].font = Font(bold=True, size=14, color="01696F")
    ab.column_dimensions["A"].width = 150

    def sheet(name, hdr, data, widths):
        ws = wb.create_sheet(name)
        ws.append(hdr)
        for c in ws[1]:
            c.fill, c.font, c.border = PatternFill("solid", fgColor="01696F"), Font(bold=True, color="FFFFFF"), Border(left=thin, right=thin, top=thin, bottom=thin)
        for i, rw in enumerate(data):
            ws.append(rw)
            for c in ws[ws.max_row]:
                c.alignment, c.border = Alignment(wrap_text=True, vertical="top"), Border(left=thin, right=thin, top=thin, bottom=thin)
                if i % 2:
                    c.fill = PatternFill("solid", fgColor="EBF3F8")
        for i, w in enumerate(widths):
            ws.column_dimensions[chr(65 + i)].width = w
        ws.freeze_panes = "B2"
        ws.auto_filter.ref = ws.dimensions

    sheet("Changes", ["Policy", "Action", "Citation", "eCFR heading", "Replace with", "Its heading", "Reason", "Michael OK? (Y, or what to change)"],
          [[f"{x['policy_id']} {x['policy']}", x["action"], x["citation"], x["heading"], x["replacement"] or "", x["replacement_heading"], x["reason"], ""] for x in log],
          [34, 9, 18, 46, 16, 40, 60, 20])
    sheet("Crosswalk after", ["Policy", "CFR crosswalk before", "CFR crosswalk after"],
          [[f"{pid} {rows[pid]['policy_name']}", rows[pid]["cfr_citations"], "; ".join(after[pid])] for pid in sorted(rows, key=lambda x: int(x))],
          [40, 80, 80])
    wb.active = 0
    wb.save(out)
    print(f"{total} citations in {len(rows)} policies; changes: {cnt} -> {out}")


if __name__ == "__main__":
    main()
