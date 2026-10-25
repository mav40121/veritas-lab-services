// scripts/verify-zod-schemas.ts
//
// Zod 3 -> 4 upgrade (2026-10-25, security scan: zod < 4.6.6 can exhaust memory on oversized input). The four request
// schemas in shared/schema.ts (register, login, contact form, study save) must accept and reject exactly what they did
// before. Each case prints PASS/FAIL against the outcome recorded under Zod 3 in
// scripts/fixtures/zod-schemas-expected.json: success, the parsed data, and which fields failed.
//   npx tsx scripts/verify-zod-schemas.ts            compare against the recorded outcomes (exit 1 on any difference)
//   npx tsx scripts/verify-zod-schemas.ts --record   record the outcomes (run once, on the old version)
import { readFileSync, writeFileSync } from "node:fs";
import { loginSchema, registerSchema, insertContactSchema, insertStudySchema } from "../shared/schema";

const FIXTURE = new URL("./fixtures/zod-schemas-expected.json", import.meta.url);
// Test passwords are built at run time (a long one passes min(6), a short one fails it) so no credential-shaped literal
// sits in the source; outcomes record "<redacted>" in place of any password.
const PW = "x".repeat(9), SHORT = "x".repeat(3);
const study = {
  testName: "Glucose", instrument: "Analyzer A", analyst: "Tech One", date: "2026-10-25", studyType: "cal_ver",
  cliaAllowableError: 0.1, dataPoints: "[]", instruments: "[\"Analyzer A\"]", createdAt: "2026-10-25T00:00:00Z",
};
const cases: Array<[string, { safeParse: (v: unknown) => any }, unknown]> = [
  ["login: valid", loginSchema, { email: "tech@example.org", password: PW }],
  ["login: plus address", loginSchema, { email: "a+b@example.org", password: PW }],
  ["login: apostrophe", loginSchema, { email: "o'brien@example.org", password: PW }],
  ["login: upper case", loginSchema, { email: "TECH@EXAMPLE.ORG", password: PW }],
  ["login: subdomain", loginSchema, { email: "x.y@mail.example.net", password: PW }],
  ["login: hyphen domain", loginSchema, { email: "a@my-lab.example.com", password: PW }],
  ["login: not an email", loginSchema, { email: "not-an-email", password: PW }],
  ["login: double dot", loginSchema, { email: "a..b@example.org", password: PW }],
  ["login: short password", loginSchema, { email: "tech@example.org", password: SHORT }],
  ["login: missing password", loginSchema, { email: "tech@example.org" }],
  ["login: extra field dropped", loginSchema, { email: "tech@example.org", password: PW, role: "admin" }],
  ["register: valid", registerSchema, { email: "new@example.org", password: PW, name: "New Person", hipaa_acknowledged: true }],
  ["register: no acknowledgment", registerSchema, { email: "new@example.org", password: PW, name: "New Person" }],
  ["register: empty name", registerSchema, { email: "new@example.org", password: PW, name: "" }],
  ["register: acknowledgment as text", registerSchema, { email: "new@example.org", password: PW, name: "N", hipaa_acknowledged: "true" }],
  ["contact: valid", insertContactSchema, { name: "A", email: "a@example.org", message: "Hello" }],
  ["contact: missing message", insertContactSchema, { name: "A", email: "a@example.org" }],
  ["contact: any email text", insertContactSchema, { name: "A", email: "anything", message: "Hi" }],
  ["contact: createdAt dropped", insertContactSchema, { name: "A", email: "a@example.org", message: "Hi", createdAt: "x" }],
  ["study: required fields only", insertStudySchema, study],
  ["study: optional fields set", insertStudySchema, { ...study, userId: 7, status: "draft", teaIsPercentage: 0, teaUnit: "mg/dL", cliaAbsoluteFloor: 6, vendorSd: 1.2, controlLot: "L1", material: "Cal set" }],
  ["study: optional fields null", insertStudySchema, { ...study, userId: null, cliaAbsoluteFloor: null, controlLot: null, comment: null }],
  ["study: TEa as text", insertStudySchema, { ...study, cliaAllowableError: "0.1" }],
  ["study: missing instrument", insertStudySchema, { ...study, instrument: undefined }],
  ["study: unknown field dropped", insertStudySchema, { ...study, hacker: true }],
  ["study: decimal user id", insertStudySchema, { ...study, userId: 1.5 }],
];

const outcome = (schema: { safeParse: (v: unknown) => any }, input: unknown) => {
  const r = schema.safeParse(input);
  if (r.success) { const data = { ...r.data }; if ("password" in data) data.password = "<redacted>"; return { success: true, data: JSON.stringify(data, Object.keys(data).sort()) }; }
  const f = r.error.flatten();
  return { success: false, fields: Object.keys(f.fieldErrors).sort(), formErrors: f.formErrors.length };
};
const results = Object.fromEntries(cases.map(([name, s, input]) => [name, outcome(s, input)]));

if (process.argv.includes("--record")) {
  writeFileSync(FIXTURE, JSON.stringify(results, null, 1) + "\n");
  console.log(`recorded ${cases.length} cases`);
  process.exit(0);
}
const expected = JSON.parse(readFileSync(FIXTURE, "utf8"));
let failures = 0;
for (const [name] of cases) {
  const same = JSON.stringify(results[name]) === JSON.stringify(expected[name]);
  if (!same) failures++;
  console.log(`${same ? "PASS" : "FAIL"}  ${name}${same ? "" : `  :: expected ${JSON.stringify(expected[name])} got ${JSON.stringify(results[name])}`}`);
}
console.log(failures ? `${failures} FAIL` : `ALL PASS (${cases.length} cases)`);
process.exit(failures ? 1 : 0);
