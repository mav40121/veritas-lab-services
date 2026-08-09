#!/usr/bin/env python3
"""
load_uls_inventory.py  -  Merge-load the ULS "1620 STOCKROOM" master into
San Carlos (lab 2) VeritaStock, deduped by part number against existing items.

Two modes:
  --dry-run  (default): fetch existing items via the admin read endpoint, dedupe
             the xlsx rows by Supplier/Mfg part number, print matched-vs-new +
             category/UOM breakdown, and write the new-items payload to
             /tmp/uls_new_items.json. No writes to production.
  --commit:  POST the new items to /api/admin/import-inventory.

Credentials: ADMIN_SECRET is read from the environment (the bash wrapper pulls it
from Railway env in-process). Nothing secret is printed.

Usage (from a bash wrapper that exports ADMIN_SECRET):
  python scripts/load_uls_inventory.py --dry-run
  python scripts/load_uls_inventory.py --commit
"""
import os, sys, json, re, datetime
import urllib.request

XLSX = os.environ.get("ULS_XLSX", r"C:\Users\veril\Downloads\ULS Inventory Master(2).xlsx")
BASE = os.environ.get("PW_BASE", "https://www.veritaslabservices.com")
LAB_ID = 2
IMPORT_TAG = f"ULS 1620 Stockroom import {datetime.date.today().isoformat()}"

UOM_MAP = {"PK": "pack", "EA": "each", "CS": "case"}

# Column indices (0-based) in the ULS sheet.
C_STKRM_NAME, C_STKRM_ID, C_BIN, C_SUPPLIER_PN, C_MFG_PN, C_VENDOR, \
    C_PARTNAME, C_UOM, C_MAXSTOCK, C_REORDER, C_ONHAND, C_FLAG = range(12)


def norm_pn(s):
    """Normalize a part number for matching: uppercase, drop non-alphanumerics."""
    if s is None:
        return ""
    return re.sub(r"[^A-Z0-9]", "", str(s).upper())


def classify(name):
    n = (name or "").upper()
    if any(k in n for k in ("CONTROL", "CNTRL", " CTL", "CTL ", "CTRL", " QC")):
        return "Control"
    if any(k in n for k in ("CALIBRAT", "CALIB", "CAL KIT", "CALIBRATOR")):
        return "Calibrator"
    if any(k in n for k in ("REAGENT", "BUFFER", "DILUENT", "WASH", "DETERGENT",
                            "STAIN", "ANTISERA", "SUBSTRATE", "HEMOLYSIS", "CLEAN",
                            "DESCAL", "CELLPACK", "CELLCLEAN")):
        return "Reagent"
    return "Supply"


def load_xlsx():
    import openpyxl
    wb = openpyxl.load_workbook(XLSX, data_only=True)
    rows = list(wb["Sheet1"].iter_rows(values_only=True))[1:]  # skip header
    return rows


def build_item(r):
    """Map one ULS row -> import payload dict (None if it should be skipped)."""
    flag = (str(r[C_FLAG]).strip().upper() if r[C_FLAG] is not None else "")
    if "REMOVE" in flag:
        return None  # being pulled from inventory; do not load

    name = str(r[C_PARTNAME]).strip()
    uom = UOM_MAP.get(str(r[C_UOM]).strip().upper(), "each")
    supplier_pn = str(r[C_SUPPLIER_PN]).strip() if r[C_SUPPLIER_PN] is not None else None
    mfg_pn = str(r[C_MFG_PN]).strip() if r[C_MFG_PN] is not None else None

    notes_bits = [IMPORT_TAG]
    if mfg_pn and mfg_pn != supplier_pn:
        notes_bits.append(f"Mfg# {mfg_pn}")
    if r[C_MAXSTOCK] is not None:
        notes_bits.append(f"Max stock {r[C_MAXSTOCK]}")
    if flag == "DNR":
        notes_bits.append("Do Not Reorder")

    return {
        "item_name": name,
        "catalog_number": supplier_pn,
        "vendor": str(r[C_VENDOR]).strip() if r[C_VENDOR] is not None else None,
        "storage_location": str(r[C_BIN]).strip() if r[C_BIN] is not None else None,
        "quantity_on_hand": int(r[C_ONHAND]) if isinstance(r[C_ONHAND], (int, float)) else 0,
        "reorder_point": int(r[C_REORDER]) if isinstance(r[C_REORDER], (int, float)) else 0,
        "category": classify(name),
        "unit": uom,
        "order_unit": uom,
        "usage_unit": uom,
        "count_unit": uom,
        "units_per_order_unit": 1,
        "units_per_count_unit": 1,
        "status": "active",
        "notes": ". ".join(notes_bits) + ".",
        # carried only for dedupe; stripped before POST
        "_supplier_pn": supplier_pn,
        "_mfg_pn": mfg_pn,
    }


def fetch_existing(secret):
    url = f"{BASE}/api/admin/labs/{LAB_ID}/inventory?secret={secret}"
    with urllib.request.urlopen(url, timeout=30) as resp:
        data = json.loads(resp.read().decode())
    return data


def main():
    mode = "--commit" if "--commit" in sys.argv else "--dry-run"
    secret = os.environ.get("ADMIN_SECRET", "")
    if not secret:
        print("ADMIN_SECRET not in env; aborting.")
        sys.exit(2)

    existing = fetch_existing(secret)
    lab = existing.get("lab", {})
    if lab.get("id") != LAB_ID or "San Carlos" not in (lab.get("lab_name") or ""):
        print(f"SAFETY ABORT: resolved lab is {lab}, expected San Carlos lab {LAB_ID}.")
        sys.exit(3)
    existing_items = existing.get("items", [])
    existing_cats = set()
    for it in existing_items:
        c = norm_pn(it.get("catalog_number"))
        if c:
            existing_cats.add(c)

    rows = load_xlsx()
    new_items, matched, removed = [], [], []
    for r in rows:
        item = build_item(r)
        if item is None:
            removed.append(str(r[C_PARTNAME]).strip())
            continue
        keys = {norm_pn(item.get("_supplier_pn")), norm_pn(item.get("_mfg_pn"))} - {""}
        if keys & existing_cats:
            matched.append((item["item_name"], sorted(keys)))
        else:
            new_items.append(item)

    # User-confirmed name-similarity duplicates to skip, by catalog/part number.
    skip_set = {norm_pn(c) for c in os.environ.get("SKIP_CATALOGS", "").split(",") if c.strip()}
    user_skipped = []
    if skip_set:
        kept = []
        for it in new_items:
            if norm_pn(it.get("_supplier_pn")) in skip_set or norm_pn(it.get("_mfg_pn")) in skip_set:
                user_skipped.append(it["item_name"])
            else:
                kept.append(it)
        new_items = kept

    print(f"Lab: {lab.get('lab_name')} (id {lab.get('id')})")
    print(f"Existing items: {len(existing_items)}  | existing catalog#s indexed: {len(existing_cats)}")
    print(f"ULS rows: {len(rows)}")
    print(f"  REMOVE-flagged (skipped): {len(removed)}  {removed}")
    print(f"  Matched existing by part# (skipped): {len(matched)}")
    for nm, ks in matched:
        print(f"      = {nm}   [{', '.join(ks)}]")
    print(f"  NEW to load: {len(new_items)}")
    # category + UOM distribution of the new set
    from collections import Counter
    print("  NEW category dist:", dict(Counter(i["category"] for i in new_items)))
    print("  NEW unit dist:", dict(Counter(i["usage_unit"] for i in new_items)))
    print("  Sample new items (first 8):")
    for i in new_items[:8]:
        print(f"      - {i['item_name']!r} | cat#{i['catalog_number']} | {i['quantity_on_hand']} {i['usage_unit']} | {i['category']} | reorder {i['reorder_point']}")

    payload = [{k: v for k, v in i.items() if not k.startswith("_")} for i in new_items]
    out = "/tmp/uls_new_items.json"
    try:
        open(out, "w").write(json.dumps(payload, indent=2))
        print(f"\nWrote {len(payload)} new-item payload to {out}")
    except Exception as e:
        print("Could not write payload file:", e)

    if mode == "--commit":
        body = json.dumps({"secret": secret, "labId": LAB_ID, "items": payload}).encode()
        req = urllib.request.Request(
            f"{BASE}/api/admin/import-inventory", data=body,
            headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=60) as resp:
            res = json.loads(resp.read().decode())
        print("\nIMPORT RESULT:", {k: res.get(k) for k in ("ok", "inserted")}, "errors:", len(res.get("errors", [])))
    else:
        print("\n[dry-run] No write performed. Re-run with --commit to load.")


if __name__ == "__main__":
    main()
