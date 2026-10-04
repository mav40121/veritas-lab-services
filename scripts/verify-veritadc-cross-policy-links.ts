// Verify receipt for the VeritaDC cross-policy link queries (#39).
// Exercises the SAME SQL the GET .../documents/:id/links endpoint runs against
// an in-memory SQLite: outgoing "references", incoming "referenced by", and the
// candidate list (other active docs, excluding self and already-linked targets).
//
// Run: npx tsx scripts/verify-veritadc-cross-policy-links.ts
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const db = new Database(":memory:");
db.exec(`
  CREATE TABLE policy_documents (id INTEGER PRIMARY KEY, lab_id INTEGER, title TEXT, status TEXT, archived_at TEXT);
  CREATE TABLE policy_document_links (id INTEGER PRIMARY KEY, lab_id INTEGER, from_document_id INTEGER, to_document_id INTEGER, note TEXT);
`);
// Lab 1: A(1) references B(2); C(3) references A(1); D(4) unlinked; E(5) archived.
for (const [id, title, arch] of [[1, "A", null], [2, "B", null], [3, "C", null], [4, "D", null], [5, "E", "2026-01-01"]] as const)
  db.prepare("INSERT INTO policy_documents (id,lab_id,title,status,archived_at) VALUES (?,1,?,'approved',?)").run(id, title, arch);
db.prepare("INSERT INTO policy_document_links (lab_id,from_document_id,to_document_id) VALUES (1,1,2)").run(); // A->B
db.prepare("INSERT INTO policy_document_links (lab_id,from_document_id,to_document_id) VALUES (1,3,1)").run(); // C->A

function linksFor(id: number) {
  const references = db.prepare(
    `SELECT d.id AS document_id, d.title FROM policy_document_links l JOIN policy_documents d ON d.id = l.to_document_id
      WHERE l.from_document_id = ? AND l.lab_id = 1 AND d.archived_at IS NULL ORDER BY d.title`).all(id) as any[];
  const referencedBy = db.prepare(
    `SELECT d.id AS document_id, d.title FROM policy_document_links l JOIN policy_documents d ON d.id = l.from_document_id
      WHERE l.to_document_id = ? AND l.lab_id = 1 AND d.archived_at IS NULL ORDER BY d.title`).all(id) as any[];
  const linked = new Set(references.map((r) => r.document_id));
  const candidates = (db.prepare(
    `SELECT id, title FROM policy_documents WHERE lab_id = 1 AND id != ? AND archived_at IS NULL ORDER BY title`).all(id) as any[])
    .filter((c) => !linked.has(c.id));
  return { references: references.map((r) => r.title), referencedBy: referencedBy.map((r) => r.title), candidates: candidates.map((c) => c.title) };
}

const a = linksFor(1);
const cases: Array<[string, any, any]> = [
  ["A references [B]", a.references, ["B"]],
  ["A referenced by [C]", a.referencedBy, ["C"]],
  ["A candidates exclude self + linked B + archived E -> [C,D]", a.candidates, ["C", "D"]],
  ["D (unlinked) references []", linksFor(4).references, []],
  ["D candidates = [A,B,C] (archived E excluded)", linksFor(4).candidates, ["A", "B", "C"]],
];
let pass = 0, fail = 0;
for (const [name, got, exp] of cases) {
  const ok = JSON.stringify(got) === JSON.stringify(exp);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (exp ${JSON.stringify(exp)}, got ${JSON.stringify(got)})`);
  ok ? pass++ : fail++;
}
console.log(`\n${pass}/${cases.length} passed, ${fail} failed`);
if (fail) process.exit(1);
