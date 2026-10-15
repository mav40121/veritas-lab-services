// server/veritalabRegistry.ts
//
// VeritaLab CLIA site registry (St. Charles REQ-072, 2026-10-14; Tracy Tuzzolino keeps 33 CLIAs on a
// spreadsheet and asked for "tracking lab director changes, fee payments, test menu changes, certificate
// links, points of contact for each site, CMS-116s"). Each CLIA site is a lab in VeritaAssure; this adds,
// per site: points of contact, a dated lab director history with the date CMS was notified, CLIA fee
// payments (amount, due, paid), and a test menu change log with the date CMS was notified. Certificate
// links and the CLIA certificate type live on lab_certificates (link_url, clia_certificate_type). The
// all-sites overview rolls every site the user can manage into one list of what is due next.
//
// Access: reading = lab member with a VeritaLab plan; recording or editing = VeritaLab edit
// (requireModuleEdit('veritalab')), the same split as certificates. No patient data anywhere.
import type { Express } from "express";
import { db } from "./db";
import { labLocalDate } from "./dateLocal";

// Same explicit plan allowlist as routes.ts hasLabCertAccess.
function hasRegistryAccess(user: any, lab?: any): boolean {
  const plan = lab?.plan ?? user?.plan;
  return ["annual", "professional", "lab", "complete", "veritamap", "veritascan", "veritacomp", "clinic", "waived", "community", "hospital", "large_hospital", "enterprise"].includes(plan);
}

export const CLIA_CERT_TYPES = ["waiver", "ppm", "compliance", "accreditation", "registration"] as const;

/**
 * The certificate link and CLIA certificate type sent with a certificate save. A field missing from the body
 * keeps the certificate's current value; "" or null clears it. The link must be an http(s) address.
 */
export function certificateExtras(body: any, existing: any): { error?: string; link_url: string | null; clia_certificate_type: string | null } {
  const out = { link_url: existing?.link_url ?? null, clia_certificate_type: existing?.clia_certificate_type ?? null } as any;
  if (body && body.link_url !== undefined) {
    const v = str(body.link_url, 1000);
    if (v && !/^https?:\/\/[^\s]+$/i.test(v)) return { ...out, error: "The certificate link must start with http:// or https://" };
    out.link_url = v;
  }
  if (body && body.clia_certificate_type !== undefined) {
    const v = str(body.clia_certificate_type, 40);
    if (v && !(CLIA_CERT_TYPES as readonly string[]).includes(v)) return { ...out, error: `clia_certificate_type must be one of ${CLIA_CERT_TYPES.join(", ")}` };
    out.clia_certificate_type = v;
  }
  return out;
}

export const FEE_TYPES =["certificate", "compliance_survey", "validation", "registration", "state_license", "other"] as const;
export const MENU_CHANGE_TYPES = ["test_added", "test_removed", "specialty_added", "specialty_removed", "method_change", "complexity_change", "other"] as const;

const isIsoDay = (v: any) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const str = (v: any, max = 200): string | null => {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t ? t.slice(0, max) : null;
};
const day = (v: any): string | null | "invalid" => {
  if (v === null || v === undefined || v === "") return null;
  return isIsoDay(v) ? String(v) : "invalid";
};

type Section = "contacts" | "directors" | "fees" | "menu-changes";
const TABLE: Record<Section, string> = {
  contacts: "lab_site_contacts",
  directors: "lab_director_history",
  fees: "clia_fee_payments",
  "menu-changes": "lab_test_menu_changes",
};

// Validate + normalize a body for one section. Returns { row } or { error }.
function normalize(section: Section, b: any): { row?: Record<string, any>; error?: string } {
  if (section === "contacts") {
    const name = str(b.name, 120);
    if (!name) return { error: "name required" };
    const email = str(b.email, 160);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "email is not a valid address" };
    return { row: { name, role: str(b.role, 120), phone: str(b.phone, 40), email, is_primary: b.is_primary ? 1 : 0, notes: str(b.notes, 500) } };
  }
  if (section === "directors") {
    const name = str(b.director_name, 120);
    if (!name) return { error: "director_name required" };
    const start = day(b.start_date), end = day(b.end_date), notified = day(b.cms_notified_date);
    if (start === "invalid" || end === "invalid" || notified === "invalid") return { error: "dates must be YYYY-MM-DD" };
    if (!start) return { error: "start_date required" };
    if (end && end < start) return { error: "end_date cannot be before start_date" };
    return { row: { director_name: name, credentials: str(b.credentials, 120), start_date: start, end_date: end, cms_notified_date: notified, notes: str(b.notes, 500) } };
  }
  if (section === "fees") {
    const type = b.fee_type ? String(b.fee_type) : "certificate";
    if (!(FEE_TYPES as readonly string[]).includes(type)) return { error: `fee_type must be one of ${FEE_TYPES.join(", ")}` };
    const amount = b.amount === null || b.amount === undefined || b.amount === "" ? null : Number(b.amount);
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) return { error: "amount must be a number, zero or more" };
    const inv = day(b.invoice_date), due = day(b.due_date), paid = day(b.paid_date);
    if (inv === "invalid" || due === "invalid" || paid === "invalid") return { error: "dates must be YYYY-MM-DD" };
    if (!due) return { error: "due_date required" };
    return { row: { fee_type: type, reference: str(b.reference, 80), amount, invoice_date: inv, due_date: due, paid_date: paid, confirmation: str(b.confirmation, 80), notes: str(b.notes, 500) } };
  }
  const type = b.change_type ? String(b.change_type) : "test_added";
  if (!(MENU_CHANGE_TYPES as readonly string[]).includes(type)) return { error: `change_type must be one of ${MENU_CHANGE_TYPES.join(", ")}` };
  const desc = str(b.description, 500);
  if (!desc) return { error: "description required" };
  const changed = day(b.change_date), notified = day(b.cms_notified_date);
  if (changed === "invalid" || notified === "invalid") return { error: "dates must be YYYY-MM-DD" };
  if (!changed) return { error: "change_date required" };
  if (notified && notified < changed) return { error: "cms_notified_date cannot be before change_date" };
  return { row: { change_type: type, description: desc, change_date: changed, cms_notified_date: notified, notes: str(b.notes, 500) } };
}

const ORDER: Record<Section, string> = {
  contacts: "is_primary DESC, name",
  directors: "start_date DESC, id DESC",
  fees: "due_date DESC, id DESC",
  "menu-changes": "change_date DESC, id DESC",
};

export function registryForLab(sqlite: any, labId: number) {
  const out: Record<string, any[]> = {};
  for (const s of Object.keys(TABLE) as Section[]) {
    out[s === "menu-changes" ? "menu_changes" : s] = sqlite.prepare(`SELECT * FROM ${TABLE[s]} WHERE lab_id = ? ORDER BY ${ORDER[s]}`).all(labId);
  }
  return out;
}

// One site's line in the all-sites overview. "Attention" lists what needs action, most urgent first.
export function siteSummary(sqlite: any, lab: any, today: string) {
  const clia = sqlite.prepare(
    "SELECT id, cert_number, expiration_date, clia_certificate_type, link_url, lab_director FROM lab_certificates WHERE lab_id = ? AND cert_type = 'clia' AND is_active = 1 ORDER BY (expiration_date IS NULL), expiration_date DESC LIMIT 1"
  ).get(lab.id) as any;
  const currentDirector = sqlite.prepare(
    "SELECT * FROM lab_director_history WHERE lab_id = ? AND (end_date IS NULL OR end_date >= ?) ORDER BY start_date DESC, id DESC LIMIT 1"
  ).get(lab.id, today) as any;
  const directorNotNotified = (sqlite.prepare("SELECT COUNT(*) AS n FROM lab_director_history WHERE lab_id = ? AND cms_notified_date IS NULL").get(lab.id) as any).n;
  const unpaid = sqlite.prepare("SELECT * FROM clia_fee_payments WHERE lab_id = ? AND paid_date IS NULL ORDER BY due_date ASC").all(lab.id) as any[];
  const overdueFees = unpaid.filter((f) => f.due_date < today);
  const menuNotNotified = (sqlite.prepare("SELECT COUNT(*) AS n FROM lab_test_menu_changes WHERE lab_id = ? AND cms_notified_date IS NULL").get(lab.id) as any).n;
  const lastMenu = sqlite.prepare("SELECT change_date, description FROM lab_test_menu_changes WHERE lab_id = ? ORDER BY change_date DESC, id DESC LIMIT 1").get(lab.id) as any;
  const contact = sqlite.prepare("SELECT name, role, phone, email FROM lab_site_contacts WHERE lab_id = ? ORDER BY is_primary DESC, id LIMIT 1").get(lab.id) as any;
  const attention: string[] = [];
  if (!clia) attention.push("No CLIA certificate on file");
  else if (clia.expiration_date && clia.expiration_date < today) attention.push(`CLIA certificate expired ${clia.expiration_date}`);
  else if (clia.expiration_date) {
    const days = Math.round((Date.parse(clia.expiration_date + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000);
    if (days <= 180) attention.push(`CLIA certificate expires ${clia.expiration_date}`);
  }
  if (overdueFees.length) attention.push(`${overdueFees.length} fee payment${overdueFees.length === 1 ? "" : "s"} overdue`);
  if (directorNotNotified) attention.push("Director change not yet reported to CMS");
  if (menuNotNotified) attention.push(`${menuNotNotified} test menu change${menuNotNotified === 1 ? "" : "s"} not yet reported to CMS`);
  if (!contact) attention.push("No point of contact");
  return {
    lab_id: lab.id,
    lab_name: lab.lab_name,
    clia_number: clia?.cert_number || lab.clia_number || null,
    clia_certificate_type: clia?.clia_certificate_type || null,
    clia_expiration: clia?.expiration_date || null,
    certificate_link: clia?.link_url || null,
    director: currentDirector?.director_name || clia?.lab_director || null,
    next_fee: unpaid[0] ? { due_date: unpaid[0].due_date, amount: unpaid[0].amount, fee_type: unpaid[0].fee_type } : null,
    overdue_fees: overdueFees.length,
    last_menu_change: lastMenu || null,
    contact: contact || null,
    attention,
  };
}

export function registerVeritaLabRegistryRoutes(
  app: Express,
  authMiddleware: any,
  requireWriteAccess: any,
  requireModuleEdit: (mod: string) => any,
) {
  const labScopeMiddleware = (app as any).locals?.labScopeMiddleware;
  if (!labScopeMiddleware) throw new Error("registerVeritaLabRegistryRoutes: labScopeMiddleware not registered");
  const read = [authMiddleware, labScopeMiddleware];
  const edit = [authMiddleware, labScopeMiddleware, requireWriteAccess, requireModuleEdit("veritalab")];
  const sqlite = () => (db as any).$client;
  const gate = (req: any, res: any): boolean => {
    if (hasRegistryAccess(req.user, req.scope?.lab)) return true;
    res.status(403).json({ error: "VeritaLab™ subscription required" });
    return false;
  };

  app.get("/api/labs/:labId/veritalab/registry", ...read, (req: any, res: any) => {
    if (!gate(req, res)) return;
    res.json(registryForLab(sqlite(), req.scope.labId));
  });

  for (const section of Object.keys(TABLE) as Section[]) {
    const table = TABLE[section];
    app.post(`/api/labs/:labId/veritalab/registry/${section}`, ...edit, (req: any, res: any) => {
      if (!gate(req, res)) return;
      const { row, error } = normalize(section, req.body || {});
      if (error) return res.status(400).json({ error });
      const now = new Date().toISOString();
      const cols = Object.keys(row!);
      const tx = sqlite().transaction(() => {
        // A new lab director whose start date is set closes the open record before it (one current director).
        if (section === "directors") {
          sqlite().prepare(`UPDATE lab_director_history SET end_date = ?, updated_at = ? WHERE lab_id = ? AND end_date IS NULL AND start_date < ?`)
            .run(row!.start_date, now, req.scope.labId, row!.start_date);
        }
        if (section === "contacts" && row!.is_primary) {
          sqlite().prepare("UPDATE lab_site_contacts SET is_primary = 0 WHERE lab_id = ?").run(req.scope.labId);
        }
        return sqlite().prepare(
          `INSERT INTO ${table} (lab_id, ${cols.join(", ")}, created_by_user_id, created_at, updated_at) VALUES (?, ${cols.map(() => "?").join(", ")}, ?, ?, ?)`
        ).run(req.scope.labId, ...cols.map((c) => row![c]), req.userId, now, now);
      });
      const info = tx();
      res.status(201).json(sqlite().prepare(`SELECT * FROM ${table} WHERE id = ?`).get(info.lastInsertRowid));
    });

    app.put(`/api/labs/:labId/veritalab/registry/${section}/:id`, ...edit, (req: any, res: any) => {
      if (!gate(req, res)) return;
      const id = Number(req.params.id);
      const existing = sqlite().prepare(`SELECT * FROM ${table} WHERE id = ? AND lab_id = ?`).get(id, req.scope.labId) as any;
      if (!existing) return res.status(404).json({ error: "Record not found in this site" });
      const { row, error } = normalize(section, { ...existing, ...(req.body || {}) });
      if (error) return res.status(400).json({ error });
      const now = new Date().toISOString();
      if (section === "contacts" && row!.is_primary) sqlite().prepare("UPDATE lab_site_contacts SET is_primary = 0 WHERE lab_id = ? AND id <> ?").run(req.scope.labId, id);
      const cols = Object.keys(row!);
      sqlite().prepare(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).run(...cols.map((c) => row![c]), now, id);
      res.json(sqlite().prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id));
    });

    app.delete(`/api/labs/:labId/veritalab/registry/${section}/:id`, ...edit, (req: any, res: any) => {
      if (!gate(req, res)) return;
      const id = Number(req.params.id);
      const existing = sqlite().prepare(`SELECT id FROM ${table} WHERE id = ? AND lab_id = ?`).get(id, req.scope.labId) as any;
      if (!existing) return res.status(404).json({ error: "Record not found in this site" });
      sqlite().prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
      res.json({ ok: true });
    });
  }

  // Every site the user can manage (active member, or admin of the site's organization), one line each.
  // Veritas support access alone does not list a client's sites here.
  app.get("/api/veritalab/sites-overview", authMiddleware, (req: any, res: any) => {
    const labs = sqlite().prepare(
      `SELECT DISTINCT l.id, l.lab_name, l.clia_number, l.plan FROM labs l
         LEFT JOIN lab_members lm ON lm.lab_id = l.id AND lm.user_id = ? AND lm.status = 'active'
        WHERE l.retired_at IS NULL AND (lm.id IS NOT NULL OR l.organization_id IN (
          SELECT om.organization_id FROM organization_members om WHERE om.user_id = ? AND om.status = 'active' AND om.org_role IN ('org_owner', 'org_admin')))
        ORDER BY l.lab_name COLLATE NOCASE`
    ).all(req.userId, req.userId) as any[];
    const today = labLocalDate(new Date().toISOString());
    const sites = labs.filter((l) => hasRegistryAccess(req.user, l)).map((l) => siteSummary(sqlite(), l, today));
    res.json({ today, sites });
  });
}
