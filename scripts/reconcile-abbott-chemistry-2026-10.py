#!/usr/bin/env python3
"""
VeritaMap menu-accuracy sweep (item #57) -- BATCH 3: Abbott chemistry (ARCHITECT c-series + Alinity c).
Rule (Michael-approved "normalize as you go"): complete each platform's menu AND
set complexity to the analyzer's class. The ARCHITECT c4000/c8000/c16000 and Alinity c are
ADVIA are moderate-complexity clinical chemistry/integrated analyzers, so every
analyte on them is MODERATE. This both fills gaps and fixes the stray
HIGH/WAIVED complexity (e.g. Sodium tagged HIGH on a chem analyzer).

Source: Siemens' own Global Test Menu PDFs (compiled + cross-verified against our
existing entries, scratchpad/abbott_menus.json). No fabrication: added assay
names come from Siemens' menus; complexity is the analyzer-class value; specialty
is inherited from our existing rows for that analyte, else inferred by discipline.
Writes CRLF + trailing newline.
"""
import json, os, re
from collections import Counter

PATH = os.path.join("client", "src", "lib", "fdaInstrumentData.json")
MENUS = r"C:/Users/veril/AppData/Local/Temp/claude/C--Users-veril/76f2cc96-752b-49d6-be5b-616759d60139/scratchpad/abbott_menus.json"
SYN = {"urea nitrogen": "urea", "bun": "urea", "sgpt": "", "sgot": "", "carbon dioxide": "co2"}


def norm(x):
    s = x.lower()
    s = re.sub(r"\(.*?\)", "", s)
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    for k, v in SYN.items():
        s = s.replace(k, v)
    return re.sub(r"\s+", " ", s).strip()


DISC = [
    ("Toxicology", ["barbiturate", "benzodiazepine", "cocaine", "methadone", "opiate", "oxycodone",
                    "phencyclidine", "amphetamine", "cannabinoid", "ethyl alcohol", "ecstasy",
                    "acetaminophen", "salicylate", "tricyclic", "propoxyphene", "buprenorphine",
                    "methaqualone", "acetylmorphine", "fentanyl", "tramadol", "ethyl glucuronide",
                    "lsd", "eddp"]),
    ("Toxicology", ["digoxin", "digitoxin", "lithium", "phenytoin", "phenobarbital", "carbamazepine",
                    "valproic", "vancomycin", "gentamicin", "tobramycin", "amikacin", "theophylline",
                    "methotrexate", "lamotrigine", "levetiracetam", "ethosuximide", "caffeine",
                    "lidocaine", "procainamide", "napa", "cyclosporine", "tacrolimus", "sirolimus",
                    "everolimus", "mycophenolic", "dibucaine"]),
    ("Cardiac", ["troponin", "ckmb", "ck mb", "natriuretic", "myoglobin", "bnp", "cardiophase"]),
    ("Endocrinology", ["tsh", "thyroxine", "triiodothyronine", "free t3", "free t4", "total t4",
                       "t uptake", "estradiol", "follicle", "luteinizing", "progesterone", "prolactin",
                       "testosterone", "cortisol", "hcg", "vitamin d", "folate", "b12", "insulin"]),
    ("Immunology", ["immunoglobulin", "ige", "light chain", "complement", "rheumatoid", "antistreptolysin",
                    "reactive protein", "c1 inhibitor", "microglobulin", "ca 125", "ca 15", "ca 19",
                    "cea", "afp", "psa", "procalcitonin", "haptoglobin", "ceruloplasmin",
                    "alpha 1", "alpha 2", "retinol", "hemopexin"]),
    ("Electrolytes", ["sodium", "potassium", "chloride", "co2", "bicarbonate"]),
]


def infer_specialty(name):
    n = norm(name)
    for spec, keys in DISC:
        if any(k in n for k in keys):
            return spec
    return "General Chemistry"


def main():
    d = json.loads(open(PATH, encoding="utf-8").read())
    S = json.load(open(MENUS, encoding="utf-8"))

    name_votes, spec_votes = {}, {}
    for v in d.values():
        for a, m in v["tests"].items():
            k = norm(a)
            name_votes.setdefault(k, Counter())[a] += 1
            spec_votes.setdefault(k, Counter())[m["specialty"]] += 1
    canon_name = {k: c.most_common(1)[0][0] for k, c in name_votes.items()}
    canon_spec = {k: c.most_common(1)[0][0] for k, c in spec_votes.items()}

    report, normalized_total = [], 0
    for plat, entries in S["_platform_to_entries"].items():
        menu = [m for m in S[plat] if not str(m).startswith("_")]
        for e in entries:
            if e not in d:
                continue
            tests = d[e]["tests"]
            # (a) normalize complexity of every existing analyte to MODERATE
            nchg = 0
            for a in tests:
                if tests[a]["complexity"] != "MODERATE":
                    tests[a]["complexity"] = "MODERATE"
                    nchg += 1
            normalized_total += nchg
            # (b) add missing menu assays at MODERATE
            have = {norm(a) for a in tests}
            added = 0
            for assay in menu:
                k = norm(assay)
                if k in have:
                    continue
                name = canon_name.get(k, assay)
                if norm(name) in have:
                    continue
                spec = canon_spec.get(k) or infer_specialty(assay)
                tests[name] = {"complexity": "MODERATE", "specialty": spec}
                have.add(norm(name))
                added += 1
            d[e]["testCount"] = len(tests)
            report.append((e, added, nchg, d[e]["testCount"]))

    out = json.dumps(d, indent=2, ensure_ascii=False) + "\n"
    open(PATH, "wb").write(out.replace("\n", "\r\n").encode("utf-8"))

    d2 = json.loads(open(PATH, encoding="utf-8").read())
    for e, added, nchg, tc in report:
        names = [a.lower() for a in d2[e]["tests"]]
        allmod = all(m["complexity"] == "MODERATE" for m in d2[e]["tests"].values())
        print(f"{e}: +{added} added, {nchg} complexity-normalized -> tc {tc} | dup={len(names)!=len(set(names))} | allMODERATE={allmod}")
    print(f"\nTOTAL existing rows complexity-normalized to MODERATE: {normalized_total}")


if __name__ == "__main__":
    main()
