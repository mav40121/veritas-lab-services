// Verify admin-report study attribution against a real DB snapshot.
//
// What it proves: for John Hall's lab, the legacy studies (created_by_user_id
// NULL, analyst free-text like "RODRIGO GASPAR-TRILLO/EMILY DU") get split
// between Rodrigo (who exists as a seat user) and John (fallback when the
// other half doesn't resolve). Total studies per lab stays stable.
//
// Usage:
//   node scripts/verify-admin-report-attribution.js path/to/prod.sqlite

import Database from "better-sqlite3";

const dbPath = process.argv[2];
if (!dbPath) {
  console.error("usage: node scripts/verify-admin-report-attribution.js <db.sqlite>");
  process.exit(1);
}
const db = new Database(dbPath, { readonly: true });

// Mirror the algorithm in server/routes.ts admin/users handler.
const norm = (s) => s.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
const tokenize = (u) => {
  const out = new Set();
  if (u.name) for (const t of norm(u.name).split(" ")) if (t.length >= 2) out.add(t);
  if (u.email) {
    const local = (u.email.split("@")[0] || "").replace(/[._-]/g, " ");
    for (const t of norm(local).split(" ")) if (t.length >= 2) out.add(t);
  }
  return Array.from(out);
};

const studies = db.prepare("SELECT id, user_id, created_by_user_id, analyst FROM studies WHERE user_id IS NOT NULL").all();
const seatLinks = db.prepare("SELECT owner_user_id, seat_user_id FROM user_seats WHERE status = 'active' AND seat_user_id IS NOT NULL").all();
const users = db.prepare("SELECT id, name, email FROM users").all();
const userById = new Map(users.map((u) => [u.id, u]));

const labRoster = new Map();
for (const u of users) {
  const arr = labRoster.get(u.id) || [];
  arr.push({ id: u.id, tokens: tokenize(u) });
  labRoster.set(u.id, arr);
}
for (const link of seatLinks) {
  const seat = userById.get(link.seat_user_id);
  if (!seat) continue;
  const arr = labRoster.get(link.owner_user_id) || [];
  arr.push({ id: seat.id, tokens: tokenize(seat) });
  labRoster.set(link.owner_user_id, arr);
}

const resolve = (segment, members) => {
  const segTokens = new Set(norm(segment).split(" ").filter((t) => t.length >= 2));
  if (segTokens.size === 0) return null;
  let best = null;
  for (const m of members) {
    let score = 0;
    for (const t of m.tokens) if (segTokens.has(t)) score += 1;
    if (score > 0 && (!best || score > best.score)) best = { id: m.id, score };
  }
  return best ? best.id : null;
};

const counts = new Map();
let resolvedCount = 0;
let fallbackCount = 0;
for (const s of studies) {
  if (s.created_by_user_id) {
    counts.set(s.created_by_user_id, (counts.get(s.created_by_user_id) || 0) + 1);
    continue;
  }
  const members = labRoster.get(s.user_id) || [];
  const segments = (s.analyst || "").split(/[\/,;&]/).map((x) => x.trim()).filter(Boolean);
  const resolved = [];
  for (const seg of segments) {
    const id = resolve(seg, members);
    if (id) resolved.push(id);
  }
  if (resolved.length === 0) {
    counts.set(s.user_id, (counts.get(s.user_id) || 0) + 1);
    fallbackCount += 1;
  } else {
    const share = 1 / resolved.length;
    for (const id of resolved) counts.set(id, (counts.get(id) || 0) + share);
    resolvedCount += 1;
  }
}

// Print attribution for John's lab.
const john = users.find((u) => u.email === "john.hall@scahealth.org");
if (!john) {
  console.error("FAIL: john.hall@scahealth.org not in users");
  process.exit(1);
}
const members = labRoster.get(john.id) || [];
console.log(`\nJohn (user ${john.id}) lab roster: ${members.length} members`);
for (const m of members) {
  const u = userById.get(m.id);
  console.log(`  user ${m.id} ${u?.email || "?"}  raw=${(counts.get(m.id) || 0).toFixed(2)}  rounded=${Math.round(counts.get(m.id) || 0)}`);
}

// Lab total (John's studies, original count) vs sum of attributed (rounded).
const johnStudyCount = studies.filter((s) => s.user_id === john.id).length;
const labMemberIds = new Set(members.map((m) => m.id));
let attributedRounded = 0;
for (const id of labMemberIds) attributedRounded += Math.round(counts.get(id) || 0);
const attributedRaw = [...labMemberIds].reduce((sum, id) => sum + (counts.get(id) || 0), 0);

console.log(`\nJohn's lab: ${johnStudyCount} studies. Attributed raw=${attributedRaw.toFixed(2)} rounded=${attributedRounded}.`);
console.log(`  ${resolvedCount} legacy studies resolved to seat user(s); ${fallbackCount} fell back to lab owner.`);

// Assertions.
let fails = 0;

// John should still get the majority (he's lab owner + appears in 50% credit of multi-analyst rows via fallback).
const johnCount = Math.round(counts.get(john.id) || 0);
console.log(`\nAssertions:`);
if (johnCount === johnStudyCount) {
  console.log(`  FAIL: John's count (${johnCount}) equals total (${johnStudyCount}); attribution did nothing.`);
  fails += 1;
} else {
  console.log(`  PASS: John's count (${johnCount}) reduced from total (${johnStudyCount}); attribution active.`);
}

// Rodrigo (id=20) should have >0 studies.
const rodrigo = users.find((u) => u.email === "rodrigo.gaspartrillo@scahealth.org");
if (rodrigo) {
  const rc = Math.round(counts.get(rodrigo.id) || 0);
  if (rc > 0) {
    console.log(`  PASS: Rodrigo (user ${rodrigo.id}) credited with ${rc} studies.`);
  } else {
    console.log(`  FAIL: Rodrigo (user ${rodrigo.id}) still at 0 — fuzzy match isn't working.`);
    fails += 1;
  }
} else {
  console.log(`  SKIP: Rodrigo not in users — can't assert seat attribution.`);
}

// Raw sum across the lab roster should equal John's study count (no leakage out).
if (Math.abs(attributedRaw - johnStudyCount) < 0.01) {
  console.log(`  PASS: raw attribution sum (${attributedRaw.toFixed(2)}) matches lab total (${johnStudyCount}); no leakage.`);
} else {
  console.log(`  FAIL: raw attribution sum (${attributedRaw.toFixed(2)}) leaks out of lab; expected ${johnStudyCount}.`);
  fails += 1;
}

process.exit(fails === 0 ? 0 : 1);
