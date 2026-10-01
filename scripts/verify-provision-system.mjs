// scripts/verify-provision-system.mjs
//
// Gate-3 receipt for the Phase-3a provision-system batch primitive
// (server/organizationProvision.ts planProvisionLabs + accreditationFlagsFor).
// Mirrors the pure logic. If you change it there, change this mirror too.
//
// Run: node scripts/verify-provision-system.mjs

function accreditationFlagsFor(body) {
  const b = String(body || "").toUpperCase();
  return {
    accreditation_cap: b === "CAP" ? 1 : 0,
    accreditation_tjc: b === "TJC" ? 1 : 0,
    accreditation_cola: b === "COLA" ? 1 : 0,
    accreditation_aabb: b === "AABB" ? 1 : 0,
  };
}
function planProvisionLabs(labs, ownerUserId, existingByClia) {
  const plan = [];
  const seen = new Set();
  for (const l of labs || []) {
    const cliaNumber = String(l?.cliaNumber || "").trim();
    const labName = String(l?.labName || "").trim();
    const isRepository = !!l?.isRepository;
    if (!cliaNumber || !labName) { plan.push({ cliaNumber, labName, isRepository, action: "error", error: "labName and cliaNumber required" }); continue; }
    if (seen.has(cliaNumber)) { plan.push({ cliaNumber, labName, isRepository, action: "error", error: "duplicate cliaNumber in request" }); continue; }
    seen.add(cliaNumber);
    if (!existingByClia.has(cliaNumber)) plan.push({ cliaNumber, labName, isRepository, action: "create" });
    else if (existingByClia.get(cliaNumber) === ownerUserId) plan.push({ cliaNumber, labName, isRepository, action: "reuse" });
    else plan.push({ cliaNumber, labName, isRepository, action: "error", error: "cliaNumber already belongs to another owner" });
  }
  return plan;
}

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  PASS  ${name} (= ${g})`); } else { fail++; console.log(`  FAIL  ${name}: got ${g}, want ${w}`); }
};

// accreditation mapping
eq("CAP -> cap flag", accreditationFlagsFor("CAP"), { accreditation_cap: 1, accreditation_tjc: 0, accreditation_cola: 0, accreditation_aabb: 0 });
eq("tjc lowercase -> tjc flag", accreditationFlagsFor("tjc"), { accreditation_cap: 0, accreditation_tjc: 1, accreditation_cola: 0, accreditation_aabb: 0 });
eq("empty -> all zero", accreditationFlagsFor(""), { accreditation_cap: 0, accreditation_tjc: 0, accreditation_cola: 0, accreditation_aabb: 0 });
eq("unknown -> all zero", accreditationFlagsFor("JCAHO"), { accreditation_cap: 0, accreditation_tjc: 0, accreditation_cola: 0, accreditation_aabb: 0 });

// plan: a fresh system (owner 66), 3 new labs incl. a repository
const OWNER = 66;
const fresh = planProvisionLabs(
  [
    { labName: "Site A", cliaNumber: "11A1" },
    { labName: "Site B", cliaNumber: "11A2", accreditation: "CAP" },
    { labName: "System Repository", cliaNumber: "11A3", isRepository: true },
  ],
  OWNER,
  new Map(),
);
eq("fresh: 3 creates", fresh.map((p) => p.action), ["create", "create", "create"]);
eq("fresh: repository flag carried", fresh[2].isRepository, true);

// idempotent re-run: those CLIAs now exist under the SAME owner -> reuse
const existing = new Map([["11A1", OWNER], ["11A2", OWNER], ["11A3", OWNER]]);
const rerun = planProvisionLabs(
  [
    { labName: "Site A", cliaNumber: "11A1" },
    { labName: "Site B", cliaNumber: "11A2" },
    { labName: "System Repository", cliaNumber: "11A3", isRepository: true },
    { labName: "Site C (new)", cliaNumber: "11A4" },
  ],
  OWNER,
  existing,
);
eq("rerun: reuse existing, create new", rerun.map((p) => p.action), ["reuse", "reuse", "reuse", "create"]);

// a CLIA owned by a DIFFERENT owner is rejected, never hijacked
const foreign = planProvisionLabs([{ labName: "Someone else", cliaNumber: "99Z9" }], OWNER, new Map([["99Z9", 17]]));
eq("foreign CLIA -> error", foreign[0].action, "error");
eq("foreign CLIA -> error message", foreign[0].error, "cliaNumber already belongs to another owner");

// validation: missing name/CLIA, and an in-request duplicate
const bad = planProvisionLabs(
  [
    { labName: "", cliaNumber: "22B1" },
    { labName: "No CLIA", cliaNumber: "" },
    { labName: "Dup one", cliaNumber: "22B2" },
    { labName: "Dup two", cliaNumber: "22B2" },
  ],
  OWNER,
  new Map(),
);
eq("missing name -> error", bad[0].action, "error");
eq("missing clia -> error", bad[1].action, "error");
eq("first dup -> create", bad[2].action, "create");
eq("second dup -> error", bad[3].action, "error");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
