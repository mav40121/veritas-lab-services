// server/continuousBackup.ts
//
// Continuous backup (Litestream), 2026-10-16. The hourly and nightly copies (server/backup.ts) bound data loss to one
// hour. Litestream streams every committed change to Cloudflare R2 about once a second and can restore the database
// to any point in its retention window (72 hours here; the hourly and nightly copies keep the longer history).
//
// Litestream runs as a child process of the app, so a Litestream problem never stops the app: it is restarted with a
// back-off, and its state is on GET /api/admin/continuous-backup. It is on in production (or with
// CONTINUOUS_BACKUP=1) when the R2 settings exist and the litestream binary is installed (Dockerfile);
// CONTINUOUS_BACKUP=0 turns it off. Litestream needs SQLite's WAL journal mode, so the app switches to WAL before
// Litestream starts. Credentials never touch disk: the config file names them as ${VAR} and Litestream expands them.
//
// Each Railway service replicates to its own folder (backupScope, BUG-082): two writers on one replica path can make
// it unrestorable.
//
// Recovery from broken local state (BUG-111, 2026-10-27): after the 03:07 UTC restart Litestream logged "LTX file is
// missing" every few minutes and shipped nothing to R2. Litestream's remedy is `litestream reset`, which deletes only
// its tracking files (the .db-litestream folder), never the database, and makes a fresh snapshot on the next sync. Two
// layers apply it: the replica's auto-recover setting (Litestream 0.5.7+), and this supervisor, which stops
// Litestream, runs the reset and starts it again when the same error repeats (at most once per 30 minutes, so a reset
// that does not help cannot loop). Point-in-time restore to before a reset is lost; the hourly and nightly copies
// (server/backup.ts) keep that history.
//
// Generations (BUG-111 part 2, 2026-10-27 04:40 UTC): a reset starts Litestream's transaction ids again at 1, but the
// replica folder still held the old snapshot at transaction 0xc212, so every restore read that old snapshot (the
// production restore test stayed FAIL after the auto-recover at 04:23). So every reset now also moves replication to a
// new, empty folder: litestream/g<N>/veritas.db, N kept in <db>.litestream-generation beside the database on the volume.
// Generation 1 is the original litestream/veritas.db. GENERATION_FLOOR = 2 moves production off the folder that holds
// the stale snapshot on the first boot of this code (with a reset first, so the new folder starts from a clean state).
// Old generation folders are never deleted by this code; removing one is a manual decision.

import { spawn, execFileSync, execFile, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { backupScope, countCore } from "./backup";

const R2_KEYS = ["BACKUP_S3_ENDPOINT", "BACKUP_S3_BUCKET", "BACKUP_S3_ACCESS_KEY_ID", "BACKUP_S3_SECRET_ACCESS_KEY"];
const LOG_LINES = 60;

export function continuousBackupPlan(env: NodeJS.ProcessEnv = process.env): { enabled: boolean; reason: string } {
  const flag = String(env.CONTINUOUS_BACKUP ?? "").trim();
  if (flag === "0") return { enabled: false, reason: "turned off (CONTINUOUS_BACKUP=0)" };
  if (env.NODE_ENV !== "production" && flag !== "1") return { enabled: false, reason: "not production" };
  if (String(env.LITESTREAM_FILE_REPLICA ?? "").trim()) return { enabled: true, reason: "on (local folder replica)" };
  const missing = R2_KEYS.filter((k) => !String(env[k] ?? "").trim());
  if (missing.length) return { enabled: false, reason: `R2 settings missing: ${missing.join(", ")}` };
  return { enabled: true, reason: "on" };
}

// The replica folder: the main app writes litestream/veritas.db; any other Railway service writes under its own scope.
// Generation 2 and later write litestream/g<N>/veritas.db (see the Generations note above).
export function continuousBackupReplicaPath(env: NodeJS.ProcessEnv = process.env, generation = 1): string {
  return generation > 1 ? `${backupScope(env)}litestream/g${generation}/veritas.db` : `${backupScope(env)}litestream/veritas.db`;
}

export const GENERATION_FLOOR = 2;
export function generationFilePath(dbPath: string): string {
  return `${dbPath}.litestream-generation`;
}
function readGeneration(dbPath: string): number {
  try { const n = parseInt(fs.readFileSync(generationFilePath(dbPath), "utf8").trim(), 10); return Number.isInteger(n) && n > 0 ? n : 0; } catch { return 0; }
}
function writeGeneration(dbPath: string, n: number) {
  fs.writeFileSync(generationFilePath(dbPath), `${n}\n`);
}

// fileReplicaDir (tests only, LITESTREAM_FILE_REPLICA): replicate to a local folder instead of R2, so CI can run the
// real Litestream round trip on Linux without R2 credentials.
// snapshotInterval: tests only (LITESTREAM_SNAPSHOT_INTERVAL with a folder replica), so a short test can take the level-9
// snapshot that, in production, sat above a reset chain (BUG-111). Production always uses 6h.
export function litestreamConfig(dbPath: string, replicaPath: string, fileReplicaDir?: string, snapshotInterval = "6h"): string {
  const replica = fileReplicaDir
    ? ["    replica:", "      type: file", `      path: ${JSON.stringify(path.join(fileReplicaDir, replicaPath))}`, "      auto-recover: true"]
    : [
      "    replica:",
      "      type: s3",
      // BUG-111: on an LTX replication error Litestream resets its own tracking state and takes a fresh snapshot.
      "      auto-recover: true",
      "      bucket: ${BACKUP_S3_BUCKET}",
      `      path: ${replicaPath}`,
      "      endpoint: ${BACKUP_S3_ENDPOINT}",
      "      region: auto",
      "      access-key-id: ${BACKUP_S3_ACCESS_KEY_ID}",
      "      secret-access-key: ${BACKUP_S3_SECRET_ACCESS_KEY}",
    ];
  return [
    "# Written by server/continuousBackup.ts at startup. Credentials are ${VAR} references that Litestream expands.",
    "logging:",
    "  level: warn",
    "snapshot:",
    `  interval: ${snapshotInterval}`,
    "  retention: 72h",
    "dbs:",
    `  - path: ${JSON.stringify(dbPath)}`,
    // Emergency WAL limit ~50 MB (default ~500 MB is the size of the whole Railway volume).
    "    truncate-page-n: 12500",
    ...replica,
    "",
  ].join("\n");
}

interface State {
  enabled: boolean;
  reason: string;
  bin: string;
  version: string | null;
  configPath: string | null;
  dbPath: string | null;
  replicaPath: string | null;
  running: boolean;
  pid: number | null;
  startedAt: string | null;
  restarts: number;
  lastExit: { at: string; code: number | null; signal: string | null } | null;
  // BUG-111: resets of Litestream's local tracking state made by this supervisor.
  resets: number;
  lastReset: { at: string; ok: boolean; trigger: string; out: string } | null;
  // BUG-111 part 2: the replica generation in use (folder litestream/g<N>/veritas.db from 2 on).
  generation: number;
  log: string[];
}

const state: State = {
  enabled: false, reason: "not started", bin: "", version: null, configPath: null, dbPath: null, replicaPath: null,
  running: false, pid: null, startedAt: null, restarts: 0, lastExit: null, resets: 0, lastReset: null, generation: 0, log: [],
};
let fileReplicaDir: string | undefined;
let snapshotInterval = "6h";
let child: ChildProcess | null = null;
let stopping = false;
let quickFailures = 0;

// BUG-111: the messages Litestream gives when its local tracking state is broken and a reset is the remedy (its own
// hint on the first one is "Run 'litestream reset <db>'"; the others are the ones its reset documentation lists).
export const RESET_HINT = /LTX file is missing|non-contiguous transaction files|nonsequential page numbers|cannot close, expected page/i;
// Litestream's own auto-recover has reset the local state: the folder in use now holds transaction ids above the new ones.
export const AUTO_RECOVERED = /auto-recovery enabled, resetting local state/i;
const RESET_AFTER = 2; // the same error twice in one run
const RESET_MIN_GAP_MS = 30 * 60 * 1000;
let hintsThisRun = 0;
let resetting = false;
let resetTrigger = "";
let lastResetMs = 0;

function maybeReset(line: string, now = false) {
  hintsThisRun += 1;
  if (resetting || stopping || !child || (!now && hintsThisRun < RESET_AFTER)) return;
  if (lastResetMs && Date.now() - lastResetMs < RESET_MIN_GAP_MS) return;
  resetting = true;
  lastResetMs = Date.now();
  resetTrigger = line.slice(0, 200);
  note("local replication state was reset or is broken; stopping Litestream to reset it and move to a new replica generation (tracking files only, the database is not touched)");
  try { child.kill("SIGTERM"); } catch { /* exit handler runs the reset either way */ }
}

// Tests only: forget when the last reset happened, so each test case starts with the reset allowed.
export function _clearResetClockForTests() {
  lastResetMs = 0;
  resetting = false;
}

// Points the config at generation n (and records it), so the next Litestream run writes a new, empty folder.
function useGeneration(n: number, env: NodeJS.ProcessEnv = process.env) {
  state.generation = n;
  writeGeneration(state.dbPath!, n);
  state.replicaPath = continuousBackupReplicaPath(env, n);
  fs.writeFileSync(state.configPath!, litestreamConfig(state.dbPath!, state.replicaPath, fileReplicaDir, snapshotInterval));
}

async function resetAndRelaunch() {
  useGeneration(state.generation + 1);
  const r = await run(state.bin, ["reset", "-config", state.configPath!, state.dbPath!], 120000);
  state.resets += 1;
  state.lastReset = { at: new Date().toISOString(), ok: r.ok, trigger: resetTrigger, out: r.out.slice(0, 300) };
  note(`litestream reset ${r.ok ? "done" : "FAILED"}${r.out ? `: ${r.out.slice(0, 300)}` : ""}; now replicating to generation ${state.generation} (${state.replicaPath})`);
  resetting = false;
  if (!stopping) launch();
}

function note(line: string) {
  const stamped = `${new Date().toISOString()} ${line}`;
  state.log.push(stamped);
  if (state.log.length > LOG_LINES) state.log.splice(0, state.log.length - LOG_LINES);
  console.log(`[litestream] ${line}`);
}

function launch() {
  if (stopping || !state.configPath) return;
  const startedMs = Date.now();
  let p: ChildProcess;
  try {
    p = spawn(state.bin, ["replicate", "-config", state.configPath], { env: process.env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  } catch (err: any) {
    note(`could not start: ${err?.message || err}`);
    return scheduleRestart(startedMs);
  }
  child = p;
  state.running = true;
  state.pid = p.pid ?? null;
  state.startedAt = new Date().toISOString();
  note(`replicating ${state.dbPath} to ${state.replicaPath} (pid ${state.pid})`);
  hintsThisRun = 0;
  const onData = (buf: Buffer) => String(buf).split(/\r?\n/).filter((l) => l.trim()).forEach((l) => {
    note(l.slice(0, 500));
    if (RESET_HINT.test(l)) maybeReset(l);
    else if (AUTO_RECOVERED.test(l)) maybeReset(l, true);
  });
  p.stdout?.on("data", onData);
  p.stderr?.on("data", onData);
  p.on("error", (err) => note(`process error: ${err.message}`));
  p.on("exit", (code, signal) => {
    child = null;
    state.running = false;
    state.pid = null;
    state.lastExit = { at: new Date().toISOString(), code, signal };
    if (stopping) return;
    if (resetting) { void resetAndRelaunch(); return; }
    note(`exited (code ${code}, signal ${signal}); restarting`);
    scheduleRestart(startedMs);
  });
}

// 5 s, 10 s, 20 s ... up to 10 minutes while it keeps failing quickly; a run that lasted 10 minutes resets the back-off.
function scheduleRestart(startedMs: number) {
  quickFailures = Date.now() - startedMs > 10 * 60 * 1000 ? 0 : quickFailures + 1;
  state.restarts += 1;
  const delay = Math.min(10 * 60 * 1000, 5000 * 2 ** Math.max(0, quickFailures - 1));
  setTimeout(launch, delay).unref();
}

export function startContinuousBackup(sqlite: Database.Database, env: NodeJS.ProcessEnv = process.env): State {
  const plan = continuousBackupPlan(env);
  state.enabled = false;
  state.reason = plan.reason;
  if (!plan.enabled) {
    console.log(`[litestream] Continuous backup off: ${plan.reason}`);
    return state;
  }
  state.bin = String(env.LITESTREAM_BIN || "litestream");
  try {
    state.version = execFileSync(state.bin, ["version"], { timeout: 10000, windowsHide: true }).toString().trim();
  } catch {
    state.reason = `litestream binary not found (${state.bin})`;
    console.error(`[litestream] Continuous backup off: ${state.reason}`);
    return state;
  }
  // Litestream works only in WAL mode. The mode is stored in the database file, so it stays WAL afterwards.
  const mode = String(sqlite.pragma("journal_mode = WAL", { simple: true })).toLowerCase();
  if (mode !== "wal") {
    state.reason = `could not switch the database to WAL (journal_mode=${mode})`;
    console.error(`[litestream] Continuous backup off: ${state.reason}`);
    return state;
  }
  state.dbPath = path.resolve(sqlite.name);
  state.configPath = path.join(os.tmpdir(), "veritas-litestream.yml");
  fileReplicaDir = String(env.LITESTREAM_FILE_REPLICA ?? "").trim() || undefined;
  const testInterval = String(env.LITESTREAM_SNAPSHOT_INTERVAL ?? "").trim();
  snapshotInterval = fileReplicaDir && /^\d+[smh]$/.test(testInterval) ? testInterval : "6h";
  const stored = readGeneration(state.dbPath);
  const generation = Math.max(stored, GENERATION_FLOOR);
  useGeneration(generation, env);
  if (stored < generation) {
    // First boot on a new generation floor: clear Litestream's local state so the empty folder starts from a clean one.
    try {
      const out = execFileSync(state.bin, ["reset", "-config", state.configPath, state.dbPath], { timeout: 120000, windowsHide: true }).toString().trim();
      note(`moved to replica generation ${generation} (${state.replicaPath}); local state reset${out ? `: ${out.slice(0, 200)}` : ""}`);
    } catch (err: any) {
      note(`moved to replica generation ${generation}; litestream reset FAILED: ${String(err?.message || err).slice(0, 200)}`);
    }
  }
  state.enabled = true;
  state.reason = "on";
  stopping = false;
  launch();
  return state;
}

// On shutdown: let Litestream make its final sync (it does so on SIGTERM), then give up after the timeout.
export function stopContinuousBackup(timeoutMs = 15000): Promise<void> {
  stopping = true;
  const p = child;
  if (!p) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { clearTimeout(t); resolve(); };
    const t = setTimeout(() => { try { p.kill("SIGKILL"); } catch {} resolve(); }, timeoutMs);
    p.once("exit", done);
    try { p.kill("SIGTERM"); } catch { done(); }
  });
}

export function continuousBackupStatus(): State {
  return { ...state, log: [...state.log] };
}

function run(bin: string, args: string[], timeoutMs: number): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, env: process.env, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: `${stdout || ""}${stderr || ""}`.trim() || (err ? String(err.message) : "") });
    });
  });
}

// Litestream's own view of the local replication state (no network).
export async function litestreamLocalStatus(): Promise<any> {
  if (!state.enabled || !state.configPath) return null;
  const r = await run(state.bin, ["status", "-json", "-config", state.configPath], 15000);
  try { return JSON.parse(r.out); } catch { return { raw: r.out.slice(0, 1000) }; }
}

export interface ContinuousRestoreResult {
  ran: boolean;
  verdict: "PASS" | "FAIL" | "SKIP";
  skippedReason?: string;
  probeWrittenAt?: string;
  waitedMs?: number;
  restoreMs?: number;
  restoredBytes?: number;
  integrityCheck?: string;
  probeFound?: boolean;
  restored?: ReturnType<typeof countCore>;
  live?: ReturnType<typeof countCore>;
  notes?: string[];
  elapsedMs?: number;
}

// Restore self-test for the continuous replica, inside the container: write a probe row, wait, restore the replica to a
// temp file, check integrity, check the probe is there (the measured data-loss window), compare row counts with live,
// delete the temp file. Production data never leaves the server.
export async function continuousRestoreSelfTest(sqlite: Database.Database, waitMs = 5000): Promise<ContinuousRestoreResult> {
  const t0 = Date.now();
  if (!state.enabled || !state.configPath || !state.dbPath) return { ran: false, verdict: "SKIP", skippedReason: state.reason };
  const probeAt = new Date().toISOString();
  const probeId = Number(sqlite.prepare("INSERT INTO continuous_backup_probe (written_at, note) VALUES (?, ?)").run(probeAt, "restore self-test").lastInsertRowid);
  await new Promise((r) => setTimeout(r, waitMs));
  const out = path.join(os.tmpdir(), `veritas-litestream-restore-${Date.now()}.db`);
  const notes: string[] = [];
  try {
    const r0 = Date.now();
    const r = await run(state.bin, ["restore", "-config", state.configPath, "-o", out, state.dbPath], 10 * 60 * 1000);
    const restoreMs = Date.now() - r0;
    if (!r.ok || !fs.existsSync(out)) return { ran: true, verdict: "FAIL", probeWrittenAt: probeAt, waitedMs: waitMs, restoreMs, notes: [`restore failed: ${r.out.slice(0, 500)}`], elapsedMs: Date.now() - t0 };
    const restoredBytes = fs.statSync(out).size;
    const rdb = new Database(out, { readonly: true, fileMustExist: true });
    let integrityCheck = "";
    let probeFound = false;
    let restored: ReturnType<typeof countCore>;
    try {
      integrityCheck = String((rdb.prepare("PRAGMA integrity_check").get() as any)?.integrity_check ?? "");
      probeFound = !!rdb.prepare("SELECT 1 FROM continuous_backup_probe WHERE id = ? AND written_at = ?").get(probeId, probeAt);
      restored = countCore(rdb);
    } finally {
      rdb.close();
    }
    const live = countCore(sqlite);
    if (!probeFound) notes.push(`the change written ${waitMs / 1000} s before the restore is not in the restored copy`);
    if (restored.userCount !== live.userCount) notes.push(`users differ: restored ${restored.userCount}, live ${live.userCount}`);
    const verdict = integrityCheck === "ok" && probeFound && restored.tableCount > 0 ? "PASS" : "FAIL";
    return { ran: true, verdict, probeWrittenAt: probeAt, waitedMs: waitMs, restoreMs, restoredBytes, integrityCheck, probeFound, restored, live, notes, elapsedMs: Date.now() - t0 };
  } finally {
    for (const f of [out, `${out}-wal`, `${out}-shm`]) { try { fs.unlinkSync(f); } catch {} }
    try { fs.rmSync(path.join(path.dirname(out), `.${path.basename(out)}-litestream`), { recursive: true, force: true }); } catch {}
  }
}
