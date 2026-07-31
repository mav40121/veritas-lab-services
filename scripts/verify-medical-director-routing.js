#!/usr/bin/env node
/**
 * verify-medical-director-routing.js
 *
 * Receipt for the 2026-07-31 Medical Director designation + approval routing
 * (server/veritapolicyApproval.ts). A lab can name a Laboratory Medical
 * Director by email (labs.medical_director_email). A VeritaPolicy approval
 * step with required_role='medical_director' then routes strictly to that
 * person once they are an ACTIVE member, with the lab owner or an admin
 * allowed to sign as "or designee" (CLIA "medical director or designee").
 *
 * The safety rule that protects every OTHER lab: if no director is designated,
 * OR the designated director is still a pending invite (no active member
 * matches the email), the step FALLS BACK to the permissive Phase-2 behavior
 * (any reviewer seat may approve). So no lab is ever locked out of policy
 * approvals by this change. Self-approval stays blocked unless the step opts in.
 *
 * This mirrors the decision logic of resolveActiveMedicalDirectorUserId,
 * canUserApproveStep, and countEligibleReviewersForStep as pure functions and
 * asserts the outcome per case.
 */

// Mirror of resolveActiveMedicalDirectorUserId: match labs.medical_director_email
// to an ACTIVE member (case-insensitive), else null.
function resolveActiveMD(mdEmail, members) {
  const email = String(mdEmail || "").trim().toLowerCase();
  if (!email) return null;
  const m = members.find(
    (x) => x.status === "active" && String(x.email || "").trim().toLowerCase() === email
  );
  return m ? m.userId : null;
}

// Mirror of the canUserApproveStep decision for a 'medical_director' step.
// approver: { userId, role } (role = this member's lab role: owner|admin|staff)
// step: { allowSelfApproval }
function canApproveMedicalDirectorStep({ approver, documentOwnerId, step, mdEmail, members }) {
  // Self-approval guard runs first, regardless of role.
  if (approver.userId === documentOwnerId && !step.allowSelfApproval) return false;
  const mdUserId = resolveActiveMD(mdEmail, members);
  if (mdUserId != null) {
    // Strict routing: the director, or an owner/admin designee.
    if (approver.userId === mdUserId) return true;
    if (approver.role === "owner" || approver.role === "admin") return true;
    return false;
  }
  // No active designated director -> permissive Phase-2 fallback: any reviewer
  // seat (here modeled as any active member) may approve.
  return true;
}

// Mirror of countEligibleReviewersForStep for a 'medical_director' step.
function countEligibleMedicalDirectorReviewers({ members, documentOwnerId, step, mdEmail }) {
  const mdUserId = resolveActiveMD(mdEmail, members);
  let count = 0;
  for (const m of members) {
    if (m.status !== "active") continue;
    if (m.userId === documentOwnerId && !step.allowSelfApproval) continue;
    if (mdUserId != null) {
      if (m.userId === mdUserId || m.role === "owner" || m.role === "admin") count += 1;
    } else {
      // permissive fallback: any active reviewer seat
      count += 1;
    }
  }
  return count;
}

let fails = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) console.log(`PASS  ${name}`);
  else { fails++; console.log(`FAIL  ${name}\n  expected ${JSON.stringify(want)}\n  got      ${JSON.stringify(got)}`); }
};

// San Carlos-shaped roster: owner (15), admin (37), the director (99, Gilles),
// and a plain tech (41). documentOwner is the tech who authored the policy.
const MD_EMAIL = "azhuskers1@gmail.com";
const rosterActive = [
  { userId: 15, email: "john.hall@scahealth.org", role: "owner", status: "active" },
  { userId: 37, email: "chineme.swann@scahealth.org", role: "admin", status: "active" },
  { userId: 99, email: "azhuskers1@gmail.com", role: "staff", status: "active" }, // Gilles, accepted
  { userId: 41, email: "yau@scahealth.org", role: "staff", status: "active" },
];
// Same roster but the director has NOT accepted (pending -> not an active member row).
const rosterPending = rosterActive.filter((m) => m.userId !== 99);

const openStep = { allowSelfApproval: false };
const selfOkStep = { allowSelfApproval: true };
const docOwner = 41; // the tech who wrote the policy

// --- canUserApproveStep, director ACTIVE ---
eq("director active: director may approve",
  canApproveMedicalDirectorStep({ approver: { userId: 99, role: "staff" }, documentOwnerId: docOwner, step: openStep, mdEmail: MD_EMAIL, members: rosterActive }),
  true);
eq("director active: owner may approve (designee)",
  canApproveMedicalDirectorStep({ approver: { userId: 15, role: "owner" }, documentOwnerId: docOwner, step: openStep, mdEmail: MD_EMAIL, members: rosterActive }),
  true);
eq("director active: admin may approve (designee)",
  canApproveMedicalDirectorStep({ approver: { userId: 37, role: "admin" }, documentOwnerId: docOwner, step: openStep, mdEmail: MD_EMAIL, members: rosterActive }),
  true);
eq("director active: a plain staff member may NOT approve",
  canApproveMedicalDirectorStep({ approver: { userId: 41, role: "staff" }, documentOwnerId: 15, step: openStep, mdEmail: MD_EMAIL, members: rosterActive }),
  false);

// --- self-approval guard still wins ---
eq("director is the document owner, no self-approval: DENIED",
  canApproveMedicalDirectorStep({ approver: { userId: 99, role: "staff" }, documentOwnerId: 99, step: openStep, mdEmail: MD_EMAIL, members: rosterActive }),
  false);
eq("director is the document owner, self-approval enabled: allowed",
  canApproveMedicalDirectorStep({ approver: { userId: 99, role: "staff" }, documentOwnerId: 99, step: selfOkStep, mdEmail: MD_EMAIL, members: rosterActive }),
  true);

// --- director PENDING (invite not accepted) -> permissive fallback ---
eq("director pending: any active member may approve (no lock-out)",
  canApproveMedicalDirectorStep({ approver: { userId: 41, role: "staff" }, documentOwnerId: 15, step: openStep, mdEmail: MD_EMAIL, members: rosterPending }),
  true);

// --- no director designated -> unchanged permissive behavior ---
eq("no director set: any active member may approve",
  canApproveMedicalDirectorStep({ approver: { userId: 41, role: "staff" }, documentOwnerId: 15, step: openStep, mdEmail: "", members: rosterActive }),
  true);

// --- eligible-reviewer counts ---
eq("count: director active, doc owner=tech -> director+owner+admin = 3",
  countEligibleMedicalDirectorReviewers({ members: rosterActive, documentOwnerId: docOwner, step: openStep, mdEmail: MD_EMAIL }),
  3);
eq("count: director active AND is doc owner (no self) -> owner+admin designees = 2",
  countEligibleMedicalDirectorReviewers({ members: rosterActive, documentOwnerId: 99, step: openStep, mdEmail: MD_EMAIL }),
  2);
eq("count: director pending -> permissive, all 3 active reviewers eligible",
  countEligibleMedicalDirectorReviewers({ members: rosterPending, documentOwnerId: 999 /* author not on roster */, step: openStep, mdEmail: MD_EMAIL }),
  3);
eq("count: no director set -> permissive, all active except doc owner = 3",
  countEligibleMedicalDirectorReviewers({ members: rosterActive, documentOwnerId: docOwner, step: openStep, mdEmail: "" }),
  3);

console.log(`\n${fails === 0 ? "All" : "NOT all"} medical-director routing cases passed.`);
if (fails > 0) { console.error(`${fails} case(s) FAILED.`); process.exit(1); }
