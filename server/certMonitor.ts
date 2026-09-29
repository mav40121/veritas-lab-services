// server/certMonitor.ts
//
// TLS certificate expiry monitor (2026-09-29). Born from a real incident: the
// public www cert renewed late on 2026-09-28/29, and a hospital prospect's
// (Sanford) TLS-inspection proxy hit the brief expired window, cached the
// "expired certificate" verdict, and BLOCKED the site, which nearly cost a
// five-figure enterprise deal. A compliance vendor serving an expired cert to a
// hospital is the worst possible optics, and the operator found out from the
// prospect, not from us. This job checks the public certs nightly and alerts
// (Resend, same pattern as server/backup.ts) when one is expired, expiring
// within WARN_DAYS, or unreachable, so we hear about it before a prospect does.
//
// Railway auto-renews the Let's Encrypt (www) cert; this does not renew, it
// watches, so a failing/late renewal surfaces loudly instead of silently.

import tls from "node:tls";

// The public hostnames a prospect or a strict network actually hits.
export const MONITORED_HOSTS = ["www.veritaslabservices.com", "veritaslabservices.com"];
// Alert when a cert has this many days or fewer before it expires. Let's Encrypt
// renews ~30 days out, so <= 14 days means the renewal is not happening.
export const WARN_DAYS = 14;
const NOTIFY_TO = "info@veritaslabservices.com";

export interface CertInfo {
  host: string;
  validTo: string | null;
  daysLeft: number | null;
  issuer: string | null;
  ok: boolean;      // false when expired, unreachable, or no cert
  error?: string;
}

// Reads the leaf cert a host serves and returns days-to-expiry. rejectUnauthorized
// is false ON PURPOSE: we want to READ the dates of an expired/mismatched cert so
// we can alert on it, rather than have the TLS handshake throw and tell us nothing.
export function getCertExpiry(host: string, port = 443, timeoutMs = 10000): Promise<CertInfo> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (r: CertInfo) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* noop */ }
      resolve(r);
    };
    const socket = tls.connect(
      { host, port, servername: host, timeout: timeoutMs, rejectUnauthorized: false },
      () => {
        const cert = socket.getPeerCertificate();
        if (!cert || !cert.valid_to) {
          return finish({ host, validTo: null, daysLeft: null, issuer: null, ok: false, error: "no certificate" });
        }
        const validTo = new Date(cert.valid_to);
        const daysLeft = Math.floor((validTo.getTime() - Date.now()) / 86400000);
        const issuer = (cert.issuer && (cert.issuer as any).O) ? String((cert.issuer as any).O) : null;
        finish({ host, validTo: validTo.toISOString(), daysLeft, issuer, ok: daysLeft > 0 });
      },
    );
    socket.on("error", (e: any) => finish({ host, validTo: null, daysLeft: null, issuer: null, ok: false, error: String(e?.message || e) }));
    socket.on("timeout", () => finish({ host, validTo: null, daysLeft: null, issuer: null, ok: false, error: "timeout" }));
  });
}

// Checks every monitored host and, on any expired / soon-to-expire / unreachable
// cert, sends one Resend alert. Returns the full result set for the on-demand
// admin endpoint. Never throws.
export async function runCertExpiryCheck(): Promise<{ checked: number; results: CertInfo[]; alerts: CertInfo[] }> {
  let results: CertInfo[] = [];
  try {
    results = await Promise.all(MONITORED_HOSTS.map((h) => getCertExpiry(h)));
  } catch (err: any) {
    console.error("[cert-monitor] Check failed:", err?.message || err);
    return { checked: 0, results: [], alerts: [] };
  }

  for (const r of results) {
    console.log(`[cert-monitor] ${r.host}: ${r.error ? "ERROR " + r.error : r.daysLeft + " days left (expires " + r.validTo + ", " + r.issuer + ")"}`);
  }

  const alerts = results.filter((r) => !r.ok || r.daysLeft == null || r.daysLeft <= WARN_DAYS);
  if (alerts.length > 0 && process.env.RESEND_API_KEY) {
    try {
      const { Resend } = await import("resend");
      const resend = new Resend(process.env.RESEND_API_KEY);
      const rows = alerts
        .map((a) => `<tr><td style="padding:6px 12px;border:1px solid #ddd">${a.host}</td><td style="padding:6px 12px;border:1px solid #ddd">${a.error ? "ERROR: " + a.error : a.daysLeft + " days left (expires " + a.validTo + ")"}</td></tr>`)
        .join("");
      await resend.emails.send({
        from: "VeritaAssure System <info@veritaslabservices.com>",
        to: NOTIFY_TO,
        subject: "[VeritaAssure] TLS certificate expiring or unreachable",
        html: `<p>One or more monitored public TLS certificates are expired, expiring within ${WARN_DAYS} days, or unreachable. A lapsed public certificate can get the site blocked by strict networks (for example a hospital TLS-inspection proxy), so this needs attention before a prospect or customer hits it.</p>
               <table style="border-collapse:collapse;font-size:12px">
                 <tr style="background:#f0f0f0"><th style="padding:6px 12px;border:1px solid #ddd;text-align:left">Host</th><th style="padding:6px 12px;border:1px solid #ddd;text-align:left">Status</th></tr>
                 ${rows}
               </table>
               <p style="margin-top:16px;color:#666">Railway auto-renews the Let's Encrypt certificate for www. If this alert fired, confirm the renewal is healthy in the Railway dashboard. Full status is available at /api/admin/cert-status.</p>`,
      });
      console.log(`[cert-monitor] Alert sent for ${alerts.length} host(s).`);
    } catch (emailErr: any) {
      console.error("[cert-monitor] Alert send failed:", emailErr?.message || emailErr);
    }
  }

  return { checked: results.length, results, alerts };
}
