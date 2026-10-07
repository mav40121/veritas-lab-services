// scripts/ci-sandbox/seed_sandbox.mjs
//
// Seeds the VLS CI sandbox lab (parking lot #74, 2026-10-07, Michael option 1)
// through the public API as the lab owner, so the blocking "Sandbox receipts"
// step in .github/workflows/playwright-smoke.yml has the fixtures its specs
// expect. Idempotent: a re-run finds every fixture by name and reuses it, so
// running it twice never duplicates a map, employee, program or package.
//
// The sandbox is OUR lab with test data only. This script must never be pointed
// at a client lab: the names below are deliberately synthetic and the data
// provenance rule (CLAUDE.md section 8) applies to every other account.
//
// Usage (prints the PW_* values as JSON on stdout, diagnostics on stderr):
//   BASE=https://www.veritaslabservices.com TOKEN=<sandbox owner JWT> LAB_ID=<id> \
//     node scripts/ci-sandbox/seed_sandbox.mjs > sandbox_env.json
//
// Fixtures (what each receipt needs):
//   map "CI Sandbox Chemistry" with one library-matched instrument
//     ("Abbott ARCHITECT c4000") carrying six MODERATE chemistry analytes
//     -> veritamap-card-edit-button, veritamap-amr-autosave-no-loop (PW_MAP_URL)
//   VeritaStaff employee "Casey Sandbox" assigned to that instrument, and a
//     technical competency program whose method group names the instrument
//     -> veritacomp-assessment-roster-employees (PW_PROGRAM_ID, PW_EXPECT_EMPLOYEE)
//   one VeritaCheck instrument-verification package on the same instrument
//     -> veritacheck-analyte-multiselect (PW_VERIFICATION_PATH)
//   owner onboarding marked complete so app pages render without the wizard
//     -> module-howto-card-layout, veritapolicy-custom-entry, getting-started-card

const BASE = (process.env.BASE || "https://www.veritaslabservices.com").replace(/\/$/, "");
const TOKEN = process.env.TOKEN || "";
const LAB_ID = Number(process.env.LAB_ID);
if (!TOKEN || !Number.isInteger(LAB_ID) || LAB_ID <= 0) {
  console.error("TOKEN and LAB_ID are required");
  process.exit(1);
}

const MAP_NAME = "CI Sandbox Chemistry";
const INSTRUMENT = "Abbott ARCHITECT c4000"; // must match an fdaInstrumentData.json entry
const MANUFACTURER = "Abbott";
const ANALYTES = ["Glucose", "Sodium", "Potassium", "Chloride", "Creatinine", "Calcium"];
const EMPLOYEE = { firstName: "Casey", lastName: "Sandbox", title: "Medical Laboratory Scientist", hireDate: "2026-01-05" };
const PROGRAM_NAME = "CI Sandbox Chemistry Competency";

const headers = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
async function api(method, path, body) {
  const r = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { _raw: text.slice(0, 200) }; }
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${text.slice(0, 300)}`);
  return json;
}
const asList = (x, ...keys) => {
  if (Array.isArray(x)) return x;
  for (const k of keys) if (Array.isArray(x?.[k])) return x[k];
  return [];
};
const log = (...a) => console.error("[seed]", ...a);

// 0. The token must belong to a member of this lab.
const me = await api("GET", "/api/auth/me");
const user = me.user || me;
log("user", user.id, user.email, "lab", LAB_ID);

// 1. Map.
const maps = asList(await api("GET", `/api/labs/${LAB_ID}/veritamap/maps`), "maps", "items");
let map = maps.find((m) => m.name === MAP_NAME);
if (!map) { map = await api("POST", `/api/labs/${LAB_ID}/veritamap/maps`, { name: MAP_NAME }); log("map created", map.id); }
else log("map reused", map.id);
const mapId = map.id;

// 2. Instrument on the map (library-matched name), with its analytes.
let instruments = asList(await api("GET", `/api/labs/${LAB_ID}/veritamap/maps/${mapId}/instruments`), "instruments", "items");
let inst = instruments.find((i) => i.instrument_name === INSTRUMENT);
if (!inst) {
  inst = await api("POST", `/api/labs/${LAB_ID}/veritamap/maps/${mapId}/instruments`, { instrument_name: INSTRUMENT, role: "Primary", category: "Chemistry" });
  log("instrument created", inst.id);
} else log("instrument reused", inst.id);
const detail = await api("GET", `/api/labs/${LAB_ID}/veritamap/maps/${mapId}`);
const haveTests = asList(detail, "tests").filter((t) => (t.instruments || []).some((x) => (x.id ?? x.instrument_id) === inst.id || x.instrument_name === INSTRUMENT));
if (haveTests.length < ANALYTES.length) {
  const tests = ANALYTES.map((analyte) => ({ analyte, specialty: "General Chemistry", complexity: "MODERATE", active: 1 }));
  await api("PUT", `/api/labs/${LAB_ID}/veritamap/maps/${mapId}/instruments/${inst.id}/tests`, { tests });
  log("tests written", ANALYTES.length);
} else log("tests present", haveTests.length);

// 3. VeritaStaff lab setup (staff_labs row; the employee routes answer
//    "Set up your lab first" without it). The route upserts, so it is safe to
//    repeat. Synthetic identity: this is the sandbox, not a client lab.
await api("POST", `/api/labs/${LAB_ID}/staff/lab`, {
  labName: "VLS CI Sandbox", cliaNumber: "00D0000074", street: "1 Sandbox Way", city: "Upton", state: "MA", zip: "01568",
  phone: "", certificateType: "compliance", accreditationBody: "CLIA_ONLY", includesNys: false, complexity: "MODERATE",
});
log("staff lab set up");

// 4. VeritaStaff employee assigned to the instrument.
const employees = asList(await api("GET", `/api/labs/${LAB_ID}/staff/employees`), "employees", "items");
let emp = employees.find((e) => e.first_name === EMPLOYEE.firstName && e.last_name === EMPLOYEE.lastName);
if (!emp) { emp = await api("POST", `/api/labs/${LAB_ID}/staff/employees`, EMPLOYEE); log("employee created", emp.id); }
else log("employee reused", emp.id);
await api("PUT", `/api/labs/${LAB_ID}/staff/employees/${emp.id}/instruments`, { instrumentIds: [inst.id] });
log("employee assigned to instrument", inst.id);

// 4. Technical competency program naming the instrument in its method group.
const programs = asList(await api("GET", `/api/labs/${LAB_ID}/competency/programs`), "programs", "items");
let program = programs.find((p) => p.name === PROGRAM_NAME);
if (!program) {
  program = await api("POST", `/api/labs/${LAB_ID}/competency/programs`, {
    name: PROGRAM_NAME, department: "Chemistry", type: "technical", mapId,
    methodGroups: [{ name: INSTRUMENT, instruments: [INSTRUMENT], analytes: ANALYTES, notes: "CI sandbox fixture" }],
  });
  log("program created", program.id);
} else log("program reused", program.id);

// 5. VeritaCheck instrument-verification package on the same instrument.
const packages = asList(await api("GET", `/api/labs/${LAB_ID}/veritacheck/verifications`), "verifications", "items");
let pkg = packages.find((p) => p.instrument_name === INSTRUMENT);
if (!pkg) {
  pkg = await api("POST", `/api/labs/${LAB_ID}/veritacheck/verifications`, { instrument_name: INSTRUMENT, manufacturer: MANUFACTURER, trigger_type: "new_instrument", map_instrument_id: inst.id });
  log("verification package created", pkg.id);
} else log("verification package reused", pkg.id);

// 6. Owner onboarding complete (app pages render without the first-run wizard).
await api("POST", "/api/auth/complete-onboarding", {});
log("onboarding complete");

process.stdout.write(JSON.stringify({
  PW_LAB_ID: String(LAB_ID),
  PW_MAP_ID: String(mapId),
  PW_MAP_URL: `/labs/${LAB_ID}/veritamap-app/${mapId}`,
  PW_VERIFICATION_PATH: `/labs/${LAB_ID}/dashboard/verifications`,
  PW_PROGRAM_ID: String(program.id),
  PW_EXPECT_EMPLOYEE: `${EMPLOYEE.firstName} ${EMPLOYEE.lastName}`,
}, null, 2) + "\n");
