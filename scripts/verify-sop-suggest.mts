// scripts/verify-sop-suggest.mts
//
// Receipt for the suggested SOPs on a VeritaResponse finding (B8, 2026-11-24; shared/sopSuggest.ts): which
// standards and topic words are read from a text, each of the three ways a document is suggested with its reason, and what is
// never suggested. Made-up documents. Run: npx tsx scripts/verify-sop-suggest.mts
import { citationTokens, suggestDocuments, topicWords, type SuggestDoc, type SuggestRequirement } from "../shared/sopSuggest";

let failures = 0;
const check = (name: string, cond: boolean, detail: unknown = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond ? `  :: ${JSON.stringify(detail)}` : ""}`); if (!cond) failures++; };
const same = (a: string[], b: string[]) => a.slice().sort().join("|") === b.slice().sort().join("|");

// Standards read from a text
for (const [text, want] of [
  ["42 CFR 493.1253(b)(1)(i)", ["493.1253"]], ["42 CFR §493.1255 and §493.1253", ["493.1255", "493.1253"]], ["21 CFR 606.171", ["606.171"]], ["21 CFR 1271.270(d)", ["1271.270"]],
  ["GEN.20377", ["GEN.20377"]], ["com.01300; CHM.13450", ["COM.01300", "CHM.13450"]], ["QSA.02.06.01 EP 3", ["QSA.02.06.01"]], ["EC.02.01.01", ["EC.02.01.01"]],
  ["QC 26; LDR 3", ["QC 26", "LDR 3"]], ["5.1.10", ["5.1.10"]], ["42 CFR 493", []], ["EP 5, PAGE 12, RFI 3", []], ["", []], [null, []], ["no standard cited", []],
] as const) check(`citations in ${JSON.stringify(text)}`, same(citationTokens(text), [...want]), citationTokens(text));
check("a TJC standard isn't also read as an AABB one", !citationTokens("QSA.02.06.01").includes("02.06.01"));

// Topic words
check("topic words: plural off, short and everyday words out", same([...topicWords("The refrigerators' temperature logs were not reviewed by staff")], ["refrigerator", "temperature", "logs"]), [...topicWords("The refrigerators' temperature logs were not reviewed by staff")]);
check("topic words: assays -> assay, assemblies -> assembly, glass stays", same([...topicWords("assays assemblies glass")], ["assay", "assembly", "glass"]), [...topicWords("assays assemblies glass")]);
check("topic words: words every laboratory document uses are left out", topicWords("Laboratory policy and procedure for patient test results, staff and records").size === 0, [...topicWords("Laboratory policy and procedure for patient test results, staff and records")]);

const docs: SuggestDoc[] = [
  { id: 1, title: "Refrigerator and Freezer Temperature Monitoring", doc_number: "LAB-101", description: "Daily readings and out of range action" },
  { id: 2, title: "Performance Verification of New Analyzers", doc_number: "LAB-202", description: "Meets 42 CFR 493.1253" },
  { id: 3, title: "Critical Value Notification", doc_number: "LAB-303", description: null },
  { id: 4, title: "Our Analyzer Checkout", doc_number: "LAB-404", description: null },
  { id: 5, title: "Hazardous Waste", doc_number: "SAFE-12", description: "Disposal of chemicals" },
  { id: 6, title: "Calibration Verification", doc_number: "LAB-505", description: null },
];
const reqs: SuggestRequirement[] = [
  { policy_name: "Verification of Performance Specifications Policy", citations: "42 CFR 493.1253; COM.40000", our_policy_name: "Our Analyzer Checkout" },
  { policy_name: "Calibration Verification Policy", citations: "42 CFR 493.1255", our_policy_name: null },
  { policy_name: "Unrelated Policy", citations: "42 CFR 493.1100", our_policy_name: "Hazardous Waste" },
];
const ids = (f: any) => suggestDocuments(f, docs, reqs).map((s) => s.id);
const of = (f: any, id: number) => suggestDocuments(f, docs, reqs).find((s) => s.id === id);

// 1. The standard, written on the document
const s1 = of({ standard_ref: "42 CFR 493.1253(b)(1)" }, 2);
check("a document naming the standard is first, and says so", ids({ standard_ref: "42 CFR 493.1253(b)(1)" })[0] === 2 && s1!.reasons.includes("Names 493.1253"), s1);
// 2. A policy requirement that cites the standard
const s2 = of({ standard_ref: "493.1253" }, 4);
check("the document the lab's policy list gives for a requirement citing it", !!s2 && s2.reasons[0] === 'Your policy list gives it for "Verification of Performance Specifications Policy", which cites 493.1253', s2);
const s3 = of({ standard_ref: "COM.40000" }, 4);
check("the same through the accreditor's citation", !!s3 && /which cites COM\.40000/.test(s3.reasons[0]), s3);
const s4 = of({ standard_ref: "42 CFR 493.1255(b)" }, 6);
check("a document titled as the requirement, when the list names none", !!s4 && s4.reasons[0] === 'Matches the policy requirement "Calibration Verification Policy", which cites 493.1255', s4);
check("a requirement citing another standard suggests nothing", !ids({ standard_ref: "42 CFR 493.1253" }).includes(5));
// 3. Topic words
const s5 = of({ description: "Made-up: the refrigerator temperature was not recorded on two days" }, 1);
check("shared title words, named", !!s5 && s5.reasons.join() === "Title shares: refrigerator, temperature", s5);
const s6 = of({ description: "Made-up: chemicals were left at a sink, disposal not documented" }, 5);
check("shared description words, named", !!s6 && /^Description shares: (chemical, disposal|disposal, chemical)$/.test(s6.reasons[0]), s6);
check("one shared description word alone isn't enough", !ids({ description: "disposal" }).includes(5));
check("the failed study's name counts as topic words", ids({ study: "Glucose, Calibration Verification / Linearity" }).includes(6));
check("nothing in common suggests nothing", ids({ standard_ref: "GEN.99999", description: "Made-up: parking" }).length === 0, ids({ standard_ref: "GEN.99999", description: "Made-up: parking" }));
check("an empty finding suggests nothing", ids({}).length === 0);
check("the list is cut at the limit, best first", (() => { const many = Array.from({ length: 30 }, (_, i) => ({ id: 100 + i, title: "Temperature", doc_number: null, description: i === 29 ? "Meets 493.1252" : null })); const r = suggestDocuments({ standard_ref: "493.1252", description: "temperature" }, many, []); return r.length === 8 && r[0].id === 129 && r[1].id === 100; })());

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
