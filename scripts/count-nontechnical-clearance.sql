-- scripts/count-nontechnical-clearance.sql
--
-- Read-only. Counts, with no names and no lab ids, what a non-technical record already did before these paths were closed on 2026-11-06. The fix rewrites none of
-- these rows and nobody's clearance moves at deploy; these are the numbers for Michael to decide what, if anything, happens to them.
-- tests/integration/competency-clearance-program-type.test.ts runs this exact file against made-up rows, so the definitions are proved.
--
-- No admin route gives these. Running it on production takes a counts-only admin route or Michael's OK for a read; nothing has run it there.
--
--   people_cleared_on_nontechnical_only   VeritaStaff reads them cleared for patient testing, Bulk Import or a whole-record sign filled that record, and the only
--                                         passed competency behind it is non-technical: no technical or waived record, method sign-off or past method date.
--                                         Possible only since 2026-10-27, when those two paths started writing the schedule. Both have always written the audit row
--                                         this reads.
--   labs_with_people_cleared_on_nontechnical_only   how many labs those people are in.
--   people_with_clock_from_nontechnical_date   they do have testing competency on file, but a date on the record filled by those paths matches a non-technical
--                                         record and no technical or waived one, so their technical clock runs from the wrong record.
--   duty_change_events_closed_by_nontechnical   an analyzer added to a person, closed by a non-technical Duty Change record. Possible since 2026-06-06.
--   open_duty_change_events_nontechnical_would_have_closed   the one figure that moves with the fix: still open, with a non-technical Duty Change record that the next read of
--                                         the list would have closed them with. They now stay open and on the list until a technical or waived record or a person closes them.
--   records_with_stored_type_not_the_programs   competency_assessments.competency_type disagrees with the program. Nothing decides on the stored value any more.
WITH
filled_from_records AS (
  SELECT DISTINCT CAST(entity_id AS INTEGER) AS employee_id FROM audit_log
   WHERE entity_type = 'competency_schedule'
     AND (entity_label LIKE '%(from historical import)' OR entity_label LIKE '%(initial from VeritaComp record)')
),
nontechnical_pass AS (
  SELECT ce.staff_employee_id AS employee_id, a.assessment_date AS day
    FROM competency_assessments a
    JOIN competency_programs p ON p.id = a.program_id
    JOIN competency_employees ce ON ce.id = a.employee_id
   WHERE p.type = 'nontechnical' AND a.status = 'pass' AND a.locked = 1 AND a.assessment_type <> 'orientation' AND ce.staff_employee_id IS NOT NULL
),
testing_pass AS (
  SELECT ce.staff_employee_id AS employee_id, a.assessment_date AS day
    FROM competency_assessments a
    JOIN competency_programs p ON p.id = a.program_id
    JOIN competency_employees ce ON ce.id = a.employee_id
   WHERE p.type IN ('technical', 'waived') AND a.status = 'pass' AND a.locked = 1 AND a.assessment_type <> 'orientation' AND ce.staff_employee_id IS NOT NULL
  UNION
  SELECT staff_employee_id, signed_date FROM competency_method_signoffs WHERE revoked_at IS NULL AND (determination = 'pass' OR determination IS NULL)
  UNION
  SELECT staff_employee_id, completed_date FROM competency_method_history WHERE removed_at IS NULL
),
cleared_on_nontechnical_only AS (
  SELECT s.employee_id, e.tier2_lab_id AS lab_id
    FROM staff_competency_schedules s
    JOIN staff_employees e ON e.id = s.employee_id
   WHERE (s.recorded_as = 'existing' OR s.initial_completed_at IS NOT NULL)
     AND s.employee_id IN (SELECT employee_id FROM filled_from_records)
     AND s.employee_id IN (SELECT employee_id FROM nontechnical_pass)
     AND s.employee_id NOT IN (SELECT employee_id FROM testing_pass)
),
schedule_dates AS (
  SELECT employee_id, initial_completed_at AS day FROM staff_competency_schedules WHERE initial_completed_at IS NOT NULL
  UNION SELECT employee_id, six_month_completed_at FROM staff_competency_schedules WHERE six_month_completed_at IS NOT NULL
  UNION SELECT employee_id, last_annual_completed_at FROM staff_competency_schedules WHERE last_annual_completed_at IS NOT NULL
)
SELECT
  (SELECT COUNT(DISTINCT employee_id) FROM cleared_on_nontechnical_only) AS people_cleared_on_nontechnical_only,
  (SELECT COUNT(DISTINCT lab_id) FROM cleared_on_nontechnical_only) AS labs_with_people_cleared_on_nontechnical_only,
  (SELECT COUNT(DISTINCT d.employee_id)
     FROM schedule_dates d
     JOIN nontechnical_pass n ON n.employee_id = d.employee_id AND n.day = d.day
    WHERE d.employee_id IN (SELECT employee_id FROM filled_from_records)
      AND d.employee_id IN (SELECT employee_id FROM testing_pass)
      AND NOT EXISTS (SELECT 1 FROM testing_pass t WHERE t.employee_id = d.employee_id AND t.day = d.day)) AS people_with_clock_from_nontechnical_date,
  (SELECT COUNT(*)
     FROM staff_duty_change_events ev
     JOIN competency_assessments a ON a.id = ev.resolved_assessment_id
     JOIN competency_programs p ON p.id = a.program_id
    WHERE p.type = 'nontechnical') AS duty_change_events_closed_by_nontechnical,
  (SELECT COUNT(*)
     FROM staff_duty_change_events ev
    WHERE ev.resolved_at IS NULL
      AND EXISTS (SELECT 1 FROM competency_assessments a JOIN competency_employees ce ON ce.id = a.employee_id JOIN competency_programs p ON p.id = a.program_id
                   WHERE ce.staff_employee_id = ev.employee_id AND a.assessment_type = 'duty_change' AND date(a.assessment_date) >= date(ev.detected_at) AND p.type = 'nontechnical')
      AND NOT EXISTS (SELECT 1 FROM competency_assessments a JOIN competency_employees ce ON ce.id = a.employee_id JOIN competency_programs p ON p.id = a.program_id
                       WHERE ce.staff_employee_id = ev.employee_id AND a.assessment_type = 'duty_change' AND date(a.assessment_date) >= date(ev.detected_at) AND p.type IN ('technical', 'waived'))
  ) AS open_duty_change_events_nontechnical_would_have_closed,
  (SELECT COUNT(*)
     FROM competency_assessments a
     JOIN competency_programs p ON p.id = a.program_id
    WHERE a.competency_type <> p.type) AS records_with_stored_type_not_the_programs;
