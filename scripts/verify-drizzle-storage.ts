// scripts/verify-drizzle-storage.ts
//
// Drizzle ORM 0.39 -> 0.45 upgrade (2026-10-25, security scan: drizzle-orm < 0.45.2 SQL injection via improperly
// escaped identifiers; VeritaAssure never builds identifiers from input, but the scan flags the version). The only
// Drizzle query-builder calls are the 16 in server/storage.ts (users, studies, contact messages). This drives every one
// of them against a throwaway database and compares the results with those recorded under 0.39 in
// scripts/fixtures/drizzle-storage-expected.json. Ids and timestamps are normalized so the comparison is about shape,
// values, ordering and row counts.
//   rm -f .tmp-verify-drizzle.db && DB_PATH=.tmp-verify-drizzle.db JWT_SECRET=x npx tsx scripts/verify-drizzle-storage.ts [--record]
import { readFileSync, writeFileSync } from "node:fs";
import { storage } from "../server/storage";
import { db } from "../server/db";

const FIXTURE = new URL("./fixtures/drizzle-storage-expected.json", import.meta.url);
const sqlite = (db as any).$client;
const norm = (v: any): any => {
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, /^(id|createdAt|created_at|userId|createdByUserId|passwordHash)$/.test(k) && v[k] != null ? "<set>" : norm(v[k])]));
  return v;
};
const out: Record<string, unknown> = {};
const step = (name: string, fn: () => unknown) => { try { out[name] = norm(fn()); } catch (e: any) { out[name] = { threw: e?.constructor?.name, sqlite: e?.cause?.code ?? e?.code ?? null } } };

const email = "Drizzle.Check@Example.org";
let uid = 0, s1 = 0, s2 = 0;
step("createUser", () => { const u = storage.createUser(email.toLowerCase(), "x".repeat(12), "Drizzle Check"); uid = u.id; return u; });
step("createUser duplicate email throws", () => storage.createUser(email.toLowerCase(), "x".repeat(12), "Dup"));
step("getUserByEmail (mixed case input)", () => storage.getUserByEmail(email));
step("getUserById", () => storage.getUserById(uid));
step("getUserById missing", () => storage.getUserById(999999) ?? null);
step("updateUserPlan", () => { storage.updateUserPlan(uid, "annual", 5); return storage.getUserById(uid); });
step("updateUserStripe", () => { storage.updateUserStripe(uid, { stripeCustomerId: "cus_check", stripeSubscriptionId: null, plan: "per_study" }); return storage.getUserById(uid); });
step("updateUserStripe nothing to set", () => { storage.updateUserStripe(uid, {}); return storage.getUserById(uid); });
step("getUserByStripeCustomerId", () => storage.getUserByStripeCustomerId("cus_check"));
step("addStudyCredits", () => { storage.addStudyCredits(uid, 3); return storage.getUserById(uid); });
const study = (testName: string) => ({ userId: uid, createdByUserId: uid, testName, instrument: "Analyzer A", analyst: "Tech", date: "2026-10-25",
  studyType: "cal_ver", cliaAllowableError: 0.1, dataPoints: "[]", instruments: "[\"Analyzer A\"]", createdAt: "2026-10-25T00:00:00Z" } as any);
step("createStudy (returning)", () => { const s = storage.createStudy(study("Sodium")); s1 = s.id; return s; });
step("createStudy second", () => { const s = storage.createStudy({ ...study("Potassium"), status: "draft", controlLot: "L1", comment: "it's \"quoted\"; DROP TABLE x" }); s2 = s.id; return s; });
// Throwaway database: lab 4242 does not exist, so the foreign-key check is off for this one statement only.
sqlite.pragma("foreign_keys = OFF");
sqlite.prepare("UPDATE studies SET lab_id = 4242 WHERE id = ?").run(s1);
sqlite.pragma("foreign_keys = ON");
step("getStudy", () => storage.getStudy(s2));
step("getStudiesByUser (newest first)", () => storage.getStudiesByUser(uid).map((s) => s.testName));
step("getStudiesByLab", () => storage.getStudiesByLab(4242).map((s) => s.testName));
step("getStudiesByLabForUser", () => storage.getStudiesByLabForUser(4242, uid).map((s) => s.testName));
step("getAllStudies contains both", () => storage.getAllStudies().filter((s) => s.userId === uid).map((s) => s.testName));
step("updateStudyStatus", () => { storage.updateStudyStatus(s2, "completed"); return storage.getStudy(s2)?.status; });
step("deleteStudy", () => { storage.deleteStudy(s1); return storage.getStudy(s1) ?? null; });
step("createContactMessage", () => { storage.createContactMessage({ name: "A", email: "a@example.org", message: "Hello" } as any);
  return norm(sqlite.prepare("SELECT name, email, message FROM contact_messages ORDER BY id DESC LIMIT 1").get()); });

if (process.argv.includes("--record")) {
  writeFileSync(FIXTURE, JSON.stringify(out, null, 1) + "\n");
  console.log(`recorded ${Object.keys(out).length} steps`);
  process.exit(0);
}
const expected = JSON.parse(readFileSync(FIXTURE, "utf8"));
let failures = 0;
for (const k of Object.keys(expected)) {
  const same = JSON.stringify(out[k]) === JSON.stringify(expected[k]);
  if (!same) failures++;
  console.log(`${same ? "PASS" : "FAIL"}  ${k}${same ? "" : `  :: expected ${JSON.stringify(expected[k]).slice(0, 300)} got ${JSON.stringify(out[k]).slice(0, 300)}`}`);
}
console.log(failures ? `${failures} FAIL` : `ALL PASS (${Object.keys(expected).length} steps)`);
process.exit(failures ? 1 : 0);
