// scripts/verify-access-correction-pass.mjs
//
// Receipt for the full-site access correction pass (2026-10-02), the fixes that the
// global #1426 req.scope fallback did NOT already cover:
//
//   1. VeritaCheck Instrument Verification: hasVeritaCheckAccess ignored the lab
//      entirely (no lab param), so a lab admin/member of a paid lab with a free
//      personal plan was 403'd on the whole module, even on the lab-scoped route.
//      Now takes a lab param and gates on lab?.plan ?? user?.plan, with every call
//      site passing req.scope?.lab.
//   2. Under-gated writes: VeritaBench + VeritaStock + PI data-write routes had NO
//      requireModuleEdit, so an active seat set view-only on those modules could
//      still write. Now the data-write routes are requireModuleEdit-gated (doc/PDF
//      generators intentionally left ungated so view-only seats can still run them).
//
// Verified live on a copy of prod data (user 17 = admin, free personal plan, lab 25):
//   VeritaCheck verifications GET 403 -> 200; inventory write gate returns 400
//   (validation) not 403 for the admin (admin bypass intact).
//
// Run: node scripts/verify-access-correction-pass.mjs

import { readFileSync } from "fs";
const root = new URL("../", import.meta.url);
let fails = 0;
const ok = (n, c, d = "") => { if (c) console.log(`  PASS  ${n}`); else { fails++; console.log(`  FAIL  ${n}${d ? " -- " + d : ""}`); } };

const vcv = readFileSync(new URL("server/veritacheck_verification.ts", root), "utf8");
const bench = readFileSync(new URL("server/veritabench.ts", root), "utf8");

console.log("1. VeritaCheck Instrument Verification is lab-aware");
ok("hasVeritaCheckAccess takes a lab param and uses lab?.plan ?? user?.plan",
  /function hasVeritaCheckAccess\(user: any, lab\?: any\)[\s\S]{0,120}lab\?\.plan \?\? user\?\.plan/.test(vcv));
ok("no call site still ignores the lab (hasVeritaCheckAccess(req.user) alone)",
  !/hasVeritaCheckAccess\(req\.user\)(?!,)/.test(vcv));
ok("call sites pass req.scope?.lab",
  (vcv.match(/hasVeritaCheckAccess\(req\.user, req\.scope\?\.lab\)/g) || []).length >= 15);

console.log("\n2. VeritaBench/VeritaStock data-write routes are requireModuleEdit-gated");
for (const [label, re] of [
  ["POST /api/productivity", /app\.post\("\/api\/productivity", authMiddleware, requireWriteAccess, requireModuleEdit\('veritabench'\)/],
  ["POST /api/staffing-studies", /app\.post\("\/api\/staffing-studies", authMiddleware, requireWriteAccess, requireModuleEdit\('veritabench'\)/],
  ["POST /api/pi/entries", /app\.post\("\/api\/pi\/entries", authMiddleware, requireWriteAccess, requireModuleEdit\('veritabench'\)/],
  ["POST /api/inventory", /app\.post\("\/api\/inventory", authMiddleware, requireWriteAccess, requireModuleEdit\('veritastock'\)/],
  ["PUT /api/inventory/:id", /app\.put\("\/api\/inventory\/:id", authMiddleware, requireWriteAccess, requireModuleEdit\('veritastock'\)/],
  ["DELETE /api/inventory/:id", /app\.delete\("\/api\/inventory\/:id", authMiddleware, requireWriteAccess, requireModuleEdit\('veritastock'\)/],
]) ok(`${label} gated`, re.test(bench));
ok("gated with the correct keys (veritabench + veritastock both present)",
  bench.includes("requireModuleEdit('veritabench')") && bench.includes("requireModuleEdit('veritastock')"));
// Doc generators stay ungated so view-only seats can still produce reports.
ok("reorder-list PDF/Excel NOT gated (view-only seats can still generate reports)",
  !/reorder-list[^\n]*requireModuleEdit/.test(bench));

console.log(`\n${fails === 0 ? "ALL PASS" : fails + " FAIL"}`);
process.exit(fails === 0 ? 0 : 1);
