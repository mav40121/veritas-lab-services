// In-app Getting Started (parking lot #72, 2026-10-07, Michael option 1).
//
// Scores every step of the shared 6-phase system path against the lab's REAL
// tables. Nothing derived is ever stored: a lab that deletes its only map goes
// back to "todo" honestly. The only stored state is the two Phase-5 manual
// ticks and the card's dismissal, in lab_onboarding_checks.
//
// Scoping: tables carry lab_id (preferred), account_id, or only user_id (the
// lab owner's). hasCol() checks the live schema so a column added later or
// missing on a legacy DB cannot throw; a step whose data cannot be read reports
// "todo" with the reason in `detail`, never "done".
import type Database from "better-sqlite3";
import { SYSTEM_PHASES, MANUAL_STEP_KEYS, SYSTEM_STEP_COUNT, type GuideStep } from "@shared/gettingStartedContent";

export type StepStatus = "done" | "todo" | "manual";
export interface ScoredStep extends GuideStep {
  status: StepStatus;
  checked?: boolean;      // manual steps only
  detail: string;         // what the score looked at, in plain words
  href?: string;          // lab-scoped path for the Go link
}
export interface GettingStartedPayload {
  labId: number;
  phases: Array<{ title: string; steps: ScoredStep[]; done: number; total: number }>;
  done: number;
  total: number;
  percent: number;
  dismissed: boolean;
}

export const DISMISS_KEY = "card.dismissed";
export function isManualKey(key: string): boolean { return MANUAL_STEP_KEYS.includes(key) || key === DISMISS_KEY; }

export function computeGettingStarted(sqlite: Database.Database, labId: number, userId: number): GettingStartedPayload {
  const colCache = new Map<string, Set<string>>();
  const cols = (table: string): Set<string> => {
    if (!colCache.has(table)) {
      try { colCache.set(table, new Set((sqlite.prepare(`PRAGMA table_info(${table})`).all() as any[]).map((c) => c.name))); }
      catch { colCache.set(table, new Set()); }
    }
    return colCache.get(table)!;
  };
  const hasCol = (table: string, col: string) => cols(table).has(col);
  const n = (sql: string, ...args: any[]): number => { try { return Number((sqlite.prepare(sql).get(...args) as any)?.n ?? 0); } catch { return -1; } };

  const lab = sqlite.prepare("SELECT id, lab_name, clia_number, owner_user_id, medical_director_name, medical_director_email FROM labs WHERE id = ?").get(labId) as any;
  const owner = lab?.owner_user_id ?? userId;
  const user = sqlite.prepare("SELECT name, hipaa_acknowledged, hipaa_acknowledged_at FROM users WHERE id = ?").get(userId) as any;
  // Count rows of a table that belong to this lab: lab_id, else account_id, else the owner's user_id.
  const scoped = (table: string, extra = ""): number => {
    if (hasCol(table, "lab_id")) return n(`SELECT COUNT(*) AS n FROM ${table} WHERE lab_id = ? ${extra}`, labId);
    if (hasCol(table, "account_id")) return n(`SELECT COUNT(*) AS n FROM ${table} WHERE account_id = ? ${extra}`, owner);
    if (hasCol(table, "user_id")) return n(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ? ${extra}`, owner);
    return -1;
  };
  const checks = new Map<string, { checked: boolean }>();
  try {
    for (const r of sqlite.prepare("SELECT step_key, checked FROM lab_onboarding_checks WHERE lab_id = ?").all(labId) as any[]) checks.set(r.step_key, { checked: !!r.checked });
  } catch { /* table missing on a very old DB: no manual ticks */ }

  const mapsQ = hasCol("veritamap_maps", "lab_id") ? "SELECT id FROM veritamap_maps WHERE lab_id = ?" : "SELECT id FROM veritamap_maps WHERE user_id = ?";
  const mapArg = hasCol("veritamap_maps", "lab_id") ? labId : owner;

  const score = (key: string): { status: StepStatus; detail: string } => {
    switch (key) {
      case "p1.profile": {
        const ok = !!(user?.name && String(user.name).trim());
        return { status: ok ? "done" : "todo", detail: ok ? `Signed in as ${user.name}.` : "Your profile has no display name yet." };
      }
      case "p1.hipaa": {
        const ok = !!(user?.hipaa_acknowledged || user?.hipaa_acknowledged_at);
        return { status: ok ? "done" : "todo", detail: ok ? `HIPAA acknowledged ${String(user.hipaa_acknowledged_at || "").slice(0, 10)}.` : "HIPAA acknowledgment not on file for your account." };
      }
      case "p1.identity": {
        const name = String(lab?.lab_name || "").trim();
        const clia = String(lab?.clia_number || "").trim();
        const ok = !!name && !!clia && !/pending/i.test(clia);
        return { status: ok ? "done" : "todo", detail: ok ? `${name}, CLIA ${clia}.` : `Lab name or CLIA number missing (${name || "no name"}, ${clia || "no CLIA"}).` };
      }
      case "p1.members": {
        const members = n("SELECT COUNT(*) AS n FROM lab_members WHERE lab_id = ?", labId);
        const seats = hasCol("user_seats", "lab_id") ? n("SELECT COUNT(*) AS n FROM user_seats WHERE lab_id = ?", labId) : 0;
        const ok = members > 1 || seats > 0;
        return { status: ok ? "done" : "todo", detail: `${Math.max(members, 0)} member(s), ${Math.max(seats, 0)} seat(s) issued.` };
      }
      case "p1.director": {
        const named = !!(lab?.medical_director_name || lab?.medical_director_email);
        const roleRow = n("SELECT COUNT(*) AS n FROM lab_members WHERE lab_id = ? AND role IN ('medical_director','LD')", labId);
        const ok = named || roleRow > 0;
        return { status: ok ? "done" : "todo", detail: ok ? `Medical director on file${lab?.medical_director_name ? `: ${lab.medical_director_name}` : ""}.` : "No medical director or designee designated for this lab." };
      }
      case "p2.map": {
        const maps = n(`SELECT COUNT(*) AS n FROM (${mapsQ})`, mapArg);
        const instruments = n(`SELECT COUNT(*) AS n FROM veritamap_instruments WHERE map_id IN (${mapsQ})`, mapArg);
        const tests = n(`SELECT COUNT(*) AS n FROM veritamap_instrument_tests WHERE map_id IN (${mapsQ})`, mapArg);
        const ok = maps > 0 && instruments > 0 && tests > 0;
        return { status: ok ? "done" : "todo", detail: `${Math.max(maps, 0)} map(s), ${Math.max(instruments, 0)} instrument(s), ${Math.max(tests, 0)} instrument test(s); complexity is required on every test.` };
      }
      case "p2.ranges": {
        const refs = n(`SELECT COUNT(*) AS n FROM veritamap_analyte_values WHERE map_id IN (${mapsQ}) AND (NULLIF(TRIM(COALESCE(ref_range_low,'')),'') IS NOT NULL OR NULLIF(TRIM(COALESCE(ref_range_high,'')),'') IS NOT NULL OR NULLIF(TRIM(COALESCE(critical_low,'')),'') IS NOT NULL OR NULLIF(TRIM(COALESCE(critical_high,'')),'') IS NOT NULL)`, mapArg);
        const amr = n(`SELECT COUNT(*) AS n FROM veritamap_amr_values WHERE map_id IN (${mapsQ}) AND (NULLIF(TRIM(COALESCE(amr_low,'')),'') IS NOT NULL OR NULLIF(TRIM(COALESCE(amr_high,'')),'') IS NOT NULL)`, mapArg);
        const ok = refs > 0 || amr > 0;
        return { status: ok ? "done" : "todo", detail: `${Math.max(refs, 0)} analyte(s) with a reference range or critical value, ${Math.max(amr, 0)} AMR entry(ies).` };
      }
      case "p2.staff": {
        const staff = n("SELECT COUNT(*) AS n FROM staff_employees WHERE lab_id = ? AND status = 'active'", labId);
        const assigned = n("SELECT COUNT(*) AS n FROM staff_employee_instruments WHERE employee_id IN (SELECT id FROM staff_employees WHERE lab_id = ? AND status = 'active')", labId);
        const ok = staff > 0 && assigned > 0;
        return { status: ok ? "done" : "todo", detail: `${Math.max(staff, 0)} active employee(s), ${Math.max(assigned, 0)} instrument assignment(s).` };
      }
      case "p3.study": {
        const studies = scoped("studies");
        return { status: studies > 0 ? "done" : "todo", detail: studies > 0 ? `${studies} VeritaCheck stud${studies === 1 ? "y" : "ies"} on file.` : "No VeritaCheck study yet." };
      }
      case "p3.competency": {
        const a = n("SELECT COUNT(*) AS n FROM competency_assessments a JOIN competency_programs p ON p.id = a.program_id WHERE p.lab_id = ? AND NULLIF(TRIM(COALESCE(a.evaluator_name,'')),'') IS NOT NULL", labId);
        return { status: a > 0 ? "done" : "todo", detail: a > 0 ? `${a} competency assessment(s) with an evaluator.` : "No competency assessment with an evaluator sign-off yet." };
      }
      case "p3.policy": {
        const docs = scoped("policy_documents");
        const signoffs = n("SELECT COUNT(*) AS n FROM policy_signoffs WHERE document_id IN (SELECT id FROM policy_documents WHERE lab_id = ?)", labId);
        return { status: docs > 0 ? "done" : "todo", detail: docs > 0 ? `${docs} polic${docs === 1 ? "y" : "ies"} in VeritaDC, ${Math.max(signoffs, 0)} read-and-sign action(s).` : "No policy authored or imported yet." };
      }
      case "p3.qc": {
        const results = n("SELECT COUNT(*) AS n FROM qc_results WHERE lab_id = ?", labId);
        return { status: results > 0 ? "done" : "todo", detail: results > 0 ? `${results} QC result(s) entered.` : "No QC results entered yet." };
      }
      case "p3.pt_track": {
        const pt = scoped("pt_enrollments_v2");
        const tasks = scoped("veritatrack_tasks", hasCol("veritatrack_tasks", "active") ? "AND active = 1" : "");
        const ok = pt > 0 && tasks > 0;
        return { status: ok ? "done" : "todo", detail: `${Math.max(pt, 0)} PT enrollment(s), ${Math.max(tasks, 0)} active VeritaTrack task(s).` };
      }
      case "p4.inventory": {
        const items = scoped("inventory_items");
        return { status: items > 0 ? "done" : "todo", detail: items > 0 ? `${items} inventory item(s).` : "No inventory items yet." };
      }
      case "p4.schedule_ops": {
        const periods = n("SELECT COUNT(*) AS n FROM schedule_periods WHERE lab_id = ?", labId);
        const cprt = scoped("veritaops_test_cost_studies");
        const ok = periods > 0 || cprt > 0;
        return { status: ok ? "done" : "todo", detail: `${Math.max(periods, 0)} schedule period(s), ${Math.max(cprt, 0)} CPRT stud${cprt === 1 ? "y" : "ies"}.` };
      }
      case "p6.cycles": {
        const docs = scoped("policy_documents");
        const comp = n("SELECT COUNT(*) AS n FROM staff_competency_schedules WHERE lab_id = ?", labId);
        const pt = scoped("pt_enrollments_v2");
        const missing = [docs > 0 ? null : "policy review interval", comp > 0 ? null : "competency cadence", pt > 0 ? null : "PT calendar"].filter(Boolean);
        return { status: missing.length === 0 ? "done" : "todo", detail: missing.length === 0 ? "Policy review, competency cadence and PT calendar all have entries." : `Missing: ${missing.join(", ")}.` };
      }
      case "p6.staff_portal": {
        const seats = hasCol("user_seats", "lab_id") ? n("SELECT COUNT(*) AS n FROM user_seats WHERE lab_id = ? AND seat_type = 'staff_portal'", labId) : 0;
        return { status: seats > 0 ? "done" : "todo", detail: seats > 0 ? `${seats} Staff Portal seat(s) issued.` : "No Staff Portal seats issued yet." };
      }
      default:
        return { status: "todo", detail: "Not scored." };
    }
  };

  let done = 0;
  const phases = SYSTEM_PHASES.map((p) => {
    const steps: ScoredStep[] = p.steps.map((s) => {
      const href = s.route ? (s.route.startsWith("/account") || s.route === "/members" ? s.route : `/labs/${labId}${s.route}`) : undefined;
      if (s.kind === "manual") {
        const c = checks.get(s.key)?.checked ?? false;
        if (c) done += 1;
        return { ...s, status: "manual", checked: c, detail: c ? "Confirmed by an owner or admin." : "Tick this once you have done it; it is the only step the system cannot see.", href };
      }
      const r = score(s.key);
      if (r.status === "done") done += 1;
      return { ...s, status: r.status, detail: r.detail, href };
    });
    return { title: p.title, steps, done: steps.filter((s) => s.status === "done" || (s.status === "manual" && s.checked)).length, total: steps.length };
  });
  return {
    labId,
    phases,
    done,
    total: SYSTEM_STEP_COUNT,
    percent: Math.round((done / SYSTEM_STEP_COUNT) * 100),
    dismissed: checks.get(DISMISS_KEY)?.checked ?? false,
  };
}

export function setGettingStartedCheck(sqlite: Database.Database, labId: number, key: string, checked: boolean, userId: number): void {
  if (!isManualKey(key)) throw new Error(`"${key}" is not a manual step`);
  sqlite.prepare(`INSERT INTO lab_onboarding_checks (lab_id, step_key, checked, checked_by_user_id, checked_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(lab_id, step_key) DO UPDATE SET checked = excluded.checked, checked_by_user_id = excluded.checked_by_user_id, checked_at = excluded.checked_at`)
    .run(labId, key, checked ? 1 : 0, userId, new Date().toISOString());
}
