// server/continuousBackupWatchdog.ts
//
// Continuous-backup watchdog (Michael Q17, 2026-10-27, "once an hour"). On the morning of 2026-10-27 the per-second
// backup stopped shipping for about two hours (BUG-111) and nothing noticed; a manual re-check caught it. We tell
// customers the recovery point is about one second, so the claim needs an alarm behind it. An hourly check matches the
// fallback: during a gap the hourly copies already cap the loss at about an hour.
//   - Every hour: write a probe row, wait, and confirm a new file reached the R2 replica's level-0 folder after the
//     probe (proof the change left the server, not just that Litestream is running). BEHIND emails info@ once, then
//     every 6 hours while it stays behind, and a recovery email when it is OK again.
//   - Daily at 07:15 UTC (03:15 ET): the full restore self-test (continuousRestoreSelfTest); FAIL emails info@.
//   - Every result is recorded in continuous_backup_checks: the record behind the "about one second" claim.

import { continuousBackupStatus, continuousBackupReplicaPath, continuousRestoreSelfTest } from "./continuousBackup";

export interface ShippingCheck {
  verdict: "OK" | "BEHIND" | "SKIP";
  probeWrittenAt?: string;
  newestUploadAt?: string | null;
  newestKey?: string | null;
  lagSeconds?: number | null;
  notes: string[];
}

export interface WatchdogDeps {
  newestUnder: (prefix: string) => Promise<{ key: string; lastModified: Date } | null>;
  alert: (subject: string, html: string) => Promise<boolean>;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  status: () => { enabled: boolean; reason?: string; generation: number };
}

const HOUR = 60 * 60 * 1000;
const REALERT_MS = 6 * HOUR;
const CLOCK_SKEW_MS = 2000;

export async function defaultDeps(): Promise<WatchdogDeps> {
  const { newestObjectUnder, sendSystemAlert } = await import("./backup");
  return {
    newestUnder: newestObjectUnder,
    alert: sendSystemAlert,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => new Date(),
    status: () => {
      const s: any = continuousBackupStatus();
      return { enabled: !!s.enabled, reason: s.reason, generation: Number(s.generation) || 0 };
    },
  };
}

function record(sqlite: any, kind: "shipping" | "restore", verdict: string, details: unknown, at: Date) {
  try {
    sqlite.prepare("INSERT INTO continuous_backup_checks (kind, verdict, checked_at, details_json) VALUES (?, ?, ?, ?)")
      .run(kind, verdict, at.toISOString(), JSON.stringify(details));
    // Keep 90 days of hourly rows and the watchdog's own probe rows for 30 days; restore results are kept.
    sqlite.prepare("DELETE FROM continuous_backup_checks WHERE kind = 'shipping' AND checked_at < ?").run(new Date(at.getTime() - 90 * 24 * HOUR).toISOString());
    sqlite.prepare("DELETE FROM continuous_backup_probe WHERE note = 'hourly watchdog' AND written_at < ?").run(new Date(at.getTime() - 30 * 24 * HOUR).toISOString());
  } catch (err: any) {
    console.error("[backup-watchdog] Could not record a check:", err?.message || err);
  }
}

// One shipping check: did a change written now reach R2 within waitMs?
export async function checkShipping(sqlite: any, deps: WatchdogDeps, waitMs = 30000): Promise<ShippingCheck> {
  const st = deps.status();
  if (!st.enabled) return { verdict: "SKIP", notes: [`continuous backup is off: ${st.reason || "not enabled"}`] };
  const probeAt = deps.now();
  sqlite.prepare("INSERT INTO continuous_backup_probe (written_at, note) VALUES (?, ?)").run(probeAt.toISOString(), "hourly watchdog");
  await deps.sleep(waitMs);
  const prefix = `${continuousBackupReplicaPath(process.env, st.generation)}/0000/`;
  let newest: { key: string; lastModified: Date } | null = null;
  const notes: string[] = [];
  try {
    newest = await deps.newestUnder(prefix);
  } catch (err: any) {
    notes.push(`could not list ${prefix}: ${err?.message || err}`);
  }
  const shipped = !!newest && newest.lastModified.getTime() >= probeAt.getTime() - CLOCK_SKEW_MS;
  if (!newest && !notes.length) notes.push(`no files under ${prefix}`);
  else if (newest && !shipped) notes.push(`the newest file in R2 is older than the change written ${Math.round(waitMs / 1000)} s ago`);
  return {
    verdict: shipped ? "OK" : "BEHIND",
    probeWrittenAt: probeAt.toISOString(),
    newestUploadAt: newest ? newest.lastModified.toISOString() : null,
    newestKey: newest ? newest.key : null,
    lagSeconds: newest ? Math.max(0, Math.round((deps.now().getTime() - newest.lastModified.getTime()) / 1000)) : null,
    notes,
  };
}

// Alert state lives in memory: a restart re-alerts once if the gap is still there, which is what we want.
const alertState = { behindSince: null as string | null, lastAlertAt: 0 };
export function _resetAlertStateForTests() { alertState.behindSince = null; alertState.lastAlertAt = 0; }

function svcName() { return String(process.env.RAILWAY_SERVICE_NAME || "the main app"); }

export async function runShippingCheck(sqlite: any, deps: WatchdogDeps, waitMs = 30000): Promise<ShippingCheck> {
  const r = await checkShipping(sqlite, deps, waitMs);
  const at = deps.now();
  if (r.verdict !== "SKIP") record(sqlite, "shipping", r.verdict, r, at);
  if (r.verdict === "BEHIND") {
    if (!alertState.behindSince) alertState.behindSince = r.probeWrittenAt || at.toISOString();
    if (at.getTime() - alertState.lastAlertAt >= REALERT_MS) {
      const lag = r.lagSeconds != null ? `${Math.round(r.lagSeconds / 60)} minutes` : "an unknown time";
      const sent = await deps.alert(
        `Continuous backup is behind (${svcName()})`,
        `<p>The hourly check at ${at.toISOString()} found that the continuous backup on ${svcName()} did not ship a new change to R2.</p>
         <p><strong>Newest file in R2:</strong> ${r.newestUploadAt || "none"} (${lag} ago). <strong>Behind since:</strong> ${alertState.behindSince}.</p>
         <p>${(r.notes || []).join("<br>")}</p>
         <p>The hourly copies are the fallback, so the most that could be lost is about an hour of changes. Check the Railway logs for [litestream] and GET /api/admin/continuous-backup. This alert repeats every 6 hours while it stays behind.</p>`,
      );
      if (sent) alertState.lastAlertAt = at.getTime();
    }
  } else if (r.verdict === "OK" && alertState.behindSince) {
    await deps.alert(
      `Continuous backup recovered (${svcName()})`,
      `<p>The hourly check at ${at.toISOString()} found the continuous backup shipping again (newest file in R2 ${r.newestUploadAt}). It was behind from ${alertState.behindSince}.</p>`,
    );
    alertState.behindSince = null;
    alertState.lastAlertAt = 0;
  }
  console.log(`[backup-watchdog] shipping ${r.verdict}${r.lagSeconds != null ? ` (newest upload ${r.lagSeconds}s ago)` : ""}${r.notes.length ? `: ${r.notes.join("; ")}` : ""}`);
  return r;
}

export async function runDailyRestoreTest(sqlite: any, deps: WatchdogDeps): Promise<any> {
  if (!deps.status().enabled) return { verdict: "SKIP" };
  const r = await continuousRestoreSelfTest(sqlite, 5000);
  record(sqlite, "restore", r.verdict, r, deps.now());
  if (r.verdict === "FAIL") {
    await deps.alert(
      `Continuous backup restore test FAILED (${svcName()})`,
      `<p>The daily restore test at ${deps.now().toISOString()} failed: the continuous backup could not be restored with the change written 5 s before.</p>
       <p>${(r.notes || []).join("<br>")}</p>
       <pre style="background:#f4f4f4;padding:12px;border-radius:6px;font-size:11px;overflow:auto;">${JSON.stringify(r, null, 2).slice(0, 4000)}</pre>
       <p>The hourly and nightly copies are unaffected. Re-run GET /api/admin/continuous-backup/restore-test after checking the Railway logs.</p>`,
    );
  }
  console.log(`[backup-watchdog] daily restore test ${r.verdict}`);
  return r;
}

// Scheduler: first shipping check 10 minutes after boot (Litestream settles after a start or reset), then hourly;
// restore test daily at 07:15 UTC. Does nothing when continuous backup is off.
export async function startContinuousBackupWatchdog(sqlite: any): Promise<void> {
  const deps = await defaultDeps();
  if (!deps.status().enabled) { console.log("[backup-watchdog] continuous backup off; watchdog not started"); return; }
  const ship = () => runShippingCheck(sqlite, deps).catch((err: any) => console.error("[backup-watchdog] check failed:", err?.message || err));
  setTimeout(() => { ship(); setInterval(ship, HOUR); }, 10 * 60 * 1000);
  const restore = () => runDailyRestoreTest(sqlite, deps).catch((err: any) => console.error("[backup-watchdog] restore test failed:", err?.message || err));
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(7, 15, 0, 0);
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  setTimeout(() => { restore(); setInterval(restore, 24 * HOUR); }, next.getTime() - now.getTime());
  console.log(`[backup-watchdog] hourly shipping check from 10 minutes after boot; daily restore test in ${Math.round((next.getTime() - now.getTime()) / 60000)} minutes`);
}
