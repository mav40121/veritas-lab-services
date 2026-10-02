// scripts/verify-veritascan-custom-items.mjs
//
// Gate-3 receipt for parking-lot #55 phase 1: per-lab VeritaScan custom-question
// validation (server/veritascanCustomItems.ts validateCustomItem + the status
// allowlist). Mirrors the module logic and exercises every branch so a future
// edit that loosens a guard trips here.
//
// Run: node scripts/verify-veritascan-custom-items.mjs

const SCAN_DOMAINS = [
  "Quality Systems & QC", "Calibration & Verification", "Proficiency Testing",
  "Personnel & Competency", "Test Management & Procedures", "Equipment & Maintenance",
  "Safety & Environment", "Blood Bank & Transfusion", "Point of Care Testing",
  "Leadership & Governance",
];
const CUSTOM_ITEM_STATUSES = ["Compliant", "Needs Attention", "Immediate Action", "N/A", "Not Assessed"];
const QUESTION_MAX = 500;
const CITATION_MAX = 300;

function cleanOptional(v, cap) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, cap);
}
function validateCustomItem(input) {
  const question = typeof input.question === "string" ? input.question.trim() : "";
  if (!question) return { ok: false, error: "question is required" };
  if (question.length > QUESTION_MAX) return { ok: false, error: `question must be ${QUESTION_MAX} characters or fewer` };
  let domain = null;
  if (input.domain !== undefined && input.domain !== null && String(input.domain).trim() !== "") {
    const d = String(input.domain).trim();
    if (!SCAN_DOMAINS.includes(d)) return { ok: false, error: "domain is not a recognized VeritaScan domain" };
    domain = d;
  }
  return {
    ok: true,
    value: {
      question, domain,
      tjc: cleanOptional(input.tjc, CITATION_MAX), cap: cleanOptional(input.cap, CITATION_MAX),
      cfr: cleanOptional(input.cfr, CITATION_MAX), aabb: cleanOptional(input.aabb, CITATION_MAX),
      cola: cleanOptional(input.cola, CITATION_MAX),
    },
  };
}
function isValidCustomStatus(s) {
  return typeof s === "string" && CUSTOM_ITEM_STATUSES.includes(s);
}

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`  FAIL  ${name}`); } };

// question required
ok("missing question rejected", validateCustomItem({}).ok === false);
ok("empty question rejected", validateCustomItem({ question: "   " }).ok === false);
ok("non-string question rejected", validateCustomItem({ question: 42 }).ok === false);
ok("valid question accepted", validateCustomItem({ question: "Does the lab verify freezer temps twice daily?" }).ok === true);

// question length cap
ok("question over 500 rejected", validateCustomItem({ question: "x".repeat(501) }).ok === false);
ok("question exactly 500 accepted", validateCustomItem({ question: "x".repeat(500) }).ok === true);

// domain optional + validated
ok("no domain -> null", (() => { const r = validateCustomItem({ question: "q" }); return r.ok && r.value.domain === null; })());
ok("empty domain -> null", (() => { const r = validateCustomItem({ question: "q", domain: "  " }); return r.ok && r.value.domain === null; })());
ok("known domain preserved", (() => { const r = validateCustomItem({ question: "q", domain: "Safety & Environment" }); return r.ok && r.value.domain === "Safety & Environment"; })());
ok("unknown domain rejected", validateCustomItem({ question: "q", domain: "Made Up Domain" }).ok === false);

// citations trimmed / capped / nulled
ok("blank citation -> null", (() => { const r = validateCustomItem({ question: "q", tjc: "   " }); return r.ok && r.value.tjc === null; })());
ok("citation trimmed", (() => { const r = validateCustomItem({ question: "q", cap: "  CAP.1234  " }); return r.ok && r.value.cap === "CAP.1234"; })());
ok("citation capped at 300", (() => { const r = validateCustomItem({ question: "q", cfr: "y".repeat(400) }); return r.ok && r.value.cfr.length === 300; })());
ok("omitted citations -> null", (() => { const r = validateCustomItem({ question: "q" }); return r.ok && r.value.aabb === null && r.value.cola === null; })());

// status allowlist
ok("Compliant is a valid status", isValidCustomStatus("Compliant") === true);
ok("Not Assessed is a valid status", isValidCustomStatus("Not Assessed") === true);
ok("bogus status rejected", isValidCustomStatus("Totally Fine") === false);
ok("non-string status rejected", isValidCustomStatus(1) === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
