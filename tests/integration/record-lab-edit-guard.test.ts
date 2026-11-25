// tests/integration/record-lab-edit-guard.test.ts
//
// A by-id change behind requireModuleEdit must decide in the record's own laboratory (BUG-196, server/labAccessGuard.ts
// editRefusedInRecordLab). Reads Express's own routes, so a new one can't be missed, and fails when a route with an id and no
// laboratory in its path
//   1. doesn't find its record through a helper that asks (HELPERS), and isn't on ALLOWED with a reason
//   2. isn't driven by record-lab-edit.test.ts (recordLabRoutes.ts) and isn't on DRIVEN_ELSEWHERE with a reason
// and when a helper stops asking (3). Section 4 shows the check bites. Run: npm run test:record-lab-edit
import http from "node:http";
import fs from "node:fs";
import express from "express";
import { createRequire } from "node:module";
import { recordRoutes } from "./recordLabRoutes";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

// Where each helper is written; every one asks editRefusedInRecordLab, or calls one that does.
const HELPERS: Record<string, string> = {
  userCanAccessMap: "routes.ts", userCanAccessFinding: "routes.ts", userCanAccessScan: "routes.ts", userCanAccessPolicy: "routes.ts",
  userCanAccessStudy: "routes.ts", userCanAccessLabRow: "routes.ts", userCanAccessCertificate: "routes.ts", assessmentInReach: "routes.ts",
  activeStaffLab: "routes.ts", resolveInventoryItemForMutation: "veritabench.ts", resolveRowForMutation: "labAccessGuard.ts", ownerRowInReach: "labAccessGuard.ts",
};
const ASKS = /editRefusedInRecordLab\(|ownerRowInReach\([^;]*,\s*req\)/;
const USES = new RegExp(`\\b(${Object.keys(HELPERS).filter((h) => h !== "ownerRowInReach").join("|")})\\b[^(]{0,8}\\(`);

const ALLOWED: Array<[RegExp, string]> = [
  [/^(POST \/api\/veritamap\/correlations\/group\/:id\/signoff|DELETE \/api\/veritamap\/correlations\/:id)$/, "both tests must be in the laboratory the request is judged in (authorizeCorrelationPair)"],
  [/ \/api\/pi\//, "VeritaQA's indicators carry no laboratory here; they move to their laboratory with their own routes"],
];
const DRIVEN_ELSEWHERE: Array<[RegExp, string]> = [
  ...ALLOWED,
  [/ \/api\/(pt|veritapt)\//, "tests/integration/pt-events.test.ts"],
  [/ \/api\/staff\/(employees|competency)\//, "record-lab-edit section 4: the account's roster"],
  [/ \/api\/veritapolicy\/(requirements|master-list)\//, "record-lab-edit section 4: kept per laboratory"],
  [/ \/api\/veritapolicy\/policies\/:id\/upload$/, "record-lab-edit section 4: answers after finding its policy"],
];

interface Found { key: string; matches: RegExp; after: string[] }
/** Every change with an id, no laboratory in its path, and a module edit check. `after` is the source of what runs after the check. */
function byIdEdits(stack: any[]): Found[] {
  const out: Found[] = [];
  for (const layer of stack) {
    if (!layer.route || typeof layer.route.path !== "string") continue;
    const path: string = layer.route.path;
    if (!/:\w+/.test(path) || path.includes(":labId")) continue;
    const src: string[] = layer.route.stack.map((s: any) => String(s.handle));
    const gate = src.findIndex((s) => s.includes("moduleEditChecked"));
    if (gate < 0) continue;
    for (const m of Object.keys(layer.route.methods).filter((x) => !["get", "head", "options"].includes(x))) out.push({ key: `${m.toUpperCase()} ${path}`, matches: new RegExp(`^${path.replace(/:[A-Za-z]+/g, "[^/]+")}$`), after: src.slice(gate + 1) });
  }
  return out;
}
const asks = (f: Found) => f.after.some((s) => USES.test(s) || ASKS.test(s));
const on = (list: Array<[RegExp, string]>, f: Found) => list.some(([re]) => re.test(f.key));

/** A function's own text, from its declaration to the brace that closes it. */
function bodyOf(source: string, name: string): string {
  const at = source.search(new RegExp(`function ${name}\\b`));
  if (at < 0) return "";
  const open = source.indexOf("{\n", at);
  for (let i = open, depth = 0; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(open, i + 1);
  }
  return "";
}

async function main() {
  const { registerRoutes } = await import("../../server/routes");
  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
  const found = byIdEdits((app as any)._router?.stack ?? (app as any).router?.stack ?? []);
  check("0. Express's routes were read", found.length > 60, String(found.length));

  const missing = found.filter((f) => !asks(f) && !on(ALLOWED, f)).map((f) => f.key);
  check("1. every by-id change finds its record through a helper that asks about the record's own laboratory, or is allowed with a reason", missing.length === 0, missing.join("; "));

  let n = 0;
  const driven = recordRoutes({ seed: () => ++n, one: () => ({ id: 1, n: 0 }), now: "", stamp: 0 }).map((r) => ({ method: r.method, path: r.make(1, 1).path }));
  const undriven = found.filter((f) => !on(DRIVEN_ELSEWHERE, f) && !driven.some((d) => f.key.startsWith(`${d.method} `) && f.matches.test(d.path))).map((f) => f.key);
  check("2. every one is driven by record-lab-edit.test.ts, or somewhere else with a reason", undriven.length === 0, undriven.join("; "));
  check("2b. each reason is written down", [...ALLOWED, ...DRIVEN_ELSEWHERE].every(([, why]) => why.length > 10));

  for (const [name, file] of Object.entries(HELPERS)) {
    const body = bodyOf(fs.readFileSync(new URL(`../../server/${file}`, import.meta.url), "utf8").replace(/\r\n/g, "\n"), name);
    check(`3. ${name} asks`, ASKS.test(body), body ? "no longer asks" : "not found");
  }

  // 4. The check bites
  const fake = express();
  const gate = (req: any, _res: any, next: any) => { req.moduleEditChecked = "veritamap"; next(); };
  const userCanAccessMap = (_id: any, _req: any): any => null;
  fake.put("/api/made-up/:id", gate, (req: any, res: any) => { res.json({ id: req.params.id }); });
  fake.put("/api/made-up-asks/:id", gate, (req: any, res: any) => { res.json(userCanAccessMap(req.params.id, req)); });
  fake.get("/api/made-up/:id", gate, (_req: any, res: any) => { res.json({}); });
  fake.put("/api/labs/:labId/made-up/:id", gate, (_req: any, res: any) => { res.json({}); });
  fake.put("/api/made-up-own-rule/:id", (_req: any, res: any) => { res.json({}); });
  const f = byIdEdits((fake as any)._router?.stack ?? (fake as any).router?.stack);
  check("4. a made-up route that doesn't ask is caught, and one that does isn't", f.map((x) => x.key).join() === "PUT /api/made-up/:id,PUT /api/made-up-asks/:id" && f.filter((x) => !asks(x)).map((x) => x.key).join() === "PUT /api/made-up/:id", f.map((x) => `${x.key} ${asks(x)}`).join());

  console.log(failures ? `\n${failures} FAILED` : `\nALL PASS (${found.length} routes)`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
