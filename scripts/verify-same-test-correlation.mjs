// scripts/verify-same-test-correlation.mjs
//
// Receipt for BUG-011 (2026-10-09): the same test under different names on two
// instruments must trigger the correlation requirement (42 CFR 493.1281), and
// different tests must never be paired. Every SAME pair below is a shape found on a
// production map in the 2026-10-09 audit (names only, no lab data); every DIFFERENT
// pair is a near-miss the rule must keep apart.
//
// Run: node --import tsx scripts/verify-same-test-correlation.mjs

import { sameTestKeys, correlationGroupsFor } from "../shared/presetAnalytes.ts";

let fails = 0;
const ok = (label, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}${detail ? "  :: " + detail : ""}`); if (!cond) fails++; };
const share = (a, b) => { const kb = new Set(sameTestKeys(b)); return sameTestKeys(a).some((k) => kb.has(k)); };
const same = (a, b) => ok(`same test: "${a}" ~ "${b}"`, share(a, b), `${sameTestKeys(a)} | ${sameTestKeys(b)}`);
const diff = (a, b) => ok(`different: "${a}" vs "${b}"`, !share(a, b), `${sameTestKeys(a)} | ${sameTestKeys(b)}`);

console.log("=== capital letters and spacing only ===");
same("Antibody screen", "Antibody Screen");
same("Antibody identification", "Antibody Identification");
same("Platelet Estimate", "Platelet estimate");

console.log("\n=== differential: classes and a differential entered as one test ===");
same("Lymphocytes", "LYMPH%"); same("Lymphocytes", "LY%");
for (const cls of ["LYMPH%", "NEUT%", "Mono%", "EO%", "BASO%", "Lymph%", "Neutrophil%"]) same("Manual Diff", cls);
same("White blood cell differential (WBC diff)", "LYMPH%");
same("Differential", "NE%");
diff("Manual Diff", "LYMPH#");
diff("LYMPH%", "NEUT%");
diff("LYMPH%", "LYMPH#");
diff("Bands", "Neutrophils");
diff("Monospot", "Mono%");

console.log("\n=== NRBC and reticulocytes ===");
same("NRBC (manual)", "NRBC%"); same("Nucleated red blood cells (NRBC)", "NRBC%"); same("NRBC (manual)", "NRBC");
diff("NRBC (manual)", "NRBC#");
same("Reticulocyte Count (manual)", "RET%"); same("Retic", "RET%"); same("Reticulocyte count (digital morphology)", "RET%");
diff("RET%", "RET#"); diff("Retic", "RET-He"); diff("Retic", "IRF");

console.log("\n=== body fluid ===");
same("Body Fluid WBC", "WBC-BF"); same("Body Fluid RBC", "RBC-BF");
same("Body Fluid Differential", "PMN%"); same("Body Fluid Differential", "MN%");
diff("TC-BF", "WBC-BF"); diff("Body Fluid WBC", "WBC"); diff("WBC-BF", "WBC");

console.log("\n=== urine sediment: manual vs automated, never the CBC ===");
same("Casts (urine)", "Casts (urine microscopy)"); same("casts", "Casts (urine microscopy)");
same("crystals", "Crystals (urine)"); same("epithelial cells", "Epithelial cells (urine microscopy)");
same("Epithelial cells (urine)", "Epithelial cells (urine microscopy)");
same("RBC (urine micro)", "RBC (urine microscopy)"); same("WBC (urine micro)", "WBC (urine microscopy)");
same("Bacteria (urine)", "Bacteria (urine microscopy)");
diff("RBC", "RBC (urine micro)"); diff("WBC", "WBC (urine microscopy)");
diff("Yeast (urine)", "Yeast (wet prep)"); diff("Trichomonas (wet prep)", "Yeast (wet prep)");
diff("Urine qualitative dipstick blood", "RBC (urine microscopy)");
diff("Leukocyte esterase, urinary", "WBC (urine microscopy)");
diff("Erythrocyte Sedimentation Rate (ESR)", "RBC (urine microscopy)");

console.log("\n=== blood bank: by test and phase; method words do not split a test ===");
same("Antibody Screen (tube)", "Antibody Screen");
same("Crossmatch (AHG)", "Crossmatch compatibility testing (AHG)"); same("Crossmatch AHG (tube)", "Crossmatch (AHG)");
same("Crossmatch IS (tube)", "Crossmatch (IS)");
same("ABO (tube)", "ABO Group"); same("Rh (tube)", "Rh Type"); same("Rh (tube)", "D (Rho) typing");
same("DAT (tube)", "Direct Antiglobulin Test (DAT)");
diff("Crossmatch (IS)", "Crossmatch (AHG)"); diff("ABO (tube)", "Rh (tube)");
diff("Antibody Screen", "Antibody Identification"); diff("Antibody Screen (tube)", "Antibody Titer (tube)");

console.log("\n=== drug screens: one class, two spellings ===");
same("Amphetamine", "Amphetamines"); same("Cannabinoids (THC)", "Cannabinoids"); same("Cocaine", "Cocaine metabolites");
same("Methamphetamines (mAMP)", "Methamphetamine"); same("Phencyclidine (PCP)", "Phencyclidine");
same("Methadone metabolite (EDDP)", "EDDP (methadone metabolite)");
diff("Opiates", "Morphine"); diff("Amphetamines", "Methamphetamines"); diff("Methadone", "EDDP (methadone metabolite)");

console.log("\n=== chemistry, coagulation and FDA name variants ===");
same("Bilirubin, total", "Total bilirubin"); same("Triglyceride", "Triglycerides");
same("PT/INR", "Prothrombin time (PT)"); same("PT/INR", "INR"); same("PT", "Prothrombin time");
same("aPTT", "PTT"); same("aPTT", "Activated partial thromboplastin time (APTT)");
same("Parathyroid hormone (PTH)", "Parathyroid hormone - intact");
same("Cystatin C", "Cystacin C"); same("Microalbumin", "Albumin, urinary");
same("Glycosylated Hemoglobin (Hgb A1c)", "Hemoglobin A1c");
diff("Glucose", "Glucose, urine"); diff("HCG", "hCG (urine, qualitative)");
diff("Parathyroid hormone (PTH)", "Parathyroid hormone - mid-molecule (PTH-M)");
diff("Prostatic specific antigen (PSA)", "Prostatic specific antigen (PSA), free");
diff("Hemoglobin", "Hemoglobin A1c"); diff("PT", "INR");

console.log("\n=== part B, not grouped until Michael decides ===");
diff("Sodium", "cNa+"); diff("Protein, total, urine", "Protein, urine");

console.log("\n=== correlationGroupsFor on a real map shape (XN-2000 primary + backup, Manual Differential) ===");
const map = {
  "Lymph%": [{ id: 116 }, { id: 117 }], "Neut%": [{ id: 116 }, { id: 117 }], "LYMPH#": [{ id: 116 }],
  "Manual Diff": [{ id: 119 }], "RBC": [{ id: 116 }], "RBC (urine micro)": [{ id: 200 }],
};
const g = correlationGroupsFor(map);
ok("Manual Diff counts the analyzer: 3 instruments", g["Manual Diff"].instrumentCount === 3, JSON.stringify(g["Manual Diff"]));
ok("Lymph% now includes the manual diff: 3 instruments, peer Manual Diff", g["Lymph%"].instrumentCount === 3 && g["Lymph%"].peers.join() === "Manual Diff", JSON.stringify(g["Lymph%"]));
ok("Lymph% is not paired with Neut%", !g["Lymph%"].peers.includes("Neut%"));
ok("LYMPH# stays on one instrument (absolute never pairs with a manual %)", g["LYMPH#"].instrumentCount === 1, JSON.stringify(g["LYMPH#"]));
ok("CBC RBC and urine RBC stay apart", g["RBC"].instrumentCount === 1 && g["RBC (urine micro)"].instrumentCount === 1);

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
