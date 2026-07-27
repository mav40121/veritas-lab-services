// scripts/scope-veritapolicy-orphans.mts
//
// Sizing pass (not a fix) for the orphan standards found by
// audit-veritapolicy-crosswalk.mts: catalog standards that no policy cites.
// Classifies each orphan into a triage bucket so the pass can be scoped:
//   TAG    - strong token match to an existing policy -> likely just needs a citation
//   REVIEW - weak/partial match -> needs a human mapping or a new policy
//   SKIP   - CFR structural entry (condition/registration/basis) -> not policy-mappable
// Read-only. Run: npx tsx scripts/scope-veritapolicy-orphans.mts
import { VERITAPOLICY_MASTER_LIST } from "../server/veritapolicyMasterList";
import { TJC_REQUIREMENTS } from "../server/tjcRequirements";
import { CAP_REQUIREMENTS } from "../server/capRequirements";
import { COLA_REQUIREMENTS } from "../server/colaRequirements";
import { CFR_REQUIREMENTS } from "../server/cfrRequirements";

type Acc = "tjc" | "cap" | "cola" | "cfr";
const ACCS: Acc[] = ["tjc", "cap", "cola", "cfr"];
const CIT: Record<Acc, keyof (typeof VERITAPOLICY_MASTER_LIST)[number]> = {
  tjc: "tjc_citations", cap: "cap_citations", cola: "cola_citations", cfr: "cfr_citations",
};
const REQS: Record<Acc, any[]> = { tjc: TJC_REQUIREMENTS as any[], cap: CAP_REQUIREMENTS as any[], cola: COLA_REQUIREMENTS as any[], cfr: CFR_REQUIREMENTS as any[] };

function normStd(acc: Acc, s: string): string {
  let t = (s || "").trim().toUpperCase().replace(/§/g, "").replace(/\s+/g, " ").trim();
  if (acc === "cola") t = t.replace(/^COLA\s+/, "");
  return t;
}
const STOP = new Set("policy plan written describing describes how the of and a an for to that this with or in on at is are all any laboratory lab requirement requirements documented document procedure procedures defines define including includes related per records record data health its into other under when after each".split(" "));
function toks(s: string): Set<string> {
  return new Set((s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(w => w.length > 2 && !STOP.has(w)));
}
function overlap(a: Set<string>, b: Set<string>): number { let n = 0; for (const x of a) if (b.has(x)) n++; return n; }

// Pre-tokenize every policy (name + description).
const policyTok = VERITAPOLICY_MASTER_LIST.map(p => ({ name: p.policy_name, t: toks(p.policy_name + " " + p.description) }));

// CFR entries that are structural (not lab-SOP-mappable).
const CFR_SKIP = /basis and scope|categories of tests|application|registration|certificate|notification requirement|approval|reinstatement|^condition:|provider-performed|general requirements|additional submission|scope$/i;

for (const acc of ACCS) {
  const field = CIT[acc];
  const referenced = new Set<string>();
  for (const p of VERITAPOLICY_MASTER_LIST) for (const c of (((p as any)[field] as string) || "").split(";")) { const k = normStd(acc, c); if (k) referenced.add(k); }

  const seen = new Set<string>();
  const orphans = REQS[acc].filter(r => { const k = normStd(acc, r.standard); if (!k || referenced.has(k) || seen.has(k)) return false; seen.add(k); return true; });

  const buckets: Record<string, { std: string; name: string; best?: string; score: number }[]> = { TAG: [], REVIEW: [], SKIP: [] };
  for (const r of orphans) {
    if (acc === "cfr" && CFR_SKIP.test(`${r.name} ${r.description}`)) { buckets.SKIP.push({ std: r.standard, name: r.name, score: 0 }); continue; }
    const ot = toks(r.name + " " + r.description);
    let best = "", score = 0;
    for (const p of policyTok) { const s = overlap(ot, p.t); if (s > score) { score = s; best = p.name; } }
    if (score >= 4) buckets.TAG.push({ std: r.standard, name: r.name, best, score });
    else buckets.REVIEW.push({ std: r.standard, name: r.name, best, score });
  }

  console.log(`\n======== ${acc.toUpperCase()} orphans: ${orphans.length} ========`);
  console.log(`  TAG (strong match, likely just add a citation): ${buckets.TAG.length}`);
  for (const b of buckets.TAG) console.log(`     ${b.std}  ~  "${b.best}"  (catalog: ${b.name})`);
  console.log(`  REVIEW (weak match, human call: map or new policy): ${buckets.REVIEW.length}`);
  console.log(`  SKIP (CFR structural, not policy-mappable): ${buckets.SKIP.length}`);
  for (const b of buckets.SKIP) console.log(`     SKIP  ${b.std}  (${b.name})`);
}
