// server/noPhiAcknowledgment.ts
//
// BUG-083 (Michael Q66 = 1, 2026-10-28): every account's no-PHI acknowledgment must be the person's own click.
// Self sign-up always required the checkbox, but the two Veritas setup paths (POST /api/admin/provision-owner-lab and
// the invoice-request form, POST /api/invoice/request) stamped hipaa_acknowledged on the owner's behalf. Those paths no
// longer stamp it; anyone whose acknowledgment is not their own click is asked once when they sign in, and that click is
// what users.hipaa_acknowledged_at records.
//
// users.hipaa_ack_source:
//   'signup'    their own click on the sign-up form (POST /api/auth/register)
//   'self'      their own click on the sign-in acknowledgment (POST /api/auth/no-phi-acknowledgment)
//   'on_behalf' stamped by a Veritas setup path without their click (existing rows only; see classify below)
//   NULL        never acknowledged (hipaa_acknowledged 0): new Veritas-provisioned owners, accounts older than the
//               sign-up checkbox

type Row = { email?: string | null; hipaa_acknowledged?: number | null; hipaa_acknowledged_at?: string | null; hipaa_ack_source?: string | null };

// The shared public demo account is signed into by every demo visitor; nobody's acknowledgment belongs on it.
export function needsNoPhiAcknowledgment(row: Row | null | undefined, demoEmail: string): boolean {
  if (!row) return false;
  if (String(row.email || "").toLowerCase() === String(demoEmail || "").toLowerCase()) return false;
  return Number(row.hipaa_acknowledged) !== 1 || row.hipaa_ack_source === "on_behalf";
}

export function noPhiAcknowledgmentStatus(sqlite: any, userId: number, demoEmail: string) {
  const row = sqlite.prepare("SELECT email, hipaa_acknowledged, hipaa_acknowledged_at, hipaa_ack_source FROM users WHERE id = ?").get(userId) as Row | undefined;
  const needed = needsNoPhiAcknowledgment(row, demoEmail);
  return { needed, acknowledgedAt: needed ? null : row?.hipaa_acknowledged_at || null, source: needed ? null : row?.hipaa_ack_source || null };
}

// Records the person's own click. A second call after they have acknowledged changes nothing, so the first click's
// time stays on the record.
export function recordNoPhiAcknowledgment(sqlite: any, userId: number, demoEmail: string): { recorded: boolean; acknowledgedAt: string | null } {
  const row = sqlite.prepare("SELECT email, hipaa_acknowledged, hipaa_acknowledged_at, hipaa_ack_source FROM users WHERE id = ?").get(userId) as Row | undefined;
  if (!row || !needsNoPhiAcknowledgment(row, demoEmail)) return { recorded: false, acknowledgedAt: row?.hipaa_acknowledged_at || null };
  const at = new Date().toISOString();
  sqlite.prepare("UPDATE users SET hipaa_acknowledged = 1, hipaa_acknowledged_at = ?, hipaa_ack_source = 'self' WHERE id = ?").run(at, userId);
  return { recorded: true, acknowledgedAt: at };
}

// Runs ONCE, when the hipaa_ack_source column is added (server/db.ts). Only three code paths ever stamped the
// acknowledgment (git log -S"hipaa_acknowledged = 1"): sign-up (2c648d98), the invoice request (3e370b26) and
// provision-owner-lab (f9f2ed05). provision-owner-lab wrote the same timestamp to the owner's acknowledgment and the
// lab's created_at; the invoice request stamped a new account within milliseconds of its invoice_requests row. Every
// other acknowledged row came from the sign-up form.
export function classifyExistingNoPhiAcknowledgments(sqlite: any): { onBehalf: number; signup: number } {
  const onBehalf = Number(sqlite.prepare(`
    UPDATE users SET hipaa_ack_source = 'on_behalf'
    WHERE hipaa_ack_source IS NULL AND hipaa_acknowledged = 1 AND hipaa_acknowledged_at IS NOT NULL AND (
      EXISTS (SELECT 1 FROM labs l WHERE l.owner_user_id = users.id AND l.created_at = users.hipaa_acknowledged_at)
      OR EXISTS (SELECT 1 FROM invoice_requests r WHERE r.user_id = users.id
                 AND ABS(julianday(r.created_at) - julianday(users.hipaa_acknowledged_at)) * 86400 <= 60)
    )`).run().changes || 0);
  const signup = Number(sqlite.prepare("UPDATE users SET hipaa_ack_source = 'signup' WHERE hipaa_ack_source IS NULL AND hipaa_acknowledged = 1").run().changes || 0);
  return { onBehalf, signup };
}
