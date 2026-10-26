// scripts/verify-sentry-data-collection.ts
//
// Sentry 11 (2026-10-26): shared/sentryDataCollection.ts must keep personal information out of error reports. Sends a
// real request that throws through Express with a cookie, custom headers, a JSON body with a name and email, query
// parameters and a forwarded client IP, then inspects the envelope Sentry would send (a stand-in transport keeps it
// local; nothing reaches Sentry). Internal processing metadata is stripped before sending, so only the envelope counts.
//   npx tsx scripts/verify-sentry-data-collection.ts             our settings: expect nothing personal (exit 1 if any)
//   npx tsx scripts/verify-sentry-data-collection.ts --defaults  Sentry's defaults: expect personal data (proves the check bites)
import * as Sentry from "@sentry/node";
import { SENTRY_DATA_COLLECTION } from "../shared/sentryDataCollection";

const DEFAULTS = process.argv.includes("--defaults");
let captured: any = null;
let sent = "";
Sentry.init({
  dsn: "https://public@o0.ingest.us.sentry.io/0",
  environment: "verify",
  tracesSampleRate: 0,
  ...(DEFAULTS ? {} : { dataCollection: SENTRY_DATA_COLLECTION }),
  beforeSend(event) { captured = event; return event; },
  transport: (options: any) => Sentry.createTransport(options, async (request: any) => {
    sent += typeof request.body === "string" ? request.body : Buffer.from(request.body).toString("utf8");
    return { statusCode: 200 };
  }),
});

const { default: express } = await import("express");
const app = express();
app.use(express.json());
app.post("/boom", () => { throw new Error("verify-sentry boom"); });
Sentry.setupExpressErrorHandler(app);
app.use((_err: any, _req: any, res: any, _next: any) => res.status(500).end());
const server = app.listen(0);
const port = (server.address() as any).port;

const MARKERS = ["Staff Person", "staff.person@example.org", "203.0.113.9", "sid-secret-value", "query-secret", "x-staff-header"];
await fetch(`http://127.0.0.1:${port}/boom?email=query-secret`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: "sid=sid-secret-value", "X-Forwarded-For": "203.0.113.9", "X-Staff": "x-staff-header" },
  body: JSON.stringify({ name: "Staff Person", email: "staff.person@example.org" }),
});
for (let i = 0; i < 50 && !captured; i++) await new Promise((r) => setTimeout(r, 100));
await Sentry.flush(3000);
server.close();

if (!captured || !sent.includes("verify-sentry boom")) { console.log("FAIL  no Sentry envelope was sent"); process.exit(1); }
const json = sent;
const found = MARKERS.filter((m) => json.includes(m));
const req = captured.request || {};
console.log(`event built: "${captured.exception?.values?.[0]?.value}" | request keys: ${Object.keys(req).join(",") || "(none)"} | user: ${JSON.stringify(captured.user || {})}`);
if (DEFAULTS) {
  console.log(found.length ? `PASS  with Sentry's defaults the report carries personal data (${found.join(", ")}), so this check can detect it` : "FAIL  defaults showed no personal data; the check cannot tell the difference");
  process.exit(found.length ? 0 : 1);
}
console.log(found.length ? `FAIL  personal data in the report: ${found.join(", ")}` : "PASS  no cookie, header, body, query value or IP address in the report");
process.exit(found.length ? 1 : 0);
