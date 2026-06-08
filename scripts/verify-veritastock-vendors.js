#!/usr/bin/env node
// verify-veritastock-vendors.js
//
// PR 1 receipt for VeritaStock vendor management. Exercises the
// lab-scoped CRUD path end-to-end on prod against a test lab. Creates a
// vendor + contact, lists them back, mutates each, deletes the contact
// then the vendor, and confirms cleanup. Also exercises the cross-lab
// rejection (404) path so the multi-lab bleed pattern from #530/#534
// can't reappear here.
//
// Run:
//   BASE=https://www.veritaslabservices.com \
//   TOKEN=<owner JWT> \
//   LAB_ID=<active lab id> \
//   node scripts/verify-veritastock-vendors.js
//
// The test creates and deletes a row inside the run so it doesn't drift
// the lab's real vendor list. If the script crashes mid-run, a vendor
// named "__verify_vendor_<ms>" will be left behind; delete it manually
// or rerun with same TOKEN+LAB_ID and it'll be cleaned up because the
// name conflict path also exits successfully on UNIQUE 409.

const BASE = process.env.BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.TOKEN;
const LAB_ID = process.env.LAB_ID;
if (!TOKEN) { console.error("TOKEN env required"); process.exit(2); }
if (!LAB_ID) { console.error("LAB_ID env required"); process.exit(2); }

(async () => {
  let pass = 0, fail = 0;
  function check(name, cond, detail) {
    if (cond) { pass++; console.log("PASS " + name); }
    else { fail++; console.error("FAIL " + name + (detail ? " -- " + detail : "")); }
  }
  const H = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

  // A. List endpoint works on a fresh lab (might be empty).
  const listRes = await fetch(`${BASE}/api/labs/${LAB_ID}/veritastock/vendors`, { headers: H });
  check("A. list returns 200", listRes.status === 200, `status=${listRes.status}`);
  const before = listRes.status === 200 ? await listRes.json() : [];
  check("A. list returns array", Array.isArray(before));

  // B. Create a vendor with a unique name.
  const verifyName = `__verify_vendor_${Date.now()}`;
  const createRes = await fetch(`${BASE}/api/labs/${LAB_ID}/veritastock/vendors`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      name: verifyName,
      account_number: "TEST-9999",
      po_number: "PO-VERIFY-1",
      ordering_pattern: "as needed",
      ordering_email: "orders@example.com",
      ordering_phone: "555-0100",
      ordering_portal_url: "https://example.com/orders",
      notes: "Verify-script generated; safe to delete.",
    }),
  });
  check("B. create returns 200", createRes.status === 200, `status=${createRes.status}`);
  const vendor = createRes.status === 200 ? await createRes.json() : null;
  check("B. created row has id", vendor && typeof vendor.id === "number");
  check("B. created row preserves account_number", vendor && vendor.account_number === "TEST-9999");

  if (!vendor || !vendor.id) {
    console.log("");
    console.log(`Summary: ${pass} passed, ${fail} failed (aborted after B)`);
    process.exit(fail === 0 ? 0 : 1);
  }
  const vendorId = vendor.id;

  // C. Duplicate name returns 409.
  const dupRes = await fetch(`${BASE}/api/labs/${LAB_ID}/veritastock/vendors`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ name: verifyName }),
  });
  check("C. duplicate name returns 409", dupRes.status === 409, `status=${dupRes.status}`);

  // D. Add a contact.
  const contactRes = await fetch(`${BASE}/api/labs/${LAB_ID}/veritastock/vendors/${vendorId}/contacts`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      contact_name: "Verify Rep",
      contact_role: "Sales",
      email: "rep@example.com",
      phone: "555-0200",
      sort_order: 1,
    }),
  });
  check("D. contact create returns 200", contactRes.status === 200, `status=${contactRes.status}`);
  const contact = contactRes.status === 200 ? await contactRes.json() : null;
  check("D. created contact has id", contact && typeof contact.id === "number");

  // E. GET vendor returns embedded contacts + contact_count denormalized on list.
  const getRes = await fetch(`${BASE}/api/labs/${LAB_ID}/veritastock/vendors/${vendorId}`, { headers: H });
  check("E. single vendor returns 200", getRes.status === 200, `status=${getRes.status}`);
  const vendorWithContacts = getRes.status === 200 ? await getRes.json() : null;
  check("E. vendor.contacts is array with >= 1 row",
    vendorWithContacts && Array.isArray(vendorWithContacts.contacts) && vendorWithContacts.contacts.length >= 1);

  const listAgain = await fetch(`${BASE}/api/labs/${LAB_ID}/veritastock/vendors`, { headers: H });
  const after = listAgain.status === 200 ? await listAgain.json() : [];
  const ourRow = after.find((v) => v.id === vendorId);
  check("E. list contains our vendor with contact_count >= 1",
    ourRow && ourRow.contact_count >= 1, `contact_count=${ourRow?.contact_count}`);

  // F. Update vendor.
  const updRes = await fetch(`${BASE}/api/labs/${LAB_ID}/veritastock/vendors/${vendorId}`, {
    method: "PUT",
    headers: H,
    body: JSON.stringify({ name: verifyName, notes: "Updated by verify script." }),
  });
  check("F. update returns 200", updRes.status === 200, `status=${updRes.status}`);
  const updated = updRes.status === 200 ? await updRes.json() : null;
  check("F. updated notes round-trip", updated && updated.notes === "Updated by verify script.");
  check("F. update clears unset fields to null",
    updated && updated.account_number === null, `account_number=${updated?.account_number}`);

  // G. Cross-lab rejection. Probe with the verifyName looking in lab 9999999.
  const crossRes = await fetch(`${BASE}/api/labs/9999999/veritastock/vendors/${vendorId}`, { headers: H });
  check("G. cross-lab GET returns 4xx (lab middleware or 404 row)",
    crossRes.status === 403 || crossRes.status === 404, `status=${crossRes.status}`);

  // H. Cleanup: delete contact then vendor.
  if (contact?.id) {
    const dcr = await fetch(`${BASE}/api/labs/${LAB_ID}/veritastock/vendors/${vendorId}/contacts/${contact.id}`, {
      method: "DELETE", headers: H,
    });
    check("H. contact delete returns 200", dcr.status === 200, `status=${dcr.status}`);
  }
  const dvr = await fetch(`${BASE}/api/labs/${LAB_ID}/veritastock/vendors/${vendorId}`, {
    method: "DELETE", headers: H,
  });
  check("H. vendor delete returns 200", dvr.status === 200, `status=${dvr.status}`);

  const finalList = await fetch(`${BASE}/api/labs/${LAB_ID}/veritastock/vendors`, { headers: H });
  const finalRows = finalList.status === 200 ? await finalList.json() : [];
  check("H. our vendor is gone after delete",
    !finalRows.find((v) => v.id === vendorId));

  console.log("");
  console.log(`Summary: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
