// server/policyComplianceCounts.ts
//
// Two reads behind the VeritaDC compliance page (GET /api/labs/:labId/veritapolicy/compliance) and its xlsx export,
// moved out of routes.ts (2026-11-11) so both routes and the compliance digest (server/digestCounts.ts) run the same
// SQL. The routes' answers are unchanged.
//   - the headline: documents by status (approved, in review, draft, expired) and the total, archived ones left out;
//   - the overdue list: approved documents whose next review date has passed. The nightly job
//     (server/veritapolicyReminders.ts) moves an approved document more than 60 days past review to 'expired', so
//     "past review" on the page is this list plus the expired count.

export function policyComplianceHeadline(sqlite: any, labId: number): any {
  return sqlite
    .prepare(
      `SELECT
          SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved_total,
          SUM(CASE WHEN status = 'in_review' THEN 1 ELSE 0 END) AS in_review_total,
          SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS draft_total,
          SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) AS expired_total,
          COUNT(id) AS doc_total
         FROM policy_documents
        WHERE lab_id = ? AND archived_at IS NULL`
    )
    .get(labId) as any;
}

/** Every approved document past its next review date (today = the lab's calendar day), oldest due first. */
export function policyOverdueDocuments(sqlite: any, labId: number, today: string): any[] {
  return sqlite
    .prepare(
      `SELECT d.id, d.title, d.next_review_date, d.manual_id,
              m.name AS manual_name
         FROM policy_documents d
         LEFT JOIN policy_manuals m ON m.id = d.manual_id
        WHERE d.lab_id = ? AND d.archived_at IS NULL
          AND d.status = 'approved'
          AND d.next_review_date IS NOT NULL
          AND date(d.next_review_date) < date(@today)
        ORDER BY d.next_review_date ASC`
    )
    .all(labId, { today }) as any[];
}
