#!/usr/bin/env node
// verify-multilab-bleed.js
//
// Probes every legacy unscoped read endpoint that the 2026-06-05 root-cause
// PR converted to use `WHERE m.lab_id = ?` (resolved via resolveLegacyLabId)
// and asserts the response shape matches the lab-scoped equivalent. The
// concrete bug this script exists to prevent: San Carlos (lab 2) has two
// VeritaMaps owned by different user_ids. The legacy endpoints used to return
// only the maps where m.user_id matched the requester, silently hiding 20 of
// 24 instruments and 1 of 2 maps for a multi-lab user.
//
// USAGE:
//   BASE=https://www.veritaslabservices.com \
//   TOKEN=<JWT for a user whose default_lab_id points at the target lab> \
//   LAB_ID=2 \
//   node scripts/verify-multilab-bleed.js
//
// Exits non-zero on any mismatch.

const BASE = process.env.BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.TOKEN;
const LAB_ID = Number(process.env.LAB_ID || "0");

if (!TOKEN) { console.error("ERROR: TOKEN env var required"); process.exit(2); }
if (!LAB_ID) { console.error("ERROR: LAB_ID env var required"); process.exit(2); }

const headers = { Authorization: `Bearer ${TOKEN}` };

async function fetchJson(path) {
  const res = await fetch(`${BASE}${path}`, { headers });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${res.status} ${path}: ${txt.slice(0, 200)}`);
  }
  return await res.json();
}

function lengthOf(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object" && Array.isArray(value.maps)) return value.maps.length;
  if (value && typeof value === "object" && Array.isArray(value.coverage)) return value.coverage.length;
  return 0;
}

function setOfNames(value, key) {
  const arr = Array.isArray(value) ? value : value?.maps ?? value?.coverage ?? [];
  return new Set(arr.map((row) => row?.[key]).filter(Boolean));
}

const cases = [
  {
    label: "veritamap/maps",
    legacy: "/api/veritamap/maps",
    scoped: `/api/labs/${LAB_ID}/veritamap/maps`,
    nameKey: "name",
  },
  {
    label: "veritamap/labwide",
    legacy: "/api/veritamap/labwide",
    scoped: `/api/labs/${LAB_ID}/veritamap/labwide`,
    nameKey: "name",
  },
  {
    label: "veritacheck/lab-instruments",
    legacy: "/api/veritacheck/lab-instruments",
    scoped: `/api/labs/${LAB_ID}/veritacheck/lab-instruments`,
    nameKey: "map_name",
  },
  {
    label: "staff/veritamap-suggestions",
    legacy: "/api/staff/veritamap-suggestions",
    scoped: null, // no lab-scoped variant yet; we still probe the legacy path
    nameKey: null,
  },
  {
    label: "veritapt/recommendations (map only)",
    legacy: "/api/veritapt/recommendations",
    scoped: null,
    nameKey: null,
  },
  {
    label: "pt/coverage",
    legacy: "/api/pt/coverage",
    scoped: `/api/labs/${LAB_ID}/pt/coverage`,
    nameKey: null,
  },
];

let pass = 0, fail = 0;

(async () => {
  for (const c of cases) {
    try {
      const legacyData = await fetchJson(c.legacy);
      const legacyLen = lengthOf(legacyData);
      console.log(`[legacy ] ${c.label.padEnd(40)} length=${legacyLen}`);

      if (c.scoped) {
        const scopedData = await fetchJson(c.scoped);
        const scopedLen = lengthOf(scopedData);
        console.log(`[scoped ] ${c.label.padEnd(40)} length=${scopedLen}`);

        if (legacyLen !== scopedLen) {
          console.error(`FAIL ${c.label}: legacy=${legacyLen} scoped=${scopedLen}`);
          fail++;
          continue;
        }
        if (c.nameKey) {
          const legacyNames = setOfNames(legacyData, c.nameKey);
          const scopedNames = setOfNames(scopedData, c.nameKey);
          for (const n of scopedNames) {
            if (!legacyNames.has(n)) {
              console.error(`FAIL ${c.label}: scoped has "${n}", legacy missing`);
              fail++;
              continue;
            }
          }
        }
      }
      pass++;
      console.log(`PASS ${c.label}`);
    } catch (err) {
      console.error(`FAIL ${c.label}: ${err.message}`);
      fail++;
    }
  }

  console.log("");
  console.log(`Summary: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
