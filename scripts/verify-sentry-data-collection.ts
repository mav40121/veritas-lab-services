// scripts/verify-sentry-data-collection.ts
//
// Sentry 11 (2026-10-26): shared/sentryDataCollection.ts must keep personal information out of error reports. Sends a
// real request that throws through Express with a cookie, custom headers, a JSON body with a name and email, query
// parameters and a forwarded client IP, then inspects the envelope Sentry would send (a stand-in transport keeps it
// local; nothing reaches Sentry). Internal processing metadata is stripped before sending, so only the envelope counts.
//   npx tsx scripts/verify-sentry-data-collection.ts             our settings: expect nothing personal (exit 1 if any)
//   npx tsx scripts/verify-sentry-data-collection.ts --defaults  Sentry's defaults: expect personal data (proves the check bites)
import * as Sentry from "@sentry/node";
import { SENTRY_DATA_COLLECTION, maskTokenInAddress, sentryBreadcrumbFilter, sentryEventFilter } from "../shared/sentryDataCollection";

const DEFAULTS = process.argv.includes("--defaults");
let captured: any = null;
let sent = "";
Sentry.init({
  dsn: "https://public@o0.ingest.us.sentry.io/0",
  environment: "verify",
  tracesSampleRate: 0,
  ...(DEFAULTS ? {} : { dataCollection: SENTRY_DATA_COLLECTION, beforeBreadcrumb: sentryBreadcrumbFilter }),
  beforeSend(event: any) { const kept = DEFAULTS ? event : sentryEventFilter(event); captured = kept; return kept; },
  transport: (options: any) => Sentry.createTransport(options, async (request: any) => {
    sent += typeof request.body === "string" ? request.body : Buffer.from(request.body).toString("utf8");
    return { statusCode: 200 };
  }),
});

const { default: express } = await import("express");
const app = express();
app.use(express.json());
const LOG_MARKER = ["log", "line", "marker"].join("-"); // built at run time, so the source line Sentry quotes as code context does not contain it
app.post("/boom", () => { console.log(`GET /api/labs/1/members 200 in 5ms :: ${LOG_MARKER}`); throw new Error("verify-sentry boom"); });
app.get("/api/surveyor/:token/policies", () => { throw new Error("verify-sentry path boom"); });
Sentry.setupExpressErrorHandler(app);
app.use((_err: any, _req: any, res: any, _next: any) => res.status(500).end());
const server = app.listen(0);
const port = (server.address() as any).port;

const MARKERS = ["Staff Person", "staff.person@example.org", "203.0.113.9", "sid-secret-value", "query-secret", "x-staff-header", LOG_MARKER];
await fetch(`http://127.0.0.1:${port}/boom?email=query-secret`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: "sid=sid-secret-value", "X-Forwarded-For": "203.0.113.9", "X-Staff": "x-staff-header" },
  body: JSON.stringify({ name: "Staff Person", email: "staff.person@example.org" }),
});
for (let i = 0; i < 50 && !captured; i++) await new Promise((r) => setTimeout(r, 100));
await Sentry.flush(3000);
const PATH_MARKER = ["surveyor", "token", "marker"].join("-");
captured = null;
await fetch(`http://127.0.0.1:${port}/api/surveyor/${PATH_MARKER}/policies`);
for (let i = 0; i < 50 && !captured; i++) await new Promise((r) => setTimeout(r, 100));
await Sentry.flush(3000);
server.close();
MARKERS.push(PATH_MARKER);

if (!captured || !sent.includes("verify-sentry boom")) { console.log("FAIL  no Sentry envelope was sent"); process.exit(1); }
const json = sent;
const found = MARKERS.filter((m) => json.includes(m));
const req = captured.request || {};
console.log(`event built: "${captured.exception?.values?.[0]?.value}" | request keys: ${Object.keys(req).join(",") || "(none)"} | user: ${JSON.stringify(captured.user || {})}`);
if (DEFAULTS) {
  console.log(found.includes(LOG_MARKER) ? `PASS  with Sentry's defaults the report carries personal data and console lines (${found.join(", ")}), so this check can detect it` : "FAIL  defaults showed no personal data; the check cannot tell the difference");
  process.exit(found.includes(LOG_MARKER) ? 0 : 1);
}
console.log(found.length ? `FAIL  personal data in the report: ${found.join(", ")}` : "PASS  no cookie, header, body, query value, IP address, console line or token in a path in the report");
const tokenUrls = ["https://x/join?token=abc", "https://x/reset-password?token=abc", "https://x/surveyor/abcdefgh12", "/api/seats/invite/abc", "/api/surveyor/abc/policies", "/api/pdf/abc", "https://x/policy/abcdefgh12", "/api/public/policy-share/abc/file"];
const urlsDropped = tokenUrls.every((url) => sentryBreadcrumbFilter({ category: "navigation", data: { to: url } }) === null);
const plainKept = sentryBreadcrumbFilter({ category: "navigation", data: { to: "https://x/dashboard" } }) !== null;
const MASKS: [string, string][] = [["https://x/policy/abc", "https://x/policy/[REDACTED]"], ["https://x/api/labs/3/veritapolicy/documents/5", "https://x/api/labs/3/veritapolicy/documents/5"],["https://x/api/public/policy-share/abc/file", "https://x/api/public/policy-share/[REDACTED]/file"], ["https://x/join?token=abc&y=1", "https://x/join?token=[REDACTED]&y=1"],["https://x/reset-password?token=abc", "https://x/reset-password?token=[REDACTED]"], ["https://x/surveyor/abc", "https://x/surveyor/[REDACTED]"], ["https://x/api/seats/invite/abc", "https://x/api/seats/invite/[REDACTED]"], ["https://x/api/pdf/abc", "https://x/api/pdf/[REDACTED]"], ["https://x/labs/3/dashboard", "https://x/labs/3/dashboard"]];
const masksOk = MASKS.every(([a, b]) => maskTokenInAddress(a) === b);
console.log(masksOk ? "PASS  a token in a web address is masked, and an ordinary address is untouched" : "FAIL  address masking");
console.log(urlsDropped ? "PASS  a page address carrying a token is dropped" : "FAIL  a page address carrying a token was kept");
console.log(plainKept ? "PASS  an ordinary page address is kept" : "FAIL  an ordinary page address was dropped");
process.exit(found.length || !urlsDropped || !plainKept || !masksOk ? 1 : 0);
