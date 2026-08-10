// Verify the lazy-chunk self-heal retry logic (the /contact stale-chunk fix).
// Run: npx tsx scripts/verify-lazy-chunk-retry.ts
import { loadWithRetry } from "../client/src/lib/lazyChunk";

let fail = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (!cond) fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
}

async function main() {
  // 1. Resolves on first try, no retries.
  let calls = 0;
  const r1 = await loadWithRetry(async () => { calls++; return "ok"; }, 2, 1);
  ok("resolves first try", r1 === "ok" && calls === 1, `calls=${calls}`);

  // 2. Fails twice, then succeeds (the deploy-cutover propagation case).
  calls = 0;
  const r2 = await loadWithRetry(async () => { calls++; if (calls < 3) throw new Error("chunk 404"); return "healed"; }, 2, 1);
  ok("recovers after 2 retries", r2 === "healed" && calls === 3, `calls=${calls}`);

  // 3. Always fails: rejects after exactly retries+1 attempts (bounded, no loop).
  calls = 0;
  let threw = false;
  try { await loadWithRetry(async () => { calls++; throw new Error("gone"); }, 2, 1); }
  catch { threw = true; }
  ok("bounded failure rejects, no loop", threw && calls === 3, `calls=${calls} threw=${threw}`);

  console.log(`\n${fail === 0 ? "ALL PASS" : fail + " FAILED"}`);
  process.exit(fail === 0 ? 0 : 1);
}
main();
