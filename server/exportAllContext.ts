// server/exportAllContext.ts
//
// "Download all of this lab's records" (exit terms; Michael 2026-10-16, Q50 = 1). The export job builds its
// zip by calling the app's own export routes over loopback, as the lab owner. Those routes sit behind plan
// gates, which return 403 once a subscription has ended (BUG-067), and the zip has to work then too.
// So, for the job's own requests only, the plan gates let the request through:
//   - each job registers a random secret for its lab;
//   - a request carrying that secret in X-Export-All-Job AND arriving over loopback runs inside an
//     AsyncLocalStorage context naming the lab;
//   - every plan gate calls exportAllPlanBypass(lab) first.
// Nothing else changes: membership, lab scoping and the owner checks still apply, and no outside request
// can carry the context (it needs the secret and a loopback socket).

import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";

const store = new AsyncLocalStorage<{ labId: number }>();
const secrets = new Map<string, number>();

export function registerExportSecret(labId: number): string {
  const secret = crypto.randomBytes(24).toString("hex");
  secrets.set(secret, labId);
  return secret;
}

export function revokeExportSecret(secret: string): void {
  secrets.delete(secret);
}

// True only inside an export job's own request for this lab (or a legacy route that resolves the lab from
// X-Active-Lab-Id and passes no lab to the gate).
export function exportAllPlanBypass(lab?: any): boolean {
  const s = store.getStore();
  if (!s) return false;
  return !lab || Number(lab.id) === s.labId;
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

// Registered after the body parsers and before the routes (so the context survives into the handlers).
export function exportAllMiddleware(req: any, _res: any, next: () => void) {
  const h = req.headers?.["x-export-all-job"];
  if (!h) return next();
  const labId = secrets.get(String(h));
  if (!labId || !LOOPBACK.has(String(req.socket?.remoteAddress || ""))) return next();
  // A verified job request: record-view logging (server/recordViews.ts) leaves the owner's own export out.
  req.exportAllJob = true;
  return store.run({ labId }, () => next());
}
