#!/usr/bin/env python3
"""
seed_demo_on_order.py — make the on-order / receive features visible in the
San Carlos VeritaStock demo by putting a few hero items on an open PO.

The on_order_qty + on_order_expected_date columns default to 0/NULL, so freshly
seeded demo data shows a blank On Order column and no Receive buttons. This
targets three hero items and sets an open PO on each, via a FULL-object PUT to
/api/inventory/:id (the PUT endpoint is a full-replace that zeroes omitted
numeric fields, so we read the row first and send every field back).

Demo story it sets up:
  - Main Lab #284 (Anaerobic blood culture bottle): currently Reorder Now; an
    open PO of 214 pushes inventory position above the reorder point, so the
    Reorder Now flag clears -> shows the system will not double-order inbound.
  - Main Lab #270 (Tosoh #1 reagent, $185): high-value item with an open PO ->
    a clean live "Receive" demo (receive 4 -> on hand 1 becomes 5).
  - Warehouse #216 (Tosoh #1 reagent): warehouse-side open PO + receive option.

Run:
  DEMO_PASSWORD=... python scripts/seed_demo_on_order.py
"""
import json
import os
import sys
import urllib.request

BASE = os.environ.get("VS_BASE", "https://veritastock-production.up.railway.app")
EMAIL = os.environ.get("DEMO_EMAIL", "info@veritaslabservices.com")
PASSWORD = os.environ.get("DEMO_PASSWORD", "")

# (item_id, lab_id, on_order_qty, expected_date)
TARGETS = [
    (284, 4, 214, "2026-06-27"),   # Anaerobic BC bottle: PO covers shortfall -> reorder flag clears
    (270, 4, 4,   "2026-06-25"),   # Tosoh #1 reagent (Main Lab): receive demo
    (216, 2, 4,   "2026-07-03"),   # Tosoh #1 reagent (Warehouse): on-order + receive
]

# Fields the PUT endpoint writes; we echo them back so the full-replace keeps them.
ECHO_FIELDS = [
    "item_name", "catalog_number", "lot_number", "department", "category",
    "quantity_on_hand", "unit", "expiration_date", "vendor", "storage_location",
    "notes", "status", "burn_rate", "order_unit", "usage_unit",
    "units_per_order_unit", "count_unit", "units_per_count_unit",
    "lead_time_days", "safety_stock_days", "desired_days_of_stock",
    "standing_order", "standing_order_review_date", "barcode_value", "unit_cost",
]


def api(method, path, token=None, body=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode())


def main():
    if not PASSWORD:
        print("DEMO_PASSWORD env var required")
        sys.exit(1)
    token = api("POST", "/api/auth/login", body={"email": EMAIL, "password": PASSWORD}).get("token")
    if not token:
        print("login failed")
        sys.exit(1)

    # Cache each lab's inventory once.
    lab_cache = {}
    def get_item(lab_id, item_id):
        if lab_id not in lab_cache:
            d = api("GET", f"/api/labs/{lab_id}/inventory", token=token)
            lab_cache[lab_id] = d if isinstance(d, list) else d.get("items", [])
        for it in lab_cache[lab_id]:
            if it.get("id") == item_id:
                return it
        return None

    for item_id, lab_id, qty, eta in TARGETS:
        row = get_item(lab_id, item_id)
        if not row:
            print(f"  SKIP id={item_id}: not found in lab {lab_id}")
            continue
        payload = {f: row.get(f) for f in ECHO_FIELDS}
        payload["on_order_qty"] = qty
        payload["on_order_expected_date"] = eta
        updated = api("PUT", f"/api/inventory/{item_id}", token=token, body=payload)
        print(f"  id={item_id} {row.get('item_name')[:30]:30} -> on_order={updated.get('on_order_qty')} "
              f"eta={updated.get('on_order_expected_date')} on_hand={updated.get('quantity_on_hand')} "
              f"needs_reorder={updated.get('needs_reorder')} position={updated.get('inventory_position')}")

    api("POST", "/api/auth/logout", token=token, body={})
    print("done")


if __name__ == "__main__":
    main()
