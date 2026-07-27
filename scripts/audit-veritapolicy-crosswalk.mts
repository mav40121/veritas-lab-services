// scripts/audit-veritapolicy-crosswalk.mts
//
// Crosswalk-completeness audit for VeritaPolicy, generalizing the IM.02.02.05
// finding: a standard the product DEFINES in its requirements catalog but that
// NO policy's citation string references (orphan), or a requirement whose name
// matches a policy that is not tagged with its standard (name-match gap, the
// exact IM.02.02.05 shape), or a citation that references a standard the catalog
// does not define (dangling).
//
// Read-only. Run: npx tsx scripts/audit-veritapolicy-crosswalk.mts
import { VERITAPOLICY_MASTER_LIST } from "../server/veritapolicyMasterList";
import { TJC_REQUIREMENTS } from "../server/tjcRequirements";
import { CAP_REQUIREMENTS } from "../server/capRequirements";
import { COLA_REQUIREMENTS } from "../server/colaRequirements";
import { CFR_REQUIREMENTS } from "../server/cfrRequirements";

type Acc = "tjc" | "cap" | "cola" | "cfr";
const ACCS: Acc[] = ["tjc", "cap", "cola", "cfr"];
const CIT_FIELD: Record<Acc, keyof (typeof VERITAPOLICY_MASTER_LIST)[number]> = {
  tjc: "tjc_citations", cap: "cap_citations", cola: "cola_citations", cfr: "cfr_citations",
};
const REQS: Record<Acc, any[]> = {
  tjc: TJC_REQUIREMENTS as any[], cap: CAP_REQUIREMENTS as any[],
  cola: COLA_REQUIREMENTS as any[], cfr: CFR_REQUIREMENTS as any[],
};

// Per-accreditor normalization so the two sides compare on equal footing.
// COLA catalog says "COLA APM 13"; citations say "APM 13". CFR catalog uses
// the section sign; citations do not.
function normStd(acc: Acc, s: string): string {
  let t = (s || "").trim().toUpperCase().replace(/§/g, "").replace(/\s+/g, " ").trim();
  if (acc === "cola") t = t.replace(/^COLA\s+/, "");
  return t;
}
function splitCitations(acc: Acc, raw: string): string[] {
  if (!raw) return [];
  return raw.split(";").map(x => normStd(acc, x)).filter(Boolean);
}
function normName(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

// Policy-name index for the name-match test.
const policyByName = new Map<string, any>();
for (const p of VERITAPOLICY_MASTER_LIST) {
  const k = normName(p.policy_name);
  if (k && !policyByName.has(k)) policyByName.set(k, p);
}

// Phase 0 of the orphan triage (2026-07-27): CFR sections that are genuinely
// not lab-SOP-mappable, so they are intentionally uncited and must NOT count as
// orphans. Explicit list (not a regex) so every suppression is a named,
// reviewable decision. Categories: chapter "Condition:" headers; CMS
// registration/certificate/notification mechanics; inspection/enforcement/
// Medicare-payment/sanction sections. Keys are normStd("cfr", ...) form.
const CFR_INTENTIONALLY_UNMAPPED = new Set<string>([
  "42 CFR 493.1", "42 CFR 493.5", "42 CFR 493.19", "42 CFR 493.20", "42 CFR 493.25",
  "42 CFR 493.43", "42 CFR 493.51", "42 CFR 493.53", "42 CFR 493.55", "42 CFR 493.61",
  "42 CFR 493.63", "42 CFR 493.553", "42 CFR 493.551", "42 CFR 493.557", "42 CFR 493.807",
  "42 CFR 493.833", "42 CFR 493.839", "42 CFR 493.901", "42 CFR 493.1203", "42 CFR 493.1205",
  "42 CFR 493.1207", "42 CFR 493.1208", "42 CFR 493.1210", "42 CFR 493.1211", "42 CFR 493.1212",
  "42 CFR 493.1213", "42 CFR 493.1220", "42 CFR 493.1221", "42 CFR 493.1225", "42 CFR 493.1226",
  "42 CFR 493.1227", "42 CFR 493.1240", "42 CFR 493.1361", "42 CFR 493.1409", "42 CFR 493.1415",
  "42 CFR 493.1481", "42 CFR 493.1771", "42 CFR 493.1777", "42 CFR 493.1780", "42 CFR 493.1800",
  "42 CFR 493.1807", "42 CFR 493.1808", "42 CFR 493.1809", "42 CFR 493.1826", "42 CFR 493.1828",
  "42 CFR 493.1832", "42 CFR 493.1836", "42 CFR 493.1842",
]);

let grandGaps = 0, grandOrphans = 0;

for (const acc of ACCS) {
  const field = CIT_FIELD[acc];
  // Everything the policies reference for this accreditor.
  const referenced = new Set<string>();
  const referencedBy = new Map<string, string[]>(); // std -> policy names
  for (const p of VERITAPOLICY_MASTER_LIST) {
    for (const c of splitCitations(acc, (p as any)[field] as string)) {
      referenced.add(c);
      if (!referencedBy.has(c)) referencedBy.set(c, []);
      referencedBy.get(c)!.push(p.policy_name);
    }
  }
  // Everything the catalog defines.
  const defined = new Map<string, string>(); // normStd -> name
  const rawByNorm = new Map<string, string>(); // normStd -> original standard text
  for (const r of REQS[acc]) {
    const key = normStd(acc, r.standard);
    if (key && !defined.has(key)) { defined.set(key, r.name); rawByNorm.set(key, r.standard); }
  }

  // 1) Orphans: defined by the catalog, cited by NO policy. Structural CFR
  //    sections on the intentionally-unmapped list are suppressed (Phase 0).
  const allOrphans = [...defined.keys()].filter(k => !referenced.has(k));
  const suppressed = allOrphans.filter(k => CFR_INTENTIONALLY_UNMAPPED.has(k));
  const orphans = allOrphans.filter(k => !CFR_INTENTIONALLY_UNMAPPED.has(k));
  // 2) Danglers: cited by a policy, not in the catalog.
  const danglers = [...referenced].filter(k => !defined.has(k));
  // 3) Name-match gaps: a requirement whose name matches a policy, but that
  //    policy does not carry the standard. Highest confidence (the IM.02.02.05 shape).
  const nameGaps: { std: string; name: string; policy: string }[] = [];
  for (const r of REQS[acc]) {
    const p = policyByName.get(normName(r.name));
    if (!p) continue;
    const cites = new Set(splitCitations(acc, (p as any)[field] as string));
    const key = normStd(acc, r.standard);
    if (!cites.has(key)) nameGaps.push({ std: r.standard, name: r.name, policy: p.policy_name });
  }

  grandGaps += nameGaps.length;
  grandOrphans += orphans.length;

  console.log(`\n======== ${acc.toUpperCase()} ========`);
  console.log(`catalog standards: ${defined.size} | distinct cited by policies: ${referenced.size} | orphans (defined, uncited): ${orphans.length}${suppressed.length ? ` (+${suppressed.length} intentionally unmapped, suppressed)` : ""} | danglers (cited, undefined): ${danglers.length}`);

  console.log(`\n  [A] NAME-MATCH GAPS (policy exists by name, standard NOT tagged) — ${nameGaps.length}`);
  for (const g of nameGaps) console.log(`      ${g.std}  ->  policy "${g.policy}"  (catalog: "${g.name}")`);

  console.log(`\n  [B] ORPHAN STANDARDS (in catalog, cited by no policy) — ${orphans.length}`);
  const showO = orphans.slice(0, 40);
  for (const k of showO) console.log(`      ${rawByNorm.get(k)}  (${defined.get(k)})`);
  if (orphans.length > showO.length) console.log(`      ... and ${orphans.length - showO.length} more`);

  console.log(`\n  [C] DANGLING CITATIONS (cited by a policy, not in catalog) — ${danglers.length}`);
  const showD = danglers.slice(0, 25);
  for (const k of showD) console.log(`      ${k}  (cited by: ${(referencedBy.get(k) || []).slice(0, 2).join("; ")}${(referencedBy.get(k) || []).length > 2 ? " ..." : ""})`);
  if (danglers.length > showD.length) console.log(`      ... and ${danglers.length - showD.length} more`);
}

console.log(`\n\n==== SUMMARY ====`);
console.log(`Policies: ${VERITAPOLICY_MASTER_LIST.length}`);
console.log(`Total name-match gaps across accreditors (highest-confidence, IM.02.02.05 class): ${grandGaps}`);
console.log(`Total orphan standards across accreditors: ${grandOrphans}`);
console.log(`Note: AABB has no requirements catalog in-repo, so aabb_citations were not audited.`);
