// scripts/verify-member-access-fix.mjs
//
// Receipt for the "admin could not do admin functions" fix (2026-10-02).
//
// Two root causes for a user who reaches a lab via MEMBERSHIP (owner/admin) rather
// than a personal subscription:
//   1. requireModuleEdit only bypassed the literal lab OWNER. An admin with a
//      non-edit seat (e.g. a view_all seat) was 403'd on every module write. Fixed
//      by also bypassing lab_members(owner/admin) and org_owner/org_admin.
//   2. On UNSCOPED routes (e.g. all /api/veritatrack/* writes) req.scope.lab is
//      unset, so hasTrackAccess read the caller's PERSONAL plan ('free' for an admin
//      who joined via membership) and 403'd with "subscription required". Fixed by
//      resolving the ACTIVE lab (with its plan) via trackLab(req).
//
// Verified live (local server on a copy of prod data), user 17 = admin on lab 25
// with a view_all seat and a free personal plan, enterprise lab:
//   BEFORE: GET /api/veritatrack/tasks 403, POST signoff 403
//   AFTER:  GET 200, POST signoff 200 (record created, map synced)
//
// Run: node scripts/verify-member-access-fix.mjs

import { readFileSync } from "fs";
import { readdirSync } from "fs";

const root = new URL("../", import.meta.url);
let fails = 0;
const ok = (n, c, d = "") => { if (c) console.log(`  PASS  ${n}`); else { fails++; console.log(`  FAIL  ${n}${d ? " -- " + d : ""}`); } };

const routes = readFileSync(new URL("server/routes.ts", root), "utf8");
const track = readFileSync(new URL("server/veritatrack.ts", root), "utf8");

console.log("1. requireModuleEdit grants admins edit parity with owners");
const rme = routes.slice(routes.indexOf("function requireModuleEdit"), routes.indexOf("function requireModuleEdit") + 3600);
ok("checks lab_members role owner/admin", /FROM lab_members WHERE lab_id = \? AND user_id = \? AND status = 'active' AND role IN \('owner','admin'\)/.test(rme));
ok("checks org_owner/org_admin on the lab's org", /organization_members om JOIN labs l[\s\S]{0,260}org_role IN \('org_owner','org_admin'\)/.test(rme));
ok("admin passes before the seat-permission 403", rme.indexOf("if (adminMember) return next()") > 0 && rme.indexOf("if (adminMember) return next()") < rme.indexOf("view-only access to"));

console.log("\n2. VeritaTrack access uses the ACTIVE lab's plan, not the personal plan");
ok("trackLab(req) helper defined (scope.lab, else resolveActiveLabForRequest)", /const trackLab = \(req: any\) =>[\s\S]{0,120}resolveActiveLabForRequest/.test(track));
ok("no hasTrackAccess call still reads req.scope?.lab directly", !/hasTrackAccess\(req\.user, req\.scope\?\.lab\)/.test(track));
ok("hasTrackAccess calls go through trackLab(req)", (track.match(/hasTrackAccess\(req\.user, trackLab\(req\)\)/g) || []).length >= 15);
ok("resolveActiveLabForRequest is threaded into registerVeritaTrackRoutes", /registerVeritaTrackRoutes\(app, authMiddleware, requireWriteAccess, requireModuleEdit, resolveActiveLabForRequest\)/.test(routes));

console.log("\n3. Global fallback: unscoped routes get the ACTIVE lab's scope (so EVERY module's access check uses the lab plan, not the personal plan)");
const am = routes.slice(routes.indexOf("function authMiddleware"), routes.indexOf("function authMiddleware") + 7000);
ok("authMiddleware sets req.scope fallback from resolveActiveLabForRequest when unset",
  /if \(!req\.scope\)[\s\S]{0,400}resolveActiveLabForRequest\(req\.userId, req\)[\s\S]{0,200}req\.scope = \{ lab: activeLab/.test(am));
ok("fallback is non-fatal (wrapped in try/catch)", /if \(!req\.scope\) \{\s*try \{/.test(am));

console.log(`\n${fails === 0 ? "ALL PASS" : fails + " FAIL"}`);
process.exit(fails === 0 ? 0 : 1);
