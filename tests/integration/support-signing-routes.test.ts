// tests/integration/support-signing-routes.test.ts
//
// Veritas support sets a lab up and never signs for it (server/vlsSupport.ts). Boots the REAL routes on a scratch DB and proves:
//   1. every lab-scoped route that signs, approves, attests, co-signs, certifies or takes a sign-off back is on the refused list,
//      read from the routes Express actually has, so one added later and not named there fails here
//   2. a support login is refused on the per-method competency sign-off and its unlock, a recall's sign-off and close, and the monthly
//      maintenance review, with the support wording
//   3. the lab's own owner is not refused by that list on any of them, and support still sets the lab up
// Run: npm run test:support-signing-routes
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

// Paths that end like a signature and aren't one. Each says why.
const NOT_A_SIGNATURE: Record<string, string> = {
  "POST /api/labs/:labId/veritastock/transfers/:batchId/reject": "a stock transfer sent back to the sending location",
};

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const { VLS_SUPPORT_REFUSED_ROUTES } = await import("../../server/vlsSupport");
  const ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";
  const app = express(); app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app); await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address(); const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const call = async (method: string, path: string, body?: unknown, token?: string, lab?: number) => {
    const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(lab ? { "X-Active-Lab-Id": String(lab) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let j: any = {}; try { j = JSON.parse(text); } catch { /* not JSON */ }
    return { s: r.status, j, text };
  };

  // 1. The list against the routes there are
  const refused = new Set(VLS_SUPPORT_REFUSED_ROUTES.map((r) => r.replace(" (when signing)", "")));
  const SIGNS = /\/(sign|signoff|sign-off|finalize|cosign|md-cosign|attest|attest-ref|approve|reject|recertify|mec-review|certify|period-reviews|maintain-reviews)$/;
  const TAKES_BACK = /\/(signoffs|signatures|attestations)\/[^/]+\/(revoke|unlock|void)$|\/unlock(-ref)?$/;
  const stack: any[] = (app as any)._router?.stack ?? (app as any).router?.stack ?? [];
  const routes: string[] = [];
  for (const layer of stack) if (layer.route) for (const m of Object.keys(layer.route.methods)) if (m !== "get") routes.push(`${m.toUpperCase()} ${layer.route.path}`);
  const signing = [...new Set(routes.filter((r) => r.includes("/api/labs/:labId/") && (SIGNS.test(r) || TAKES_BACK.test(r))))];
  const missing = signing.filter((r) => !refused.has(r) && !NOT_A_SIGNATURE[r]);
  check("1. the routes were read from Express", routes.length > 500 && signing.length > 15, `${routes.length} writes, ${signing.length} that sign`);
  check("1. every one that signs, or takes a sign-off back, is refused to Veritas support", missing.length === 0, missing.join(" | "));
  check("1. nothing on the exception list has gone", Object.keys(NOT_A_SIGNATURE).every((r) => routes.includes(r)));

  // 2 and 3. The same thing asked for real
  const stamp = Date.now();
  const pw = ["Test", "pass", "123"].join("");
  const reg = async (tag: string) => (await call("POST", "/api/auth/register", { email: `ssr-${tag}-${stamp}@example.test`, password: pw, name: `SSR ${tag}`, hipaa_acknowledged: true })).j;
  const owner = await reg("owner"), support = await reg("support");
  const labId = Number((await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: `ssr-owner-${stamp}@example.test`, labName: "Client Lab", plan: "hospital" })).j.labId);
  const flag = await call("POST", "/api/admin/vls-support/user", { secret: ADMIN, email: `ssr-support-${stamp}@example.test`, enabled: true });
  check("2. a client lab and a support login", !!labId && flag.s === 200);
  const L = `/api/labs/${labId}`;
  const asked: [string, string, any][] = [
    ["sign a method's competency", `${L}/competency/employee/1/test-system/1/sign`, { signerIsMedicalDirector: true }],
    ["unlock a method's competency", `${L}/competency/employee/1/test-system/1/signoffs/1/revoke`, {}],
    ["sign off a recall", `${L}/veritastock/recalls/1/signoff`, {}],
    ["close a recall", `${L}/veritastock/recalls/1/close`, {}],
    ["sign the monthly maintenance review", `${L}/maintain-reviews`, { month: "2026-10", items: [{ type: "equipment", id: 1 }], typed_signature: "SSR support", password: pw }],
  ];
  for (const [what, path, body] of asked) {
    const s = await call("POST", path, body, support.token, labId);
    const o = await call("POST", path, body, owner.token, labId);
    check(`2. support can't ${what}`, s.s === 403 && /veritas/i.test(String(s.j?.error || "")), `${s.s} ${String(s.j?.error || "").slice(0, 90)}`);
    check(`3. the owner is not refused by that list to ${what}`, !/veritas support|veritas user/i.test(String(o.j?.error || "")), `${o.s} ${String(o.j?.error || "").slice(0, 90)}`);
  }
  const lot = await call("POST", `${L}/qc/control-lots`, { analyte: "Glucose", level: "Level 1", lot_number: `SSR-${stamp}`, mfr_mean: 100, mfr_sd: 2 }, support.token, labId);
  check("3. support still sets the lab up", lot.s === 200 || lot.s === 201, String(lot.s));
  void db;

  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
