// tests/integration/veritascan-autocomplete-lab.test.ts
//
// Receipt for BUG-074 (2026-10-27): VeritaCheck's auto-completion of VeritaScan items matched scans by the owner's
// account, so a multi-lab owner's study completed items in every one of their labs' scans, and it overwrote the lab's
// own answer (Needs Attention, N/A) with Compliant.
//   1. a study in lab A completes items in lab A's scan only; lab B's scan (same owner) is untouched
//   2. an item the lab marked Needs Attention keeps it (no overwrite); an N/A keeps it too
//   3. an earlier auto-completion is still refreshed by a newer study
//   4. a legacy study with no lab falls back to the owner's scans (unchanged behavior for old rows)
//
// Runs the real helper on a throwaway DB (made-up rows only). Run: npm run test:veritascan-autocomplete-lab
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  const { db } = await import("../../server/db");
  const { autoCompleteVeritaScanItems } = await import("../../server/integrations");
  const sqlite = (db as any).$client;
  const now = new Date().toISOString();
  const userId = Number(sqlite.prepare("INSERT INTO users (email, password_hash, name, plan, study_credits, created_at) VALUES (?, 'x', 'Scan Owner', 'hospital', 0, ?)").run(`scan-${Date.now()}@example.com`, now).lastInsertRowid);
  const labA = Number(sqlite.prepare("INSERT INTO labs (lab_name, owner_user_id, plan, created_at, updated_at) VALUES ('Scan Lab A', ?, 'hospital', ?, ?)").run(userId, now, now).lastInsertRowid);
  const labB = Number(sqlite.prepare("INSERT INTO labs (lab_name, owner_user_id, plan, created_at, updated_at) VALUES ('Scan Lab B', ?, 'hospital', ?, ?)").run(userId, now, now).lastInsertRowid);
  const mkScan = (labId: number | null, name: string) => Number(sqlite.prepare("INSERT INTO veritascan_scans (user_id, lab_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(userId, labId, name, now, now).lastInsertRowid);
  const scanA = mkScan(labA, "Lab A scan"), scanB = mkScan(labB, "Lab B scan");
  const items = (scanId: number) => sqlite.prepare("SELECT item_id, status, completion_source FROM veritascan_items WHERE scan_id = ? ORDER BY item_id").all(scanId) as any[];

  // 1. lab A study
  autoCompleteVeritaScanItems({ id: 9001, userId, labId: labA, testName: "Sodium", studyType: "cal_ver" });
  const a1 = items(scanA), b1 = items(scanB);
  check("1. a lab A study completes lab A's scan items only", a1.length > 0 && a1.every((r) => r.status === "Compliant" && r.completion_source === "veritacheck_auto") && b1.length === 0, `A=${a1.length} B=${b1.length}`);

  // 2. manual answers are kept
  const [first, second] = a1;
  sqlite.prepare("UPDATE veritascan_items SET status = 'Needs Attention', completion_source = NULL WHERE scan_id = ? AND item_id = ?").run(scanA, first.item_id);
  if (second) sqlite.prepare("UPDATE veritascan_items SET status = 'N/A', completion_source = NULL WHERE scan_id = ? AND item_id = ?").run(scanA, second.item_id);
  autoCompleteVeritaScanItems({ id: 9002, userId, labId: labA, testName: "Sodium", studyType: "cal_ver" });
  const st = (id: number) => (sqlite.prepare("SELECT status FROM veritascan_items WHERE scan_id = ? AND item_id = ?").get(scanA, id) as any)?.status;
  check("2. the lab's own Needs Attention and N/A are not overwritten", st(first.item_id) === "Needs Attention" && (!second || st(second.item_id) === "N/A"), `${st(first.item_id)} / ${second ? st(second.item_id) : "-"}`);

  // 3. auto rows refresh
  const third = a1[2] ?? a1[a1.length - 1];
  const before = (sqlite.prepare("SELECT completion_link FROM veritascan_items WHERE scan_id = ? AND item_id = ?").get(scanA, third.item_id) as any)?.completion_link;
  check("3. an earlier auto-completion is refreshed by the newer study", a1.length < 3 || (before === "/study/9002/results"), String(before));

  // 4. legacy fallback
  const legacy = mkScan(null, "Legacy scan (no lab)");
  autoCompleteVeritaScanItems({ id: 9003, userId, labId: null, testName: "Sodium", studyType: "cal_ver" });
  check("4. a study with no lab falls back to the owner's scans", items(legacy).length > 0, `legacy=${items(legacy).length}`);

  console.log(failures ? `${failures} FAIL` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
