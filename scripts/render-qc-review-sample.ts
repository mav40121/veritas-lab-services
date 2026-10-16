// Render the VeritaQC monthly review HTML for a signed sample month to a PNG (visual check for BUG-066).
// Run: DB_PATH=<scratch db> OUT=<dir> npx tsx scripts/render-qc-review-sample.ts
import { createRequire } from "node:module";
import { db } from "../server/db";
import { buildMonthlyReviewPayload } from "../server/qcMonthlyReviewPayload";
import { buildMonthlyReviewHTML } from "../server/pdfQCMonthly";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const sqlite = (db as any).$client;
const now = new Date().toISOString();
sqlite.prepare("INSERT INTO users (email, password_hash, name, created_at) VALUES (?, 'x', 'Dana Director', ?)").run(`dana-${Date.now()}@example.com`, now);
const dana = Number(sqlite.prepare("SELECT MAX(id) id FROM users").get().id);
sqlite.prepare("INSERT INTO labs (lab_name, clia_number, owner_user_id, created_at) VALUES ('Riverside Regional Medical Center (QA)', '22D0999999', ?, ?)").run(dana, now);
const L = Number(sqlite.prepare("SELECT MAX(id) id FROM labs").get().id);
const lotId = Number(sqlite.prepare("INSERT INTO qc_control_lots (lab_id, analyte, level, lot_number, mfr_mean, mfr_sd, status) VALUES (?, 'Glucose', 'L1', 'G-123', 100, 3, 'active')").run(L).lastInsertRowid);
for (const [d, v] of [["2026-08-03", 99.5], ["2026-08-10", 101.2], ["2026-08-17", 98.9], ["2026-08-24", 100.8]] as const)
  sqlite.prepare("INSERT INTO qc_results (lab_id, control_lot_id, result_value, result_date, accepted_for_reporting) VALUES (?, ?, ?, ?, 1)").run(L, lotId, v, d);
sqlite.prepare("INSERT INTO qc_period_reviews (lab_id, control_lot_id, period_month, period_year, reviewed_by_user_id, reviewed_at, attestation_acknowledged) VALUES (?, ?, 8, 2026, ?, '2026-09-02 14:05:00', 1)").run(L, lotId, dana);
const lot = sqlite.prepare("SELECT * FROM qc_control_lots WHERE id = ?").get(lotId);
const lab = sqlite.prepare("SELECT id, lab_name, clia_number FROM labs WHERE id = ?").get(L);
const html = buildMonthlyReviewHTML(buildMonthlyReviewPayload(sqlite, L, lot, lab, 2026, 8));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });
await page.setContent(html, { waitUntil: "load" });
await page.screenshot({ path: `${process.env.OUT}/qc-review-signed-sample.png`, fullPage: true });
await browser.close();
console.log("rendered", `${process.env.OUT}/qc-review-signed-sample.png`);
