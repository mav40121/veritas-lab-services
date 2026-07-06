// scripts/verify-signoff-groups.mjs
// Proves VeritaCheck Sign-off Groups Phase 1: studies are assigned to a group as
// they become ready, ineligible ones are skipped (not fatal), and the mass Sign
// and Lock finalizes every draft member in one action while writing each study's
// own finalized signature (identical to the single-study finalize) and skipping
// already-finalized members. Mirrors the exact SQL/logic in server/routes.ts.
// Run: node scripts/verify-signoff-groups.mjs
import Database from "better-sqlite3";

let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log("PASS  " + n); } else { fail++; console.log("FAIL  " + n); } };

const db = new Database(":memory:");
db.exec(`
  CREATE TABLE study_signoff_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT, lab_id INTEGER, name TEXT NOT NULL,
    due_date TEXT, status TEXT NOT NULL DEFAULT 'open', created_by_user_id INTEGER,
    created_at TEXT, signed_at TEXT, signed_by_user_id INTEGER
  );
  CREATE TABLE studies (
    id INTEGER PRIMARY KEY AUTOINCREMENT, lab_id INTEGER, test_name TEXT,
    lifecycle_state TEXT NOT NULL DEFAULT 'draft', archived_at TEXT,
    signoff_group_id INTEGER, amends_study_id INTEGER,
    finalized_at TEXT, finalized_by_user_id INTEGER, finalized_signature TEXT
  );
`);
const now = "2026-07-27T00:00:00Z";

// ── Mirrors of the endpoint logic ──────────────────────────────────────────
function createGroup(labId, name) {
  return db.prepare("INSERT INTO study_signoff_groups (lab_id,name,status,created_at) VALUES (?,?,'open',?)").run(labId, name, "t").lastInsertRowid;
}
function addStudies(labId, groupId, ids) {
  const group = db.prepare("SELECT * FROM study_signoff_groups WHERE id=? AND lab_id=?").get(groupId, labId);
  if (!group || group.status !== 'open') return { error: true };
  const added = [], skipped = [];
  for (const sid of ids) {
    const s = db.prepare("SELECT id,lifecycle_state,archived_at,signoff_group_id FROM studies WHERE id=? AND lab_id=?").get(sid, labId);
    if (!s) { skipped.push({ id: sid, reason: "not found in this lab" }); continue; }
    if (s.archived_at) { skipped.push({ id: sid, reason: "archived" }); continue; }
    if (s.lifecycle_state === 'finalized') { skipped.push({ id: sid, reason: "already finalized" }); continue; }
    if (s.signoff_group_id && s.signoff_group_id !== groupId) { skipped.push({ id: sid, reason: "already in another group" }); continue; }
    db.prepare("UPDATE studies SET signoff_group_id=? WHERE id=?").run(groupId, sid);
    added.push(sid);
  }
  return { added, skipped };
}
function removeStudy(labId, groupId, studyId) {
  const group = db.prepare("SELECT * FROM study_signoff_groups WHERE id=? AND lab_id=?").get(groupId, labId);
  if (!group || group.status !== 'open') return { error: true };
  const r = db.prepare("UPDATE studies SET signoff_group_id=NULL WHERE id=? AND lab_id=? AND signoff_group_id=?").run(studyId, labId, groupId);
  return { removed: r.changes };
}
function finalizeInPlace(userId, s, signature) {
  db.prepare("UPDATE studies SET lifecycle_state='finalized', finalized_at=?, finalized_by_user_id=?, finalized_signature=? WHERE id=?").run(now, userId, signature, s.id);
}
function signGroup(labId, groupId, userId, signature) {
  const group = db.prepare("SELECT * FROM study_signoff_groups WHERE id=? AND lab_id=?").get(groupId, labId);
  if (!group) return { error: "not found" };
  if (group.status === 'signed') return { error: "already signed" };
  if (!signature) return { error: "signature required" };
  const members = db.prepare("SELECT * FROM studies WHERE signoff_group_id=? AND lab_id=? AND archived_at IS NULL").all(groupId, labId);
  if (members.length === 0) return { error: "empty" };
  let signed = 0, skipped = 0;
  for (const s of members) {
    if (s.lifecycle_state === 'finalized') { skipped++; continue; }
    finalizeInPlace(userId, s, signature); signed++;
  }
  db.prepare("UPDATE study_signoff_groups SET status='signed', signed_at=?, signed_by_user_id=? WHERE id=?").run(now, userId, groupId);
  return { signed, skipped, total: members.length };
}

// Seed: lab 1 with 4 studies (3 draft + 1 archived) + 1 already-finalized; lab 2 has 1 study.
const ins = db.prepare("INSERT INTO studies (id,lab_id,test_name,lifecycle_state,archived_at) VALUES (?,?,?,?,?)");
ins.run(1, 1, "Glucose corr", "draft", null);
ins.run(2, 1, "Sodium corr", "draft", null);
ins.run(3, 1, "Potassium corr", "draft", null);
ins.run(4, 1, "Old archived", "draft", "2026-01-01");
ins.run(5, 1, "Already signed", "finalized", null);
ins.run(6, 2, "Other lab study", "draft", null);

const g = createGroup(1, "San Carlos Biannual, due 7/27");

// 1. Add-when-ready, incrementally.
const a1 = addStudies(1, g, [1]);
check("add-when-ready: first study added incrementally", a1.added.length === 1 && a1.added[0] === 1);
const a2 = addStudies(1, g, [2, 3]);
check("add-when-ready: more studies added later to the same group", a2.added.length === 2);
check("all three drafts now carry the group id", db.prepare("SELECT COUNT(*) n FROM studies WHERE signoff_group_id=?").get(g).n === 3);

// 2. Eligibility skips (not fatal).
const a3 = addStudies(1, g, [4, 5, 6, 999]);
const reasons = Object.fromEntries(a3.skipped.map(s => [s.id, s.reason]));
check("skip archived study", reasons[4] === "archived");
check("skip already-finalized study", reasons[5] === "already finalized");
check("skip study from another lab (not found in this lab)", reasons[6] === "not found in this lab");
check("skip nonexistent id", reasons[999] === "not found in this lab");
check("none of the ineligible studies were added", a3.added.length === 0);

// 3. Remove one before signing.
check("remove a study from the open group", removeStudy(1, g, 3).removed === 1);
check("removed study no longer in the group", db.prepare("SELECT signoff_group_id FROM studies WHERE id=3").get().signoff_group_id === null);

// 4. Put study 3 back, and also add the already-finalized #5 is not possible; sign the group.
addStudies(1, g, [3]);
// Manually place a finalized study in the group to prove the sign skips it (models an amend re-add edge).
db.prepare("UPDATE studies SET signoff_group_id=? WHERE id=5").run(g);
const signRes = signGroup(1, g, 42, "Michael Veri, MD");
check("mass sign finalizes the 3 draft members", signRes.signed === 3);
check("mass sign skips the already-finalized member (not re-signed)", signRes.skipped === 1);
check("every draft member is now finalized with the signature", db.prepare("SELECT COUNT(*) n FROM studies WHERE signoff_group_id=? AND lifecycle_state='finalized' AND finalized_signature='Michael Veri, MD'").get(g).n === 3);
check("each finalized member carries the signer + timestamp", db.prepare("SELECT COUNT(*) n FROM studies WHERE signoff_group_id=? AND finalized_by_user_id=42 AND finalized_at=?").get(g, now).n === 3);
check("group is marked signed", db.prepare("SELECT status FROM study_signoff_groups WHERE id=?").get(g).status === 'signed');

// 5. Guardrails after signing.
check("cannot add studies to a signed group", addStudies(1, g, [1]).error === true);
check("cannot re-sign a signed group", signGroup(1, g, 42, "x").error === "already signed");

// 6. Cross-lab isolation: lab 2 cannot sign lab 1's group.
check("another lab cannot access this group", signGroup(2, g, 99, "x").error === "not found");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
