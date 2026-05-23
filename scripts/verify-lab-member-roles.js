#!/usr/bin/env node
/**
 * verify-lab-member-roles.js
 *
 * Receipt for Phase 1 multi-lab role management (admin role + transfer
 * ownership). Exercises:
 *   1. canManageLabMembers / isLabOwner permission helpers.
 *   2. PATCH role-change rules (owner-only, refuses target 'owner',
 *      refuses to change current owner's role).
 *   3. DELETE rules (admin/owner can remove, refuses owner deletion).
 *   4. POST /transfer-ownership atomic state transitions on a simulated
 *      in-memory fixture: role flip, is_primary_lab swap (only when old
 *      owner had it), no lab ends up with 0 or 2 owners.
 *
 * Pure in-memory simulation — does NOT hit production. Mirrors the logic
 * in server/routes.ts so the two must be kept in sync. The point of this
 * script is to catch drift in the rules; if you change the server, also
 * change the helpers below to match.
 *
 * Run with:
 *   node scripts/verify-lab-member-roles.js
 *
 * Exits non-zero on any FAIL.
 */

// ── Mirror of helpers in server/routes.ts ────────────────────────────────
function canManageLabMembers(scope) {
  return scope?.role === "owner" || scope?.role === "admin";
}
function isLabOwner(scope) {
  return scope?.role === "owner";
}

// ── Pure simulation of the lab_members table for the transfer-ownership
//    transaction. Each member is { id, lab_id, user_id, role, is_primary_lab }.
function simulateTransferOwnership(state, oldOwnerUserId, newOwnerUserId, labId) {
  // Returns either {ok: true, state: newState} or {ok: false, error}.
  if (oldOwnerUserId === newOwnerUserId) return { ok: false, error: "Cannot transfer to self" };
  const lab = state.labs.find(l => l.id === labId);
  if (!lab) return { ok: false, error: "Lab not found" };
  if (lab.owner_user_id !== oldOwnerUserId) return { ok: false, error: "owner_user_id mismatch" };

  const next = JSON.parse(JSON.stringify(state));
  const labNext = next.labs.find(l => l.id === labId);
  const oldMember = next.lab_members.find(m => m.lab_id === labId && m.user_id === oldOwnerUserId);
  const newMember = next.lab_members.find(m => m.lab_id === labId && m.user_id === newOwnerUserId);
  if (!oldMember) return { ok: false, error: "Old owner has no active membership" };
  if (!newMember) return { ok: false, error: "Target user is not a member of this lab" };

  labNext.owner_user_id = newOwnerUserId;
  oldMember.role = "admin";
  newMember.role = "owner";
  const primaryMoved = oldMember.is_primary_lab === 1;
  if (primaryMoved) {
    oldMember.is_primary_lab = 0;
    // Clear any other primary the new owner had on a different lab.
    for (const m of next.lab_members) {
      if (m.user_id === newOwnerUserId && m.is_primary_lab === 1 && m.lab_id !== labId) {
        m.is_primary_lab = 0;
      }
    }
    newMember.is_primary_lab = 1;
  }
  return { ok: true, state: next, primaryMoved };
}

// ── Test harness ─────────────────────────────────────────────────────────
let fails = 0;
function check(label, cond, detail) {
  if (cond) {
    console.log(`  PASS  ${label}`);
  } else {
    console.log(`  FAIL  ${label}`);
    if (detail) console.log(`         ${detail}`);
    fails += 1;
  }
}

console.log("--- Phase 1 lab-member-role verification ---");

// ── helpers ──────────────────────────────────────────────────────────────
console.log("\n[helpers]");
check("owner scope can manage members",     canManageLabMembers({ role: "owner" }) === true);
check("admin scope can manage members",     canManageLabMembers({ role: "admin" }) === true);
check("staff scope cannot manage members",  canManageLabMembers({ role: "staff" }) === false);
check("undefined scope cannot manage",      canManageLabMembers(undefined) === false);
check("owner is owner",                     isLabOwner({ role: "owner" }) === true);
check("admin is not owner",                 isLabOwner({ role: "admin" }) === false);
check("staff is not owner",                 isLabOwner({ role: "staff" }) === false);

// ── PATCH role-change rules (logic mirror) ──────────────────────────────
// Mirrors the validation block in the PATCH endpoint.
function patchAllowed(scope, currentRole, requestedRole) {
  if (!isLabOwner(scope)) return { allowed: false, status: 403 };
  if (requestedRole !== "admin" && requestedRole !== "staff") return { allowed: false, status: 400 };
  if (currentRole === "owner") return { allowed: false, status: 409 };
  return { allowed: true, status: 200 };
}
console.log("\n[PATCH role-change]");
check("owner promotes staff -> admin",      patchAllowed({ role: "owner" }, "staff", "admin").allowed === true);
check("owner demotes admin -> staff",       patchAllowed({ role: "owner" }, "admin", "staff").allowed === true);
check("admin cannot promote (403)",         patchAllowed({ role: "admin" }, "staff", "admin").status === 403);
check("staff cannot change roles (403)",    patchAllowed({ role: "staff" }, "staff", "admin").status === 403);
check("PATCH refuses target role=owner",    patchAllowed({ role: "owner" }, "staff", "owner").status === 400);
check("PATCH refuses changing owner's role",patchAllowed({ role: "owner" }, "owner", "admin").status === 409);

// ── DELETE rules (logic mirror) ─────────────────────────────────────────
function deleteAllowed(scope, targetRole) {
  if (!canManageLabMembers(scope)) return { allowed: false, status: 403 };
  if (targetRole === "owner") return { allowed: false, status: 409 };
  return { allowed: true, status: 200 };
}
console.log("\n[DELETE member]");
check("owner removes staff",                deleteAllowed({ role: "owner" }, "staff").allowed === true);
check("owner removes admin",                deleteAllowed({ role: "owner" }, "admin").allowed === true);
check("admin removes staff",                deleteAllowed({ role: "admin" }, "staff").allowed === true);
check("admin removes another admin",        deleteAllowed({ role: "admin" }, "admin").allowed === true);
check("staff cannot remove (403)",          deleteAllowed({ role: "staff" }, "staff").status === 403);
check("nobody can remove owner (409)",      deleteAllowed({ role: "owner" }, "owner").status === 409);

// ── transfer-ownership simulation ────────────────────────────────────────
// Fixture: one lab, owner=user 1, admin=user 2, staff=user 3.
// Owner has lab=4 (Milford) as is_primary_lab=1 (not in this fixture) but
// for this lab it's their non-primary. We test both cases.
function freshFixture() {
  return {
    labs: [{ id: 10, owner_user_id: 1 }],
    lab_members: [
      { id: 100, lab_id: 10, user_id: 1, role: "owner", is_primary_lab: 0 },
      { id: 101, lab_id: 10, user_id: 2, role: "admin", is_primary_lab: 0 },
      { id: 102, lab_id: 10, user_id: 3, role: "staff", is_primary_lab: 0 },
    ],
  };
}
console.log("\n[transfer-ownership]");

// CASE A: transfer to existing admin, no is_primary involvement.
{
  const r = simulateTransferOwnership(freshFixture(), 1, 2, 10);
  check("A: transfer succeeds when target is a member",       r.ok === true);
  check("A: new lab.owner_user_id = 2",                       r.state?.labs[0].owner_user_id === 2);
  check("A: old owner role demoted to admin",                 r.state?.lab_members.find(m => m.user_id === 1).role === "admin");
  check("A: new owner role promoted to owner",                r.state?.lab_members.find(m => m.user_id === 2).role === "owner");
  check("A: is_primary not moved when old owner had it 0",    r.primaryMoved === false);
  const ownerCount = r.state.lab_members.filter(m => m.lab_id === 10 && m.role === "owner").length;
  check("A: exactly 1 owner on the lab after transfer",       ownerCount === 1, `got ${ownerCount}`);
}

// CASE B: same as A but old owner HAD is_primary_lab=1 on this lab.
{
  const fx = freshFixture();
  fx.lab_members.find(m => m.user_id === 1).is_primary_lab = 1;
  const r = simulateTransferOwnership(fx, 1, 2, 10);
  check("B: is_primary_lab moved from old to new owner",       r.primaryMoved === true);
  check("B: old owner is_primary_lab cleared",                 r.state.lab_members.find(m => m.user_id === 1).is_primary_lab === 0);
  check("B: new owner is_primary_lab set",                     r.state.lab_members.find(m => m.user_id === 2).is_primary_lab === 1);
  const primaries = r.state.lab_members.filter(m => m.is_primary_lab === 1).length;
  check("B: exactly 1 primary lab membership in the system",   primaries === 1, `got ${primaries}`);
}

// CASE C: target user is NOT a member of this lab.
{
  const r = simulateTransferOwnership(freshFixture(), 1, 999, 10);
  check("C: refuses when target is not a member",              r.ok === false);
}

// CASE D: caller is not the recorded lab owner.
{
  const fx = freshFixture();
  fx.labs[0].owner_user_id = 99; // someone else owns it
  const r = simulateTransferOwnership(fx, 1, 2, 10);
  check("D: refuses when caller is not the owner of record",   r.ok === false);
}

// CASE E: transfer to self.
{
  const r = simulateTransferOwnership(freshFixture(), 1, 1, 10);
  check("E: refuses transfer-to-self",                          r.ok === false);
}

// CASE F: new owner already has is_primary_lab=1 on a DIFFERENT lab.
//   System invariant: each user has at most one is_primary_lab=1 membership.
//   After transfer where primary moves, the OLD primary on the other lab
//   must be cleared so the user still has exactly one.
{
  const fx = freshFixture();
  fx.lab_members.find(m => m.user_id === 1).is_primary_lab = 1;
  fx.labs.push({ id: 20, owner_user_id: 2 });
  fx.lab_members.push({ id: 200, lab_id: 20, user_id: 2, role: "owner", is_primary_lab: 1 });
  const r = simulateTransferOwnership(fx, 1, 2, 10);
  const u2Primaries = r.state.lab_members.filter(m => m.user_id === 2 && m.is_primary_lab === 1).length;
  check("F: new owner ends with exactly 1 is_primary_lab=1",    u2Primaries === 1, `got ${u2Primaries}`);
  check("F: new owner's other lab primary was cleared",         r.state.lab_members.find(m => m.id === 200).is_primary_lab === 0);
}

console.log("");
if (fails > 0) {
  console.log(`${fails} check(s) FAILED`);
  process.exit(1);
}
console.log("All checks passed.");
