#!/usr/bin/env python3
"""
uls_dup_report.py - Name-similarity possible-duplicate report for the ULS load.

Part-number dedupe is impossible (existing San Carlos items carry no catalog
numbers), so this flags the new ULS rows whose NAME resembles an existing item,
for manual keep/skip. Reuses the mapping + existing-fetch from the loader.

Run via a bash wrapper that exports ADMIN_SECRET.
"""
import os, sys, re
from difflib import SequenceMatcher
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from load_uls_inventory import load_xlsx, build_item, fetch_existing

def norm(s):
    return re.sub(r"[^A-Z0-9]+", " ", str(s or "").upper()).strip()

UNIT_STOP = {"PK","BX","EA","CS","BG","ML","GAL","LT","IN","YD","SET","KIT","LVL","LEVEL",
             "PR","RX","OZ","TUBE","CAP","BOX","PACK","CASE","BAG","STERILE","DISPOSABLE"}

def dtoks(s):
    return [t for t in norm(s).split() if len(t) >= 4 and not t.isdigit() and t not in UNIT_STOP]

# Minimum length for a "distinctive" token when checking a rare shared name.
# 4 catches short product names like CORE/OMNI (Omni-Core) that the existing
# QC entries use; rarity (DF) does the noise control, not length.
MIN_RARE_TOKEN_LEN = 4

def tok_match(a, b):
    return SequenceMatcher(None, a, b).ratio() >= 0.80

def main():
    secret = os.environ.get("ADMIN_SECRET", "")
    if not secret:
        print("ADMIN_SECRET not set"); sys.exit(2)
    existing = fetch_existing(secret)["items"]
    ex = [(it["item_name"], norm(it["item_name"]), set(dtoks(it["item_name"]))) for it in existing]

    # Document frequency of each distinctive token across the existing set.
    # A shared token is only meaningful when it is RARE (a product-specific name
    # like OMNICORE / UNICHEMTRAX), not a generic word (CONTROL, FISHER, KIT)
    # that appears across many existing QC entries.
    from collections import Counter
    df = Counter()
    for _, _, ets in ex:
        for t in ets:
            df[t] += 1
    GENERIC = {"CONTROL","CONTROLS","CALIBRATOR","CALIBRATION","CALIBRATORS","REAGENT",
               "UNIVERSAL","FISHER","THERMO","SCIENTIFIC","VITROS","MICROWELL","MICROSLIDE",
               "MICROTIP","RANGE","VERIFIER","WASH","KIT","LEVEL","BLOOD","SALINE","WATER"}

    def rare_shared(nt, ets):
        """Existing tokens that fuzzy-match a new token AND are rare/specific."""
        hits = []
        for a in nt:
            if len(a) < MIN_RARE_TOKEN_LEN or a in GENERIC:
                continue
            for b in ets:
                if b in GENERIC or df.get(b, 0) > 2:
                    continue
                if tok_match(a, b):
                    hits.append(b)
                    break
        return hits

    rows = load_xlsx()
    new = [bi for bi in (build_item(r) for r in rows) if bi]

    flagged = []
    for it in new:
        nm = it["item_name"]; nn = norm(nm); nt = set(dtoks(nm))
        best = None; best_seq = 0.0; best_rare = []
        for enm, een, ets in ex:
            seq = SequenceMatcher(None, nn, een).ratio()
            rare = rare_shared(nt, ets)
            better = (len(rare) > len(best_rare)) or (len(rare) == len(best_rare) and seq > best_seq)
            if better:
                best, best_seq, best_rare = enm, seq, rare
        # Flag only on a rare shared product token OR a genuinely high full-name match.
        if best_rare or best_seq >= 0.55:
            sc = round(best_seq + 0.2 * len(best_rare), 2)
            flagged.append((sc, nm, it.get("catalog_number"), it["category"], best, best_seq, best_rare))

    flagged.sort(reverse=True)
    print(f"New ULS items: {len(new)}  |  flagged as POSSIBLE duplicates: {len(flagged)}")
    print(f"Unflagged (would load directly): {len(new) - len(flagged)}\n")
    print("POSSIBLE DUPLICATES (you mark which to SKIP):")
    for i, (sc, nm, cat, catg, exnm, seq, rare) in enumerate(flagged, 1):
        why = f"shared name token {rare}" if rare else f"name match {seq:.2f}"
        print(f"{i:>2}. ULS: {nm}  [cat#{cat}, {catg}]")
        print(f"      ~ existing: {exnm}   ({why})")

if __name__ == "__main__":
    main()
