// scripts/verify-veritapolicy-author-approval-rules.mts
//
// Who may approve a review step of a policy they uploaded (Michael 2026-10-14):
//   Q187 = 2: a per-step switch "Allow the author to approve this step" (policy_approval_steps.allow_self_approval),
//             off by default, so a TC/TS author can do the preliminary review when the lab allows it.
//   Q188 = 1: the lab's designated, active Medical Director may always approve the Medical Director step of a policy
//             they uploaded (major revisions included); owner/admin designees get no such exception.
// Exercises server/veritapolicyApproval.ts (canUserApproveStep, eligibleReviewerIdsForStep) directly on a scratch COPY
// of a production backup. In the copy only, lab 34 (Redington) names Brandy Morgan (user 100, an active admin there)
// as its Medical Director; Lindsay Webber (user 102) is the lab owner. Nothing is written to production.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify-veritapolicy-author-approval-rules.mts <production-backup.db>
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { canUserApproveStep, eligibleReviewerIdsForStep, authorBlockedFromStep } from "../server/veritapolicyApproval";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
let fails = 0;
const check = (label: string, ok: boolean, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  ${detail}`}`); if (!ok) fails++; };
if (!process.argv[2]) { console.error("usage: ... <backup.db>"); process.exit(2); }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "authorrules-")); const dbPath = path.join(dir, "copy.db"); fs.copyFileSync(process.argv[2], dbPath);
const db = new Database(dbPath);
const LAB = 34, OWNER = 102, MD = 100;
const brandy = db.prepare("SELECT email FROM users WHERE id = ?").get(MD) as { email: string };
db.prepare("UPDATE labs SET medical_director_email = ? WHERE id = ?").run(brandy.email, LAB);
const tc = (allow: number) => ({ required_role: "technical_consultant", specific_user_id: null, allow_self_approval: allow });
const md = (allow: number) => ({ required_role: "medical_director", specific_user_id: null, allow_self_approval: allow });
const can = (userId: number, owner: number, stepRow: any, extra: any = {}) => canUserApproveStep(db, { userId, labId: LAB, documentOwnerId: owner, stepRow, ...extra });

check("1. author on the Technical Consultant step, switch off: blocked", can(OWNER, OWNER, tc(0)).ok === false);
check("2. author on the Technical Consultant step, switch on: allowed", can(OWNER, OWNER, tc(1)).ok === true, JSON.stringify(can(OWNER, OWNER, tc(1))));
check("3. designated Medical Director approving the director step of their own upload: allowed", can(MD, MD, md(0)).ok === true, JSON.stringify(can(MD, MD, md(0))));
check("4. ...including a major revision", can(MD, MD, md(0), { isMajorRevision: true }).ok === true, JSON.stringify(can(MD, MD, md(0), { isMajorRevision: true })));
check("5. owner (a designee, not the director) approving the director step of their own upload: blocked", can(OWNER, OWNER, md(0)).ok === false);
check("6. owner approving the director step of someone else's upload: still allowed as designee", can(OWNER, MD, md(0)).ok === true, JSON.stringify(can(OWNER, MD, md(0))));
check("7. the director exception is only for the director step (director as author on a TC step, switch off: blocked)", can(MD, MD, tc(0)).ok === false);
check("8. authorBlockedFromStep: director on own director step false; owner on own director step true", authorBlockedFromStep(db, LAB, MD, MD, md(0)) === false && authorBlockedFromStep(db, LAB, OWNER, OWNER, md(0)) === true);
const elig = eligibleReviewerIdsForStep(db, { labId: LAB, documentOwnerId: MD, stepRow: md(0) } as any);
check("9. reviewer count for the director's own upload includes the director", elig.has(MD), JSON.stringify([...elig]));
db.prepare("UPDATE labs SET medical_director_email = NULL WHERE id = ?").run(LAB);
check("10. with no designated director, an author on the director step is blocked again", can(MD, MD, md(0)).ok === false);
db.close(); fs.rmSync(dir, { recursive: true, force: true });
console.log(fails ? `\n${fails} FAIL` : "\nALL PASS"); process.exit(fails ? 1 : 0);
