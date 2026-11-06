// server/policyReadSignSeed.ts
//
// One time, on the boot that creates policy_read_sign_assignments (server/db.ts; the new table is the marker, so this is the one-shot
// the boot-migration rule allows). Before that table existed, every Staff login saw every approved document as theirs to sign. A lab
// already working that way keeps it: it gets one assignment, "Everyone in the lab, All documents", which an editor can see and take off.
//
// Which labs: approved documents, and a Staff login or a staff signature, so someone has a list today that would otherwise go empty.
// Left out on purpose:
//   - a lab holding documents carried over from a prior system (policy_carried_records): those arrive with no read-and-sign assigned,
//     so its staff see nothing until an editor assigns it. This is what keeps Heywood's 742 from going to everyone;
//   - a lab with no approved documents or no staff: nothing to keep, so it starts the new way.
// Kept free of app imports because server/db.ts loads it.

export function seedLabsAlreadyWorkingTheOldWay(sqlite: any): number {
  const out = sqlite.prepare(
    `INSERT OR IGNORE INTO policy_read_sign_assignments (lab_id, scope_type, target_type, assigned_at, origin)
     SELECT l.id, 'lab', 'everyone', datetime('now'), 'kept_as_it_was'
       FROM labs l
      WHERE EXISTS (SELECT 1 FROM policy_documents d WHERE d.lab_id = l.id AND d.status = 'approved' AND d.archived_at IS NULL)
        AND (EXISTS (SELECT 1 FROM user_seats us WHERE us.lab_id = l.id AND us.seat_type = 'staff_portal' AND us.status IN ('active','pending'))
          OR EXISTS (SELECT 1 FROM staff_portal_policy_signatures s WHERE s.lab_id = l.id))
        AND NOT EXISTS (SELECT 1 FROM policy_carried_records c WHERE c.lab_id = l.id)`
  ).run();
  return Number(out.changes);
}
