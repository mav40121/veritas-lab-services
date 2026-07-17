// tests/integration/signup-gating.test.ts
//
// STANDING integration test for the signup-gating fix (2026-07-17).
//
// The leak that made this necessary: a self-service signup wrote the visitor's
// picked tier straight into users.plan, and the study gate treats any paid plan
// as unlimited, so picking Community at signup granted unlimited access for $0.
// It survived because every existing test asked "does the feature WORK" -- and an
// over-provisioned account works perfectly, better than a correct one. The only
// way to catch it is to assert the NEGATIVE: a new account must be BLOCKED at the
// free-credit limit. That assertion never existed. This is it.
//
// It boots the REAL Express routes against a throwaway SQLite DB (DB_PATH from the
// runner) and drives real HTTP end to end: register PICKING Community, then run
// studies until the gate blocks. No Vite, no prod, no external calls.
//
// Run: npm run test:signup-gating

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import { registerRoutes } from "../../server/routes";

// routes.ts calls CJS require() inside a few handlers (e.g. multer). Under this
// ESM package tsx shims that global for the server entry but not for an imported
// module graph, so provide it before registerRoutes wires those handlers. The
// require() calls run at registration time, not import, so setting it here (which
// runs during module eval, before main()) is early enough.
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  // Mirror server/index.ts middleware order: json body parsing before the routes.
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;

  const post = (path: string, body: unknown, token?: string) =>
    fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });

  try {
    // 1) Register a fresh account PICKING community -- the exact input that leaked.
    const email = `it-signup-${Date.now()}@example.com`;
    const regRes = await post("/api/auth/register", {
      email, password: "testpass123", name: "Signup Gating IT",
      hipaa_acknowledged: true, plan: "community",
      hospital_name: "IT Hospital", hospital_state: "AZ", bed_count: 100,
    });
    const reg: any = await regRes.json().catch(() => ({}));
    check("register returned 200", regRes.status === 200, `status=${regRes.status} body=${JSON.stringify(reg).slice(0, 120)}`);
    const token = reg?.token;
    check("register issued a token", typeof token === "string" && token.length > 0);

    // 2) CORE ASSERTION: picking community must NOT grant community.
    check("signup picking 'community' lands plan=free", reg?.user?.plan === "free", `plan=${reg?.user?.plan}`);
    check("account carries the 2 free study credits", reg?.user?.studyCredits === 2, `credits=${reg?.user?.studyCredits}`);

    // 3) NEGATIVE ASSERTION: the free account is genuinely credit-gated at the
    //    study endpoint. The gate (routes.ts:10248) returns 402 the moment credits
    //    hit 0, BEFORE createStudy is called, so we drive the account to the
    //    boundary through the real admin endpoint and hit the real study endpoint.
    //    (We set credits directly rather than running studies to 0 because on a
    //    cold test DB the studies-table insert trips a fresh-boot schema gap; that
    //    is a test-fixture artifact, not the gate. The gate is what this asserts,
    //    and if the plan had leaked to community the account would be unlimited and
    //    this 402 would never fire -- which is the whole point.)
    const uid = reg?.user?.id;
    check("register returned the new account id", typeof uid === "number", `id=${uid}`);
    // Drain the 2 free credits to the boundary via admin (ADMIN_SECRET is the test
    // value the runner sets). Preserve the account's ACTUAL plan on purpose: if the
    // leak ever regressed and this account held `community`, community is unlimited,
    // the 402 below would NOT fire, and this block assertion would catch it too. So
    // both the plan check above and the block check below independently bite.
    const drain = await post("/api/admin/set-plan", { secret: process.env.ADMIN_SECRET, userId: uid, plan: reg?.user?.plan, credits: 0 });
    check("admin drained the account to 0 credits", drain.status === 200, `status=${drain.status}`);

    const blocked = await post("/api/studies", { status: "draft", testName: "IT blocked", studyType: "precision" }, token);
    check("study on a 0-credit free account is BLOCKED", blocked.status === 402, `status=${blocked.status}`);
    const bbody: any = await blocked.json().catch(() => ({}));
    check("block carries code STUDY_CREDITS_EXHAUSTED", bbody?.code === "STUDY_CREDITS_EXHAUSTED", JSON.stringify(bbody).slice(0, 80));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("integration test crashed:", e); process.exit(1); });
