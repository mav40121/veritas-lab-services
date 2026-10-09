// scripts/verify-cfr-specialty-map.mjs
// Receipt (2026-10-09, Michael Q29 "1"): the specialty -> 42 CFR 493 Subpart I
// section table cited Microbiology, Bacteriology and Virology as §493.945, which
// is "Cytology; gynecologic examinations", and Syphilis Serology as §493.927
// (General immunology). This pins every entry to the eCFR section headings and
// requires the server and client copies of the table to be identical.
//
// SUBPART_I below is the eCFR heading list for 42 CFR 493 Subpart I, fetched
// 2026-10-09 from the eCFR versioner (date 2026-10-01). Update it only from the
// eCFR, never from memory.
// Usage: node scripts/verify-cfr-specialty-map.mjs
import fs from "node:fs";

const SUBPART_I = {
  "§493.911": "Bacteriology",
  "§493.913": "Mycobacteriology",
  "§493.915": "Mycology",
  "§493.917": "Parasitology",
  "§493.919": "Virology",
  "§493.921": "Diagnostic immunology",
  "§493.923": "Syphilis serology",
  "§493.927": "General immunology",
  "§493.931": "Routine chemistry",
  "§493.933": "Endocrinology",
  "§493.937": "Toxicology",
  "§493.941": "Hematology (including routine hematology and coagulation)",
  "§493.945": "Cytology; gynecologic examinations",
  "§493.959": "Immunohematology",
};

// What each specialty name must cite. "" = no Subpart I section (cite none).
const EXPECTED = {
  "General Chemistry": "§493.931", "Routine Chemistry": "§493.931", Chemistry: "§493.931",
  Electrolytes: "§493.931", Cardiac: "§493.931", "Point of Care": "§493.931",
  Urinalysis: "§493.931", "Blood Gas": "§493.931",
  Endocrinology: "§493.933", Toxicology: "§493.937",
  Hematology: "§493.941", Coagulation: "§493.941", Hemostasis: "§493.941",
  "General Immunology": "§493.927", Immunology: "§493.927", "Syphilis Serology": "§493.923",
  Immunohematology: "§493.959", "Blood Bank": "§493.959",
  Microbiology: "§§493.911-493.919", Bacteriology: "§493.911", Mycobacteriology: "§493.913",
  Mycology: "§493.915", Parasitology: "§493.917", Virology: "§493.919",
  Cytology: "§493.945", Histopathology: "",
};

function parseMap(file, startMarker) {
  const src = fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const i = src.indexOf(startMarker);
  if (i < 0) throw new Error(`${file}: marker not found`);
  const body = src.slice(i, src.indexOf("};", i));
  const out = {};
  for (const m of body.matchAll(/(?:"([^"]+)"|([A-Za-z]+))\s*:\s*"([^"]*)"/g)) out[m[1] ?? m[2]] = m[3];
  return out;
}

let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

const server = parseMap("server/veritamapData.ts", "export const CFR_MAP");
const client = parseMap("client/src/pages/VeritaMapMapPage.tsx", "const CFR_MAP");

check("server and client tables have the same specialties", JSON.stringify(Object.keys(server).sort()) === JSON.stringify(Object.keys(client).sort()),
  `server-only: ${Object.keys(server).filter((k) => !(k in client)).join(",") || "-"} / client-only: ${Object.keys(client).filter((k) => !(k in server)).join(",") || "-"}`);
for (const [spec, want] of Object.entries(EXPECTED)) {
  check(`${spec} -> ${want || "(none)"}`, server[spec] === want && client[spec] === want, `server ${JSON.stringify(server[spec])}, client ${JSON.stringify(client[spec])}`);
}
for (const [spec, sec] of Object.entries(server)) {
  if (!sec) continue;
  const parts = sec.startsWith("§§") ? sec.slice(2).split("-").map((s) => "§" + s) : [sec];
  check(`${spec}: every cited section is a real Subpart I heading`, parts.every((p) => p in SUBPART_I), parts.map((p) => `${p} ${SUBPART_I[p] ?? "NOT IN SUBPART I"}`).join("; "));
}
check("nothing but Cytology cites §493.945", Object.entries(server).every(([k, v]) => v !== "§493.945" || k === "Cytology"),
  Object.entries(server).filter(([k, v]) => v === "§493.945" && k !== "Cytology").map(([k]) => k).join(",") || "only Cytology");
check("CLAUDE.md no longer says Microbiology = §493.945", !/Microbiology = §493\.945/.test(fs.readFileSync(new URL("../CLAUDE.md", import.meta.url), "utf8")));

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
