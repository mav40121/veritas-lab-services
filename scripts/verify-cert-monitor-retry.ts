// scripts/verify-cert-monitor-retry.ts
//
// Receipt for the cert-monitor recheck (Michael Q96 = 1, 2026-11-02). Runs the REAL runCertExpiryCheck with a
// stand-in checker (no network) and a stand-in fetch for Resend (no email leaves the machine; the request body is
// captured so the alert text can be read).
//   1. Both hosts healthy: no recheck, no alert, no email.
//   2. Apex times out, then answers: one recheck, no alert, no email (the 2026-11-02 deploy-day case).
//   3. Apex times out twice: one recheck, one alert, and the email row says it failed twice.
//   4. www expiring in 10 days: alerts on the first read, no recheck and no wait.
//   5. www expired (no error, ok false): alerts on the first read, no recheck.
//   6. www times out, then reads 5 days left: the recheck result is what alerts.
//   7. The checker throws: returns checked 0 and does not throw.
//   8. The scheduler's default wait is 60 s.
// Run (from repo root):
//   node_modules/.bin/tsx scripts/verify-cert-monitor-retry.ts
import { runCertExpiryCheck, RECHECK_DELAY_MS, type CertInfo } from "../server/certMonitor";

let fails = 0;
const ok = (n: string, pass: boolean, d = "") => { console.log(`${pass ? "PASS" : "FAIL"}  ${n}${d ? "  :: " + d : ""}`); if (!pass) fails++; };

const WWW = "www.veritaslabservices.com", APEX = "veritaslabservices.com";
const good = (host: string, daysLeft: number): CertInfo => ({ host, validTo: new Date(Date.now() + daysLeft * 86400000).toISOString(), daysLeft, issuer: "Test CA", ok: daysLeft > 0 });
const timeout = (host: string): CertInfo => ({ host, validTo: null, daysLeft: null, issuer: null, ok: false, error: "timeout" });

// Each host answers from its own queue of readings, in order; calls are counted.
function checker(plan: Record<string, CertInfo[]>) {
  const calls: string[] = [];
  const check = async (host: string) => { calls.push(host); const q = plan[host]; return q.length > 1 ? q.shift()! : q[0]; };
  return { check, calls };
}

// Capture what would be sent to Resend.
const sent: any[] = [];
process.env.RESEND_API_KEY = "re_test_dummy";
(globalThis as any).fetch = async (url: any, init: any) => {
  sent.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
  return new Response(JSON.stringify({ id: "test" }), { status: 200, headers: { "content-type": "application/json" } });
};
const DELAY = 50;

{ // 1
  sent.length = 0;
  const c = checker({ [WWW]: [good(WWW, 48)], [APEX]: [good(APEX, 125)] });
  const r = await runCertExpiryCheck({ check: c.check, recheckDelayMs: DELAY });
  ok("1 healthy: 2 reads, no recheck, no alert, no email", c.calls.length === 2 && r.rechecked.length === 0 && r.alerts.length === 0 && sent.length === 0, JSON.stringify({ calls: c.calls.length, rechecked: r.rechecked, alerts: r.alerts.length, sent: sent.length }));
}
{ // 2
  sent.length = 0;
  const c = checker({ [WWW]: [good(WWW, 48)], [APEX]: [timeout(APEX), good(APEX, 125)] });
  const t0 = Date.now();
  const r = await runCertExpiryCheck({ check: c.check, recheckDelayMs: DELAY });
  ok("2 apex timeout then ok: rechecked apex only, no alert, no email", c.calls.length === 3 && JSON.stringify(r.rechecked) === JSON.stringify([APEX]) && r.alerts.length === 0 && sent.length === 0, JSON.stringify({ calls: c.calls, rechecked: r.rechecked, alerts: r.alerts.length, sent: sent.length }));
  ok("2 waited before the recheck", Date.now() - t0 >= DELAY, `${Date.now() - t0} ms`);
  ok("2 final apex reading is the recheck (125 days)", r.results.find((x) => x.host === APEX)?.daysLeft === 125);
}
{ // 3
  sent.length = 0;
  const c = checker({ [WWW]: [good(WWW, 48)], [APEX]: [timeout(APEX), timeout(APEX)] });
  const r = await runCertExpiryCheck({ check: c.check, recheckDelayMs: DELAY });
  const html = sent[0]?.body?.html || "";
  ok("3 apex timeout twice: one alert for apex, one email", r.alerts.length === 1 && r.alerts[0].host === APEX && sent.length === 1, JSON.stringify({ alerts: r.alerts.map((a) => a.host), sent: sent.length }));
  ok("3 email row says it failed twice", html.includes(`${APEX}</td>`) && html.includes("ERROR: timeout (failed twice, a minute apart)"));
  ok("3 email goes to info@ with the same subject", sent[0]?.body?.to === "info@veritaslabservices.com" && sent[0]?.body?.subject === "[VeritaAssure] TLS certificate expiring or unreachable", JSON.stringify({ to: sent[0]?.body?.to, subject: sent[0]?.body?.subject }));
}
{ // 4
  sent.length = 0;
  const c = checker({ [WWW]: [good(WWW, 10)], [APEX]: [good(APEX, 125)] });
  const t0 = Date.now();
  const r = await runCertExpiryCheck({ check: c.check, recheckDelayMs: 5000 });
  const ms = Date.now() - t0;
  ok("4 www expiring 10 days: alert on first read, no recheck", r.alerts.length === 1 && r.alerts[0].host === WWW && r.rechecked.length === 0 && c.calls.length === 2 && sent.length === 1, JSON.stringify({ alerts: r.alerts.map((a) => a.host), rechecked: r.rechecked, calls: c.calls.length, sent: sent.length }));
  ok("4 no wait for an expiring cert (recheck delay set to 5 s)", ms < 1000, `${ms} ms`);
  ok("4 email row shows days left, no 'failed twice'", (sent[0]?.body?.html || "").includes("10 days left") && !(sent[0]?.body?.html || "").includes("failed twice"));
}
{ // 5
  sent.length = 0;
  const c = checker({ [WWW]: [good(WWW, -1)], [APEX]: [good(APEX, 125)] });
  const r = await runCertExpiryCheck({ check: c.check, recheckDelayMs: DELAY });
  ok("5 www expired: alert on first read, no recheck", r.alerts.length === 1 && r.alerts[0].host === WWW && r.rechecked.length === 0 && c.calls.length === 2 && sent.length === 1);
}
{ // 6
  sent.length = 0;
  const c = checker({ [WWW]: [timeout(WWW), good(WWW, 5)], [APEX]: [good(APEX, 125)] });
  const r = await runCertExpiryCheck({ check: c.check, recheckDelayMs: DELAY });
  ok("6 www timeout then 5 days: alert uses the recheck reading", r.alerts.length === 1 && r.alerts[0].daysLeft === 5 && JSON.stringify(r.rechecked) === JSON.stringify([WWW]) && (sent[0]?.body?.html || "").includes("5 days left"));
}
{ // 7
  sent.length = 0;
  let threw = false, r: any = null;
  try { r = await runCertExpiryCheck({ check: async () => { throw new Error("boom"); }, recheckDelayMs: DELAY }); } catch { threw = true; }
  ok("7 checker throws: no throw, checked 0, no email", !threw && r?.checked === 0 && sent.length === 0);
}
ok("8 default recheck wait is 60 s", RECHECK_DELAY_MS === 60000, String(RECHECK_DELAY_MS));

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
