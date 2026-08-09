#!/usr/bin/env python3
# Local one-off verifier for the two-phase transfer lifecycle on the VeritaStock
# demo (item 4). Not committed as a CI gate -- the Playwright spec covers Gate 3.
# Drives: send (pending, source decremented, dest unchanged) -> accept (dest
# landed) -> send -> reject (source restored). Net effect washes at the nightly
# demo reset. Run: python scripts/verify_accept_transfer_demo.py
import json, urllib.request, urllib.error, sys

BASE = "https://veritastock-production.up.railway.app"

def call(method, path, token=None, body=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")

def qty_of(token, lab, item_id):
    _, items = call("GET", f"/api/labs/{lab}/inventory", token)
    for it in items:
        if it.get("id") == item_id:
            return it.get("quantity_on_hand")
    return None

def find_dest_qty(token, lab, name, catalog):
    _, items = call("GET", f"/api/labs/{lab}/inventory", token)
    for it in items:
        if catalog and (it.get("catalog_number") or "").strip().lower() == catalog.strip().lower():
            return it.get("quantity_on_hand")
    for it in items:
        if (it.get("item_name") or "").strip().lower() == (name or "").strip().lower():
            return it.get("quantity_on_hand")
    return None  # not present yet

def main():
    fails = []
    # 1. demo login
    st, tok = call("POST", "/api/demo/login", body={})
    token = tok.get("token") or tok.get("accessToken")
    assert token, f"demo login failed: {st} {tok}"
    print("demo login ok")

    # 2. resolve two enterprise locations
    _, labs = call("GET", "/api/labs/me", token)
    labs = [l for l in labs if l.get("labId")]
    assert len(labs) >= 2, f"need >=2 labs, got {labs}"
    # source = the lab with an item that has the most on hand
    src_lab = dst_lab = None
    item = None
    for l in labs:
        _, items = call("GET", f"/api/labs/{l['labId']}/inventory", token)
        stocked = sorted([i for i in items if (i.get("quantity_on_hand") or 0) >= 2],
                         key=lambda i: i["quantity_on_hand"], reverse=True)
        if stocked:
            src_lab = l["labId"]; item = stocked[0]
            dst_lab = next(x["labId"] for x in labs if x["labId"] != src_lab)
            break
    assert item, "no stocked item found in any location"
    iid = item["id"]; name = item["item_name"]; cat = item.get("catalog_number")
    print(f"source lab {src_lab} item {iid} '{name}' qty {item['quantity_on_hand']}; dest lab {dst_lab}")

    src0 = qty_of(token, src_lab, iid)
    dst0 = find_dest_qty(token, dst_lab, name, cat)

    # 3. SEND -> pending, source decremented, dest unchanged
    st, send = call("POST", f"/api/labs/{src_lab}/veritastock/transfer-batch", token,
                    {"to_lab_id": dst_lab, "lines": [{"item_id": iid, "quantity": 1}]})
    assert st == 200 and send.get("status") == "pending", f"send: {st} {send}"
    batch = send["batch_id"]
    src1 = qty_of(token, src_lab, iid)
    dst1 = find_dest_qty(token, dst_lab, name, cat)
    print(f"SEND: status={send['status']} batch={batch[:8]} src {src0}->{src1} dst {dst0}->{dst1}")
    if not (src1 < src0): fails.append("source not decremented on send")
    if dst1 not in (dst0, None): fails.append(f"dest changed on send (should be pending): {dst0}->{dst1}")
    delta = src0 - src1

    # 4. ACCEPT -> dest lands the delta
    st, acc = call("POST", f"/api/labs/{dst_lab}/veritastock/transfers/{batch}/accept", token, {})
    assert st == 200 and acc.get("status") == "accepted", f"accept: {st} {acc}"
    dst2 = find_dest_qty(token, dst_lab, name, cat)
    base = dst0 or 0
    print(f"ACCEPT: status={acc['status']} accepted={acc.get('accepted')} dst {dst1}->{dst2} (expected +{delta})")
    if (dst2 or 0) != base + delta: fails.append(f"dest not incremented by {delta} on accept: {dst0}->{dst2}")

    # 5. SEND again -> REJECT -> source restored, net zero
    src2 = qty_of(token, src_lab, iid)
    st, send2 = call("POST", f"/api/labs/{src_lab}/veritastock/transfer-batch", token,
                     {"to_lab_id": dst_lab, "lines": [{"item_id": iid, "quantity": 1}]})
    assert st == 200, f"send2: {st} {send2}"
    batch2 = send2["batch_id"]
    src3 = qty_of(token, src_lab, iid)
    st, rej = call("POST", f"/api/labs/{dst_lab}/veritastock/transfers/{batch2}/reject", token,
                   {"reason": "verify test - out of temp"})
    assert st == 200 and rej.get("status") == "rejected", f"reject: {st} {rej}"
    src4 = qty_of(token, src_lab, iid)
    print(f"REJECT: status={rej['status']} src {src2}->{src3}(sent)->{src4}(rejected, expected back to {src2})")
    if src4 != src2: fails.append(f"source not restored on reject: {src2} -> {src4}")

    print()
    if fails:
        print("FAIL:")
        for f in fails: print("  -", f)
        sys.exit(1)
    print("PASS: send->pending(source-)/dest-unchanged, accept->dest+, reject->source restored. All correct.")

if __name__ == "__main__":
    main()
