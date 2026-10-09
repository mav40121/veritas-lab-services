// scripts/verify-api-404.mjs
// Receipt (2026-10-09): an /api address that no route matches returns a JSON 404,
// not the website's HTML with a 200 (Express 5 made req.path relative inside
// app.use("/{*path}"), so the old /api check in server/static.ts never matched).
// Website pages still serve the app shell; a missing file is still a 404.
// Runs against a LOCAL production build. Usage:
//   PW_BASE=http://localhost:5131 node scripts/verify-api-404.mjs
const BASE = process.env.PW_BASE || "http://localhost:5131";
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
async function hit(method, path) {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json" }, body: method === "GET" ? undefined : "{}" });
  const type = r.headers.get("content-type") || "";
  const text = await r.text();
  return { status: r.status, type, text };
}
const cases = [
  ["GET", "/api/health", (r) => r.status === 200 && r.type.includes("json"), "a real API route still answers"],
  ["GET", "/api/does-not-exist", (r) => r.status === 404 && r.type.includes("json") && /Not found/.test(r.text), "unknown API address -> JSON 404"],
  ["POST", "/api/staff-portal-session/qc/results", (r) => r.status === 404 && r.type.includes("json"), "removed staff QC route -> JSON 404"],
  ["GET", "/api/labs/1/qc/period%2Dreviews", (r) => r.status === 404 && r.type.includes("json"), "encoded API address -> JSON 404"],
  ["GET", "/", (r) => r.status === 200 && r.type.includes("html"), "home page still serves"],
  ["GET", "/veritacheck", (r) => r.status === 200 && r.type.includes("html"), "marketing page still serves"],
  ["GET", "/labs/1/dashboard", (r) => r.status === 200 && r.type.includes("html"), "app route still serves the app shell"],
  ["GET", "/no-such-file.png", (r) => r.status === 404, "missing file is still a 404"],
];
for (const [m, p, ok, name] of cases) {
  const r = await hit(m, p);
  check(`${name} (${m} ${p})`, ok(r), `${r.status} ${r.type.split(";")[0]}`);
}
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
