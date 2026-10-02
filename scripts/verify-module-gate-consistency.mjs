// scripts/verify-module-gate-consistency.mjs
//
// Receipt for the seat module-gate invariant. A module whose write routes are gated
// by requireModuleEdit('X') MUST be grantable in seat permissions, or custom/view_all
// seats resolve to 'view' and are PERMANENTLY locked out with no UI toggle to fix it
// (the VeritaOps lockout found 2026-10-02). So: every requireModuleEdit key must be in
// BOTH SEAT_MODULE_KEYS (shared/schema.ts) and MODULE_LIST (AccountSettingsPage.tsx).
//
// The reverse direction (grantable but NOT gated -> the view-only toggle is cosmetic,
// e.g. veritastock/veritabench today) is REPORTED as a warning, not failed, because
// enforcing those gates is a separate, deliberate change.
//
// Run: node scripts/verify-module-gate-consistency.mjs

import { readFileSync } from "fs";
import { readdirSync } from "fs";

const root = new URL("../", import.meta.url);
let fails = 0;
const ok = (name, cond, detail = "") => { if (cond) console.log(`  PASS  ${name}`); else { fails++; console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); } };

// Gated modules: every requireModuleEdit('X') across server/*.ts
const serverDir = new URL("server/", root);
const gated = new Set();
for (const f of readdirSync(serverDir).filter((n) => n.endsWith(".ts"))) {
  const src = readFileSync(new URL(f, serverDir), "utf8");
  for (const m of src.matchAll(/requireModuleEdit\(\s*['"]([a-z]+)['"]\s*\)/g)) gated.add(m[1]);
}

// Grantable in seat permissions
const schema = readFileSync(new URL("shared/schema.ts", root), "utf8");
const seatBlock = schema.slice(schema.indexOf("SEAT_MODULE_KEYS = ["), schema.indexOf("] as const", schema.indexOf("SEAT_MODULE_KEYS = [")));
const seatKeys = new Set([...seatBlock.matchAll(/'([a-z]+)'/g)].map((m) => m[1]));

const settings = readFileSync(new URL("client/src/pages/AccountSettingsPage.tsx", root), "utf8");
const listBlock = settings.slice(settings.indexOf("MODULE_LIST = ["), settings.indexOf("];", settings.indexOf("MODULE_LIST = [")));
const listKeys = new Set([...listBlock.matchAll(/key:\s*'([a-z]+)'/g)].map((m) => m[1]));

console.log(`gated(requireModuleEdit)=${[...gated].sort().join(",")}`);
console.log(`SEAT_MODULE_KEYS=${[...seatKeys].sort().join(",")}`);
console.log(`MODULE_LIST=${[...listKeys].sort().join(",")}\n`);

console.log("Every gated module must be grantable (in SEAT_MODULE_KEYS AND MODULE_LIST):");
for (const g of [...gated].sort()) {
  ok(`${g} in SEAT_MODULE_KEYS`, seatKeys.has(g));
  ok(`${g} in MODULE_LIST`, listKeys.has(g));
}

console.log("\n(warn) grantable but NOT gated -> view-only toggle is cosmetic until a gate is added:");
for (const k of [...seatKeys].sort()) if (!gated.has(k)) console.log(`  warn  ${k}`);

console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAIL`}`);
process.exit(fails === 0 ? 0 : 1);
