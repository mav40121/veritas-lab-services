// Gate 3 math receipt for CMS-209 Part B role-shaping. Drives the ACTUAL
// exported helpers (server/cms209Roles.ts) that the 209 routes call, across
// every branch: entire-lab expansion, empty-list preservation, dedup, and the
// needs-review gap detector. Run: npx tsx scripts/verify-cms209-partb.mts
import { entireLabFlag, sanitizeSpecialties, expandEntireLabRoles, cms209Gaps } from "../server/cms209Roles";

let fails = 0;
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? "PASS" : "FAIL"}: ${name}${cond ? "" : "  <<< " + (detail ?? "")}`);
  if (!cond) fails++;
}
const specs = (rows: any[]) => rows.filter((r) => r.role === "TS").map((r) => r.specialty_number);

// 1. entireLabFlag: only TC/TS honor the flag.
check("entireLabFlag TS+allSpecialties=true -> 1", entireLabFlag({ role: "TS", allSpecialties: true }) === 1);
check("entireLabFlag TC+allSpecialties=1 -> 1", entireLabFlag({ role: "TC", allSpecialties: 1 }) === 1);
check("entireLabFlag TP+allSpecialties=true -> 0 (not TC/TS)", entireLabFlag({ role: "TP", allSpecialties: true }) === 0);
check("entireLabFlag TS without flag -> 0", entireLabFlag({ role: "TS" }) === 0);

// 2. sanitizeSpecialties: bound, dedupe, sort; drop junk.
check("sanitize dedupe+sort", JSON.stringify(sanitizeSpecialties([8, 1, 7, 8, 1])) === JSON.stringify([1, 7, 8]));
check("sanitize drops out-of-range + non-int", JSON.stringify(sanitizeSpecialties([0, 18, 3.5, "x", 7])) === JSON.stringify([7]));
check("sanitize non-array -> []", JSON.stringify(sanitizeSpecialties(null)) === "[]");

// 3a. Entire-lab TS expands to one row per lab specialty (1..9).
{
  const emps = [{ id: 1, last_name: "Veri", first_name: "Michael", roles: [{ role: "TS", all_specialties: 1, specialty_number: null }, { role: "GS" }] }];
  const out = expandEntireLabRoles(emps, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  check("expand: entire-lab TS -> 9 TS rows 1..9", JSON.stringify(specs(out[0].roles)) === JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9]));
  check("expand: GS row preserved", out[0].roles.some((r: any) => r.role === "GS"));
}

// 3b. Entire-lab TS with EMPTY lab list -> preserved as one null row (not dropped).
{
  const emps = [{ id: 2, last_name: "Hall", first_name: "John", roles: [{ role: "TS", all_specialties: 1, specialty_number: null }] }];
  const out = expandEntireLabRoles(emps, []);
  check("expand: entire-lab + empty list -> single TS null row", out[0].roles.length === 1 && out[0].roles[0].role === "TS" && out[0].roles[0].specialty_number == null);
}

// 3c. Dedup: entire-lab expansion + a stray explicit same-specialty row -> no double.
{
  const emps = [{ id: 3, last_name: "X", first_name: "Y", roles: [{ role: "TS", all_specialties: 1 }, { role: "TS", specialty_number: 7 }] }];
  const out = expandEntireLabRoles(emps, [7, 8]);
  check("expand: dedup keeps a single TS:7", specs(out[0].roles).filter((s: number) => s === 7).length === 1);
  check("expand: TS:7 and TS:8 both present", JSON.stringify(specs(out[0].roles).sort()) === JSON.stringify([7, 8]));
}

// 3d. Specific-specialty TS is untouched; non-TC/TS pass through.
{
  const emps = [{ id: 4, last_name: "Z", first_name: "W", roles: [{ role: "TS", specialty_number: 8 }, { role: "TP" }] }];
  const out = expandEntireLabRoles(emps, [1, 2, 3]);
  check("expand: explicit TS:8 stays exactly one row", JSON.stringify(specs(out[0].roles)) === JSON.stringify([8]));
  check("expand: TP untouched", out[0].roles.some((r: any) => r.role === "TP"));
}

// 4. Gap detector (needs-review).
{
  const emps = [
    { id: 10, last_name: "Null", first_name: "T", roles: [{ role: "TS", specialty_number: null }] },             // gap: no number
    { id: 11, last_name: "AllEmpty", first_name: "T", roles: [{ role: "TS", all_specialties: 1 }] },              // gap ONLY when lab list empty
    { id: 12, last_name: "Good", first_name: "T", roles: [{ role: "TS", specialty_number: 7 }] },                 // no gap
    { id: 13, last_name: "Tp", first_name: "T", roles: [{ role: "TP", specialty_number: null }] },                // no gap (not TC/TS)
  ];
  const gapsNoList = cms209Gaps(emps, []);
  check("gaps: empty lab list flags the null-TS AND the entire-lab TS (2)", gapsNoList.length === 2 && gapsNoList.every((g) => g.employeeId === 10 || g.employeeId === 11));
  const gapsWithList = cms209Gaps(emps, [1, 7, 8]);
  check("gaps: with a lab list, only the null-TS remains a gap (1)", gapsWithList.length === 1 && gapsWithList[0].employeeId === 10);
}

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
