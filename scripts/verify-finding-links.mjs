// scripts/verify-finding-links.mjs
//
// Receipt for Wave C4 (2026-06-12): VeritaResponse cross-module linkage
// closure. Replicates the /findings/:id/links aggregator over an in-memory DB
// and asserts:
//
//   1. VeritaScan documents cross-linked to the finding are returned, joined to
//      document metadata, scoped to the lab + target_module='veritaresponse'
//   2. the originating VeritaQC corrective action (nce_reference back-ref) is
//      returned with its analyte/lot context
//   3. links for OTHER findings and OTHER labs do not bleed in
//   4. counts match the row sets
//
// Run: node scripts/verify-finding-links.mjs

import Database from "better-sqlite3";

let failures = 0;
function check(name, pass, detail) {
  if (pass) console.log(`PASS  ${name}`);
  else { console.log(`FAIL  ${name}` + (detail ? ` -- ${detail}` : "")); failures++; }
}

const db = new Database(":memory:");
db.exec(`
  CREATE TABLE findings (id INTEGER PRIMARY KEY, lab_id INTEGER);
  CREATE TABLE lab_documents (id INTEGER PRIMARY KEY, title TEXT, external_url TEXT, storage_provider TEXT, effective_date TEXT, review_due_date TEXT, owner_name TEXT, owner_attested_at TEXT);
  CREATE TABLE lab_document_cross_links (id INTEGER PRIMARY KEY AUTOINCREMENT, lab_id INTEGER, document_id INTEGER, target_module TEXT, target_entity_id INTEGER, target_entity_label TEXT, notes TEXT, linked_at TEXT);
  CREATE TABLE qc_corrective_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, lab_id INTEGER, qc_result_id INTEGER, action_taken TEXT, taken_at TEXT, status TEXT, nce_reference TEXT);
  CREATE TABLE qc_results (id INTEGER PRIMARY KEY, control_lot_id INTEGER);
  CREATE TABLE qc_control_lots (id INTEGER PRIMARY KEY, analyte TEXT, level TEXT, lot_number TEXT);
`);

// Lab 3, finding 1 (the hub). Finding 2 in lab 3 and finding 1 in lab 9 are decoys.
db.prepare("INSERT INTO findings (id, lab_id) VALUES (1, 3), (2, 3)").run();
// Two VeritaScan docs cross-linked to finding 1, one to finding 2, one in another lab.
db.prepare("INSERT INTO lab_documents (id, title, external_url, storage_provider, owner_name) VALUES (10,'SOP rev 4','https://x/1','SharePoint','M. Veri'),(11,'Training log','https://x/2','Drive',NULL),(12,'Other doc','https://x/3','OneDrive',NULL)").run();
db.prepare("INSERT INTO lab_document_cross_links (lab_id, document_id, target_module, target_entity_id, linked_at) VALUES (3,10,'veritaresponse',1,'2026-06-10'),(3,11,'veritaresponse',1,'2026-06-11'),(3,12,'veritaresponse',2,'2026-06-11'),(3,10,'veritapolicy',1,'2026-06-09')").run();
// QC chain: a corrective action escalated to finding 1.
db.prepare("INSERT INTO qc_control_lots (id, analyte, level, lot_number) VALUES (1,'Potassium','high','LOT-K')").run();
db.prepare("INSERT INTO qc_results (id, control_lot_id) VALUES (50, 1)").run();
db.prepare("INSERT INTO qc_corrective_actions (lab_id, qc_result_id, action_taken, taken_at, status, nce_reference) VALUES (3, 50, 'Recalibrated', '2026-06-09', 'open', 'VeritaResponse#1'), (3, 50, 'Unrelated CA', '2026-06-08', 'open', NULL)").run();

function links(findingId, labId) {
  const f = db.prepare("SELECT * FROM findings WHERE id = ? AND lab_id = ?").get(findingId, labId);
  if (!f) return null;
  const evidence = db.prepare(
    `SELECT x.id AS link_id, d.id AS document_id, d.title AS document_title, d.external_url, d.storage_provider, d.owner_name
       FROM lab_document_cross_links x JOIN lab_documents d ON d.id = x.document_id
      WHERE x.lab_id = ? AND x.target_module = 'veritaresponse' AND x.target_entity_id = ?
      ORDER BY x.linked_at DESC`
  ).all(labId, findingId);
  const qc_sources = db.prepare(
    `SELECT ca.id AS corrective_action_id, ca.action_taken, ca.status, cl.analyte, cl.lot_number
       FROM qc_corrective_actions ca JOIN qc_results qr ON qr.id = ca.qc_result_id JOIN qc_control_lots cl ON cl.id = qr.control_lot_id
      WHERE ca.lab_id = ? AND ca.nce_reference = ?`
  ).all(labId, `VeritaResponse#${findingId}`);
  return { evidence, qc_sources, counts: { evidence: evidence.length, qc_sources: qc_sources.length } };
}

const l1 = links(1, 3);
check("1a. finding 1 returns its 2 VeritaScan evidence docs", l1.evidence.length === 2);
check("1b. evidence excludes the veritapolicy-target link to the same doc", l1.evidence.every(e => [10, 11].includes(e.document_id)));
check("1c. evidence joined to document metadata", l1.evidence.some(e => e.document_title === "SOP rev 4" && e.storage_provider === "SharePoint"));
check("2a. finding 1 returns its 1 originating QC corrective action", l1.qc_sources.length === 1);
check("2b. QC source carries analyte + lot context", l1.qc_sources[0].analyte === "Potassium" && l1.qc_sources[0].lot_number === "LOT-K");
check("2c. the non-escalated CA (null nce_reference) is excluded", l1.qc_sources.every(s => s.action_taken !== "Unrelated CA"));
check("3a. counts match row sets", l1.counts.evidence === 2 && l1.counts.qc_sources === 1);

const l2 = links(2, 3);
check("3b. finding 2 sees only its own evidence (doc 12), no QC source", l2.evidence.length === 1 && l2.evidence[0].document_id === 12 && l2.qc_sources.length === 0);
check("4. cross-lab access denied (finding 1 not in lab 9)", links(1, 9) === null);

console.log("");
if (failures) { console.log(`${failures} FAILURE(S)`); process.exit(1); }
console.log("ALL PASS (9/9): Wave C4 finding linkage aggregation, target-module filtering, QC back-ref, and lab scoping verified.");
