import express from "express";
import type { Express, Request, Response } from "express";
import type { Server } from "http";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import path from "path";
import fs from "fs";
import { storage } from "./storage";
import { db, PLAN_SEATS, PLAN_PRICES, PLAN_BED_RANGES, suggestTierFromBeds } from "./db";
import { stripe, PRICES, SEAT_PRICES, WEBHOOK_SECRET, FRONTEND_URL, PLAN_LIMITS, SEAT_PRICING, getSeatPrice } from "./stripe";
import crypto from "crypto";
import { Resend } from "resend";
import { generatePDFBuffer, generateCumsumPDF, generateVeritaScanPDF, generateCompetencyPDF, generateCMS209PDF, generateVeritaPTPDF } from "./pdfReport";
import { logAudit } from "./audit";
import { CLSI_COMPLIANCE_MATRIX_B64, SOFTWARE_VALIDATION_TEMPLATE_B64 } from "./downloadAssets";
import { cliaAnalytes, ptCategoryLinks } from "./cliaAnalytes";
import { DEMO_USER_EMAIL } from "./constants";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// Safe JSON parse helper — handles already-parsed values and plain strings
function safeJsonParse(value: any, fallback: any = []): any {
  if (Array.isArray(value) || (typeof value === 'object' && value !== null)) return value;
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return [value];
  }
}
import { insertStudySchema, insertContactSchema, registerSchema, loginSchema, type Study, resolveSeatPermission, type SeatPermissions } from "@shared/schema";

// ── Server-side pass/fail recomputation ─────────────────────────────────────
// Mirrors the client calculation logic so the stored status is always correct.
// Each study type has its own pass/fail rule derived from the raw dataPoints.
function computeStudyStatus(studyType: string, dataPointsJson: string, instrumentsJson: string, cliaAllowableError: number, teaIsPercentage: boolean = true, cliaAbsoluteFloor: number | null = null): "pass" | "fail" {
  try {
    const rawData = safeJsonParse(dataPointsJson, null);
    const instrumentNames: string[] = safeJsonParse(instrumentsJson, []);
    if (!rawData) return "fail";

    if (studyType === "cal_ver") {
      // Dual-criterion S493 rule: |observed - assigned| <= max(percent_allowance, absolute_floor)
      const dataPoints = rawData as { level: number; expectedValue: number | null; instrumentValues: Record<string, number | null> }[];
      const valid = dataPoints.filter(dp => dp.expectedValue !== null && instrumentNames.some(n => dp.instrumentValues[n] !== null));
      const FP_EPS = 1e-9;
      let passCount = 0, totalCount = 0;
      for (const dp of valid) {
        const assigned = dp.expectedValue!;
        const pctAllowance = teaIsPercentage ? Math.abs(assigned) * cliaAllowableError : 0;
        const absAllowance = teaIsPercentage ? (cliaAbsoluteFloor ?? 0) : cliaAllowableError;
        const allowance = Math.max(pctAllowance, absAllowance);
        for (const n of instrumentNames) {
          const v = dp.instrumentValues[n];
          if (v !== null && v !== undefined) {
            totalCount++;
            const diff = v - assigned;
            if (Math.abs(diff) <= allowance + FP_EPS) passCount++;
          }
        }
      }
      return (passCount === totalCount && totalCount > 0) ? "pass" : "fail";
    }

    if (studyType === "method_comparison") {
      // Check for qualitative or semi-quantitative assay types
      if (rawData.assayType === "qualitative") {
        const { categories, passThreshold, points } = rawData;
        const comparisonNames = instrumentNames.slice(1);
        const compName = comparisonNames[0];
        if (!points || !compName) return "fail";
        let agree = 0, total = 0;
        for (const dp of points) {
          const ref = dp.expectedCategory;
          const comp = dp.instrumentCategories?.[compName];
          if (ref && comp) {
            total++;
            if (ref === comp) agree++;
          }
        }
        const pctAgreement = total > 0 ? agree / total : 0;
        return pctAgreement >= (passThreshold || 0.90) ? "pass" : "fail";
      }
      if (rawData.assayType === "semi_quantitative") {
        const { gradeScale, passThreshold, points } = rawData;
        const comparisonNames = instrumentNames.slice(1);
        const compName = comparisonNames[0];
        if (!points || !compName || !gradeScale) return "fail";
        const gradeIndex: Record<string, number> = {};
        (gradeScale as string[]).forEach((g: string, i: number) => { gradeIndex[g] = i; });
        let withinOne = 0, total = 0;
        for (const dp of points) {
          const ref = dp.expectedCategory;
          const comp = dp.instrumentCategories?.[compName];
          if (ref && comp && gradeIndex[ref] !== undefined && gradeIndex[comp] !== undefined) {
            total++;
            if (Math.abs(gradeIndex[ref] - gradeIndex[comp]) <= 1) withinOne++;
          }
        }
        const pctWithinOne = total > 0 ? withinOne / total : 0;
        return pctWithinOne >= (passThreshold || 0.80) ? "pass" : "fail";
      }
      // Standard quantitative method comparison
      const dataPoints = rawData as { level: number; expectedValue: number | null; instrumentValues: Record<string, number | null> }[];
      const primaryName = instrumentNames[0];
      const hasAllInValues = dataPoints.length > 0 && instrumentNames.every(n => n in (dataPoints[0].instrumentValues || {}));
      let comparisonNames: string[];
      let mappedPoints: typeof dataPoints;
      if (hasAllInValues && instrumentNames.length >= 2) {
        comparisonNames = instrumentNames.slice(1);
        mappedPoints = dataPoints.map(d => ({
          level: d.level,
          expectedValue: d.instrumentValues[primaryName] ?? null,
          instrumentValues: Object.fromEntries(comparisonNames.map(n => [n, d.instrumentValues[n] ?? null])),
        }));
      } else {
        comparisonNames = instrumentNames.filter(n => n in (dataPoints[0]?.instrumentValues || {}));
        if (comparisonNames.length === 0) comparisonNames = instrumentNames;
        mappedPoints = dataPoints;
      }
      const valid = mappedPoints.filter(dp => dp.expectedValue !== null && comparisonNames.some(n => dp.instrumentValues[n] !== null));
      // Floating-point tolerance to absorb binary float noise
      const FP_EPS = 1e-9;
      let passCount = 0, totalCount = 0;
      const biasVals: number[] = [];
      for (const dp of valid) {
        const ref = dp.expectedValue!;
        for (const n of comparisonNames) {
          const v = dp.instrumentValues[n];
          if (v !== null && v !== undefined) {
            totalCount++;
            const diff = v - ref;
            // Dual-criterion S493 rule: pass when |diff| <= max(percent_allowance, absolute_floor)
            const pctAllowance = teaIsPercentage ? Math.abs(ref) * cliaAllowableError : 0;
            const absAllowance = teaIsPercentage
              ? (cliaAbsoluteFloor ?? 0)
              : cliaAllowableError;
            const allowance = Math.max(pctAllowance, absAllowance);
            if (teaIsPercentage) {
              const pctDiff = ref !== 0 ? (v - ref) / ref : 0;
              biasVals.push(pctDiff);
            } else {
              biasVals.push(diff);
            }
            if (Math.abs(diff) <= allowance + FP_EPS) passCount++;
          }
        }
      }

      // Validation guard: verify pass/fail matches computed mean bias
      // Use the dual-criterion allowance at the mean reference level
      let computedResult: "pass" | "fail" = (passCount === totalCount && totalCount > 0) ? "pass" : "fail";
      if (biasVals.length > 0) {
        const meanAbsBias = biasVals.reduce((a, b) => a + Math.abs(b), 0) / biasVals.length;
        // For the mean-bias guard, compute allowance in the same units as biasVals
        let meanAllowance: number;
        if (teaIsPercentage) {
          // biasVals are fractional (e.g. 0.09 for 9%), so compare against cliaAllowableError
          // but also consider the absolute floor converted to fraction at mean reference
          const refs = valid.flatMap(dp => {
            const ref = dp.expectedValue!;
            return comparisonNames.filter(n => dp.instrumentValues[n] !== null && dp.instrumentValues[n] !== undefined).map(() => ref);
          });
          const meanRef = refs.length > 0 ? refs.reduce((a, b) => a + Math.abs(b), 0) / refs.length : 0;
          const absFloorAsFraction = (cliaAbsoluteFloor ?? 0) / (meanRef || 1);
          meanAllowance = Math.max(cliaAllowableError, absFloorAsFraction);
        } else {
          meanAllowance = cliaAllowableError;
        }
        if (meanAbsBias > meanAllowance + FP_EPS && computedResult === "pass") {
          const biasLabel = teaIsPercentage
            ? `${(meanAbsBias * 100).toFixed(2)}% exceeds TEa ${(meanAllowance * 100).toFixed(1)}%`
            : `${meanAbsBias.toFixed(3)} exceeds TEa ${meanAllowance}`;
          console.error(`[VALIDATION] Method comparison computed as pass but mean |bias| ${biasLabel} - overriding to FAIL`);
          computedResult = "fail";
        }
      }
      return computedResult;
    }

    if (studyType === "precision") {
      // Dual-criterion S493: pass if CV <= allowableCV OR (2 * SD) <= absolute_floor.
      // The SD-based interpretation expresses the absolute floor as a +/- 2 SD envelope on
      // a single measurement at the level mean (k=2 coverage), the standard reading for
      // EP15 precision when an analyte's PT TEa includes an absolute floor (e.g. Glucose
      // +/- 8% or +/- 6 mg/dL whichever is greater).
      const dataPoints = rawData as { level: number; levelName: string; values: number[]; days?: number[][] }[];
      const allowableCV = cliaAllowableError * 100;
      const sdFloor = teaIsPercentage && (cliaAbsoluteFloor ?? 0) > 0
        ? (cliaAbsoluteFloor as number) / 2
        : null;
      let passCount = 0, totalCount = 0;
      for (const dp of dataPoints) {
        const allVals = dp.days ? dp.days.flat().filter(v => v !== null && !isNaN(v)) : dp.values.filter(v => v !== null && !isNaN(v));
        if (allVals.length < 2) { totalCount++; continue; }
        totalCount++;
        const n = allVals.length;
        const m = allVals.reduce((a, b) => a + b, 0) / n;
        const variance = allVals.reduce((s, v) => s + (v - m) ** 2, 0) / (n - 1);
        const sd = Math.sqrt(variance);
        const cv = m !== 0 ? (sd / m) * 100 : 0;
        const passPct = cv <= allowableCV;
        const passAbs = sdFloor !== null && sd <= sdFloor;
        if (passPct || passAbs) passCount++;
      }
      return (passCount === totalCount && totalCount > 0) ? "pass" : "fail";
    }

    if (studyType === "lot_to_lot") {
      // Dual-criterion S493: per-pair pass if |new - current| <= max(pct_allowance * |current|, absolute_floor).
      // Cohort pass: mean |%diff| <= tea*100 AND coverage >= 90%, computed against the dual rule.
      const { data, sampleType } = rawData;
      const tea = cliaAllowableError;
      const absFloor = teaIsPercentage ? (cliaAbsoluteFloor ?? 0) : 0;
      const cohorts: string[] = sampleType === "both" ? ["Normal", "Abnormal"] : [sampleType === "normal" ? "Normal" : "Abnormal"];
      const meanFn = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
      for (const cohort of cohorts) {
        const valid = data.filter((dp: any) => dp.cohort === cohort && dp.currentLot !== null && dp.newLot !== null);
        const absPcts = valid.map((dp: any) => {
          const pctDiff = dp.currentLot !== 0 ? ((dp.newLot - dp.currentLot) / dp.currentLot) * 100 : 0;
          return Math.abs(pctDiff);
        });
        // Per-pair pass status under dual rule
        const pairPasses = valid.map((dp: any) => {
          const diff = Math.abs(dp.newLot - dp.currentLot);
          const pctAllowance = Math.abs(dp.currentLot) * tea;
          const allowance = Math.max(pctAllowance, absFloor);
          return diff <= allowance;
        });
        const n = absPcts.length;
        if (n === 0) return "fail";
        const meanAbsPct = meanFn(absPcts);
        const withinTea = pairPasses.filter((p: boolean) => p).length;
        const coverage = (withinTea / n) * 100;
        if (!(meanAbsPct <= tea * 100 && coverage >= 90)) return "fail";
      }
      return "pass";
    }

    if (studyType === "qc_range") {
      const { dataPoints: dp } = rawData;
      const meanFn = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
      for (const item of dp) {
        const valid = (item.runs as number[]).filter(v => v !== null && v !== undefined && !isNaN(v));
        const n = valid.length;
        const newMean = n > 0 ? meanFn(valid) : 0;
        const pctDiffFromOld = item.oldMean != null && item.oldMean !== 0
          ? ((newMean - item.oldMean) / item.oldMean) * 100
          : null;
        if (pctDiffFromOld !== null && Math.abs(pctDiffFromOld) > 10) return "fail";
      }
      return "pass";
    }

    if (studyType === "multi_analyte_coag") {
      const { specimens, teas } = rawData;
      const meanFn = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
      const analytes: { getNew: (s: any) => number | null; getOld: (s: any) => number | null; tea: number }[] = [
        { getNew: s => s.ptNew, getOld: s => s.ptOld, tea: teas.pt },
        { getNew: s => s.apttNew, getOld: s => s.apttOld, tea: teas.aptt },
        { getNew: s => s.fibNew, getOld: s => s.fibOld, tea: teas.fib },
      ];
      for (const { getNew, getOld, tea } of analytes) {
        const valid = specimens.filter((s: any) => getNew(s) != null && getOld(s) != null);
        if (valid.length === 0) continue;
        const pctDiffs = valid.map((s: any) => ((getNew(s)! - getOld(s)!) / getOld(s)!) * 100);
        const meanPctDiff = meanFn(pctDiffs);
        if (Math.abs(meanPctDiff) > tea * 100) return "fail";
      }
      return "pass";
    }

    if (studyType === "ref_interval") {
      // CLSI EP28-A3c: pass if <=10% (<=2 of 20) fall outside reference range
      const { specimens, refLow, refHigh } = rawData;
      if (!specimens || !Array.isArray(specimens) || specimens.length === 0) return "fail";
      const n = specimens.length;
      const outsideCount = specimens.filter((s: any) => s.value < refLow || s.value > refHigh).length;
      const outsidePct = (outsideCount / n) * 100;
      return outsidePct <= 10 ? "pass" : "fail";
    }

    // pt_coag or unknown: trust client value (pt_coag is gated anyway)
    return "fail";
  } catch (err) {
    console.error("[computeStudyStatus] Error recomputing status:", err);
    return "fail"; // fail-safe: if we cannot verify, mark as fail
  }
}

// Recompute and fix status for all existing studies
export function recomputeAllStudyStatuses(): void {
  const allStudies = storage.getAllStudies();
  let fixed = 0;
  const sqlite = (db as any).$client;
  for (const study of allStudies) {
    const computed = computeStudyStatus(study.studyType, study.dataPoints, study.instruments, study.cliaAllowableError, (study as any).teaIsPercentage !== 0, (study as any).cliaAbsoluteFloor ?? null);
    if (computed !== study.status) {
      storage.updateStudyStatus(study.id, computed);
      // Also update the result column (not in drizzle schema, added via ALTER TABLE)
      sqlite.prepare("UPDATE studies SET result = ? WHERE id = ?").run(computed, study.id);
      console.log(`[migration] Study #${study.id} "${study.testName}": ${study.status} -> ${computed}`);
      fixed++;
    }
  }
  if (fixed > 0) {
    console.log(`[migration] Fixed ${fixed} study status(es)`);
  } else {
    console.log("[migration] All study statuses are correct");
  }
}
import { autoCompleteVeritaScanItems } from "./integrations";
import {
  MAYO_CRITICAL_VALUES, UNITS_LOOKUP, REFERENCE_RANGES, AMR_LOOKUP,
  CFR_MAP as VERITAMAP_CFR_MAP, getComplianceStatus, lookupAnalyte, INSTRUCTIONS_CONTENT,
} from "./veritamapData";
// Phase 3.6 (2026-05-03): Authoritative server-side reference for VeritaScan items.
// Used as a fallback when client-sent referenceItems are missing accreditor fields
// (e.g. stale browser bundles). Pure data module, safe to import on the server.
import { SCAN_ITEMS as VERITASCAN_SCAN_ITEMS } from "../client/src/lib/veritaScanData";
const VERITASCAN_ITEM_BY_ID: Record<number, any> = Object.fromEntries(
  VERITASCAN_SCAN_ITEMS.map((it: any) => [it.id, it])
);

const JWT_SECRET = process.env.JWT_SECRET!;

function signToken(userId: number) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "30d" });
}

// ── SUBSCRIPTION ACCESS LEVEL ──────────────────────────────────────────
function getAccessLevel(user: any): 'full' | 'read_only' | 'locked' | 'free' {
  if (!user.subscription_expires_at && !user.subscriptionExpiresAt) return 'free';

  const now = new Date();
  const expiry = new Date(user.subscription_expires_at || user.subscriptionExpiresAt);
  const twoYearsAfterExpiry = new Date(expiry);
  twoYearsAfterExpiry.setFullYear(twoYearsAfterExpiry.getFullYear() + 2);

  if (now < expiry) return 'full'; // active subscription
  if (now < twoYearsAfterExpiry) return 'read_only'; // within 2-year retention
  return 'locked'; // beyond 2-year retention
}

function requireWriteAccess(req: any, res: any, next: any) {
  const fullUser = storage.getUserById(req.userId);
  if (!fullUser) return res.status(401).json({ error: "User not found" });

  const accessLevel = getAccessLevel(fullUser);
  if (accessLevel === 'read_only') {
    const expiry = new Date(fullUser.subscriptionExpiresAt!);
    const retentionEnd = new Date(expiry);
    retentionEnd.setFullYear(retentionEnd.getFullYear() + 2);
    return res.status(403).json({
      error: "Your subscription has expired. Your data is available in read-only mode for 2 years. Resubscribe to add new records.",
      code: "SUBSCRIPTION_EXPIRED_READ_ONLY",
      retentionEndsAt: retentionEnd.toISOString(),
    });
  }
  if (accessLevel === 'locked') {
    return res.status(403).json({
      error: "Your data retention period has ended. Please resubscribe to regain access to your account.",
      code: "DATA_RETENTION_EXPIRED",
    });
  }
  next();
}

function authMiddleware(req: any, res: any, next: any) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET) as { userId: number };
    const user = storage.getUserById(payload.userId);
    if (!user) return res.status(401).json({ error: "User not found" });
    req.userId = user.id;
    req.user = { userId: user.id, plan: user.plan, email: user.email, name: user.name, studyCredits: user.studyCredits };

    // Check if this user is a seat user
    const seatRow = (db as any).$client.prepare(
      "SELECT owner_user_id, permissions FROM user_seats WHERE seat_user_id = ? AND status = 'active' LIMIT 1"
    ).get(req.userId) as any;

    if (seatRow) {
      req.isSeatUser = true;
      req.ownerUserId = seatRow.owner_user_id;
      // Stored as JSON; tolerate either legacy flat map OR new mode shape.
      // The resolver in requireModuleEdit handles both. Do NOT normalize on
      // read, the DB row stays in whatever shape was last written so a stale
      // tab posting the legacy shape continues to work.
      try {
        req.seatPermissions = JSON.parse(seatRow.permissions || '{}') as SeatPermissions;
      } catch {
        req.seatPermissions = {} as SeatPermissions;
      }
      // Seat users inherit the owner's plan for access checks
      const ownerUser = storage.getUserById(seatRow.owner_user_id);
      if (ownerUser) {
        req.user.plan = ownerUser.plan;
      }
    } else {
      req.isSeatUser = false;
      req.ownerUserId = req.userId;
      req.seatPermissions = null;
    }

    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}


// ── Per-module write gate for seat users ─────────────────────────────────────
// Uses the shared resolver so client useIsReadOnly() and this middleware
// agree on the answer. Drift between the two = UI says edit while API
// returns 403, which is exactly the symptom David hit. See shared/schema.ts.
function requireModuleEdit(module: string) {
  return (req: any, res: any, next: any) => {
    if (req.isSeatUser && req.seatPermissions) {
      const perm = resolveSeatPermission(req.seatPermissions as SeatPermissions, module);
      if (perm !== 'edit') {
        return res.status(403).json({
          error: `You have view-only access to ${module}. Ask the account owner to grant edit access.`
        });
      }
    }
    next();
  };
}

// ── PDF TOKEN STORE ──────────────────────────────────────────────────────────
// Short-lived in-memory store for PDF downloads.  Client calls POST to generate
// the PDF, receives a one-time token, then redirects the browser to the GET
// endpoint.  The browser handles the download natively so Adobe Acrobat's
// extension never gets a chance to intercept a blob:// URL.
interface PdfTokenEntry { buffer: Buffer; filename: string; expires: number; }
const pdfTokenStore = new Map<string, PdfTokenEntry>();
function storePdfToken(buffer: Buffer, filename: string): string {
  const token = crypto.randomUUID();
  pdfTokenStore.set(token, { buffer, filename, expires: Date.now() + 60_000 });
  // Prune expired entries
  for (const [k, v] of Array.from(pdfTokenStore)) { if (v.expires < Date.now()) pdfTokenStore.delete(k); }
  return token;
}

// ── LAB LOCK + AUDIT HELPERS ─────────────────────────────────────────────────

/**
 * Mark CLIA number and lab name as locked on a lab once the first report is
 * generated under that lab. Idempotent -- if already locked, this is a no-op.
 * Called from every PDF generation success path.
 */
function markLabReportingLocks(labId: number): void {
  try {
    (db as any).$client.prepare(
      "UPDATE labs SET clia_locked = 1, lab_name_locked = 1, updated_at = ? WHERE id = ? AND (clia_locked = 0 OR lab_name_locked = 0)"
    ).run(new Date().toISOString(), labId);
  } catch (err: any) {
    console.error("[markLabReportingLocks] Error:", err.message);
  }
}

/**
 * Resolve the lab row for a given user, following the seat -> owner -> lab_id
 * chain. Returns the full labs row or null.
 */
function resolveLabForUser(userId: number): any | null {
  // First check if user has lab_id directly
  const userRow = (db as any).$client.prepare(
    "SELECT lab_id FROM users WHERE id = ?"
  ).get(userId) as any;
  if (userRow?.lab_id) {
    return (db as any).$client.prepare("SELECT * FROM labs WHERE id = ?").get(userRow.lab_id);
  }
  // If this is a seat user, try the owner's lab
  const seatRow = (db as any).$client.prepare(
    "SELECT owner_user_id FROM user_seats WHERE seat_user_id = ? AND status = 'active' LIMIT 1"
  ).get(userId) as any;
  if (seatRow) {
    const ownerRow = (db as any).$client.prepare(
      "SELECT lab_id FROM users WHERE id = ?"
    ).get(seatRow.owner_user_id) as any;
    if (ownerRow?.lab_id) {
      return (db as any).$client.prepare("SELECT * FROM labs WHERE id = ?").get(ownerRow.lab_id);
    }
  }
  return null;
}

/**
 * Write an audit log entry for a lab field change.
 */
function writeLabAuditEntry(labId: number, changedByUserId: number, fieldName: string, oldValue: string | null, newValue: string | null, changeReason?: string): void {
  try {
    (db as any).$client.prepare(
      "INSERT INTO lab_audit_log (lab_id, changed_by_user_id, field_name, old_value, new_value, changed_at, change_reason) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(labId, changedByUserId, fieldName, oldValue, newValue, new Date().toISOString(), changeReason || null);
  } catch (err: any) {
    console.error("[writeLabAuditEntry] Error:", err.message);
  }
}

// Captured once when the module loads so /api/health can prove the server
// has actually restarted on a new deploy.
const BOOT_TIMESTAMP = new Date().toISOString();

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  // ── DEMO COMPETENCY DATA BACKFILL (runs once on startup) ────────────────
  try {
    (db as any).$client.prepare(`UPDATE competency_assessment_items SET el1_specimen_id = '0326:C147', el1_observer_initials = 'MV' WHERE el1_specimen_id IS NULL OR el1_specimen_id = ''`).run();
    (db as any).$client.prepare(`UPDATE competency_assessment_items SET el2_evidence = '0326:C147 - Sodium 141 mmol/L reported correctly, critical value callback documented per SOP', el2_date = '2026-01-16' WHERE el2_evidence IS NULL OR el2_evidence = '' OR el2_evidence = 'Reviewed result reporting including critical values'`).run();
    (db as any).$client.prepare(`UPDATE competency_assessment_items SET el5_sample_type = 'CAP PT Survey', el5_sample_id = 'CAP-2026-C-01', el5_acceptable = 1 WHERE el5_sample_id IS NULL OR el5_sample_id = ''`).run();
    (db as any).$client.prepare(`UPDATE competency_assessment_items SET el6_quiz_id = 'Q-AU5800-001', el6_score = 100, el6_date_taken = '2026-01-18' WHERE el6_quiz_id IS NULL OR el6_quiz_id = ''`).run();
  } catch (e: any) {
    console.log("Demo competency backfill skipped:", e.message);
  }

  // ── ADMIN ────────────────────────────────────────────────────────────────
  const ADMIN_SECRET = process.env.ADMIN_SECRET!;

  // Plan display name mapping
  const PLAN_DISPLAY_NAMES: Record<string, string> = {
    free: "Free",
    per_study: "Per Study",
    waived: "Clinic",
    community: "Community",
    hospital: "Hospital",
    large_hospital: "Enterprise",
    veritacheck_only: "VeritaCheck\u2122 Unlimited",
    annual: "Annual (Legacy)",
    starter: "Starter (Legacy)",
    professional: "Professional (Legacy)",
    lab: "Lab",
    complete: "Complete (Legacy)",
    veritamap: "VeritaMap\u2122 Add-on",
    veritascan: "VeritaScan\u2122 Add-on",
    veritacomp: "VeritaComp\u2122 Add-on",
  };

  app.get("/api/admin/report", (req, res) => {
    const secret = (req.headers["x-admin-secret"] || req.query.secret) as string | undefined;
    const { plan, status } = req.query as { plan?: string; status?: string };
    if (secret !== ADMIN_SECRET) return res.status(403).json({ error: "Forbidden" });

    // Owner counts as one of the seats. For any user who owns a multi-seat
    // plan (seat_count > 1) we add 1 to active_seats so the report reads
    // "4 of 25 used" instead of "3 of 25 used" for an owner with 3 invitees.
    let sql = `
      SELECT
        u.*,
        COALESCE(s.active_seats, 0) + (CASE WHEN u.seat_count > 1 THEN 1 ELSE 0 END) as active_seats,
        COALESCE(s.pending_seats, 0) as pending_seats,
        seat_link.owner_user_id as seat_owner_id,
        owner.name as seat_owner_name,
        owner.email as seat_owner_email,
        owner.clia_lab_name as seat_owner_lab_name,
        owner.clia_number as seat_owner_clia_number,
        sess.last_login,
        COALESCE(sess.session_count, 0) as session_count,
        COALESCE(st.study_count, 0) as study_count
      FROM users u
      LEFT JOIN (
        SELECT
          owner_user_id,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_seats,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_seats
        FROM user_seats
        GROUP BY owner_user_id
      ) s ON s.owner_user_id = u.id
      LEFT JOIN user_seats seat_link ON seat_link.seat_user_id = u.id AND seat_link.status = 'active'
      LEFT JOIN users owner ON owner.id = seat_link.owner_user_id
      LEFT JOIN (
        SELECT user_id, MAX(last_active) as last_login, COUNT(*) as session_count
        FROM user_sessions
        GROUP BY user_id
      ) sess ON sess.user_id = u.id
      LEFT JOIN (
        SELECT user_id, COUNT(*) as study_count
        FROM studies
        WHERE user_id IS NOT NULL
        GROUP BY user_id
      ) st ON st.user_id = u.id
    `;

    const conditions: string[] = [];
    const params: any[] = [];

    if (plan) {
      conditions.push("u.plan = ?");
      params.push(plan);
    }
    if (status) {
      conditions.push("u.subscription_status = ?");
      params.push(status);
    }

    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
    }

    sql += " ORDER BY u.created_at DESC";

    try {
      const rows = (db as any).$client.prepare(sql).all(...params) as any[];
      const users = rows.map((row: any) => {
        const { password_hash, ...rest } = row;
        return {
          ...rest,
          planDisplayName: PLAN_DISPLAY_NAMES[rest.plan] || rest.plan || "Unknown",
        };
      });
      res.json({
        generatedAt: new Date().toISOString(),
        totalUsers: users.length,
        users,
      });
    } catch (err: any) {
      console.error("Admin report error:", err.message);
      res.status(500).json({ error: "Failed to generate report" });
    }
  });

  // Admin: list raw studies for a given user (full payload incl. data_points)
  // Used for legitimate cross-tenant operations (e.g. demo lab seeding from owner's own data).
  // Read-only. Auth: x-admin-secret header or ?secret= query param.
  app.get("/api/admin/studies/by-user/:userId", (req, res) => {
    const secret = (req.headers["x-admin-secret"] || req.query.secret) as string | undefined;
    if (secret !== ADMIN_SECRET) return res.status(403).json({ error: "Forbidden" });
    const userId = parseInt(req.params.userId);
    if (!Number.isFinite(userId)) return res.status(400).json({ error: "Invalid userId" });
    const studies = storage.getStudiesByUser(userId);
    res.json({ userId, count: studies.length, studies });
  });

  app.post("/api/admin/users", (req, res) => {
    const { secret, maxId } = req.body;
    if (secret !== ADMIN_SECRET) return res.status(403).json({ error: "Forbidden" });
    const allStudies = storage.getAllStudies();
    const userList = [];
    const upperBound = Math.min(Number.isInteger(Number(maxId)) && Number(maxId) > 0 ? Number(maxId) : 20, 1000);
    for (let i = 1; i <= upperBound; i++) {
      const u = storage.getUserById(i);
      if (u) userList.push({ id: u.id, email: u.email, name: u.name, plan: u.plan, studyCount: allStudies.filter(s => s.userId === i).length });
    }
    res.json(userList);
  });

  app.post("/api/admin/set-plan", (req, res) => {
    const { secret, userId, plan, credits } = req.body;
    if (secret !== ADMIN_SECRET) return res.status(403).json({ error: "Forbidden" });
    const planCredits = ["annual", "starter", "professional", "lab", "complete", "waived", "community", "hospital", "large_hospital", "enterprise", "veritacheck_only"].includes(plan) ? 99999 : (credits ?? 0);
    storage.updateUserPlan(Number(userId), plan, planCredits);
    const user = storage.getUserById(Number(userId));
    res.json({ ok: true, user: { id: user?.id, email: user?.email, plan: user?.plan, studyCredits: user?.studyCredits } });
  });

  app.post("/api/admin/set-seats", (req, res) => {
    const { secret, userId, seatCount } = req.body;
    if (secret !== ADMIN_SECRET) return res.status(403).json({ error: "Forbidden" });
    if (!userId || seatCount === undefined) return res.status(400).json({ error: "userId and seatCount required" });
    db.$client.prepare("UPDATE users SET seat_count = ? WHERE id = ?").run(Number(seatCount), Number(userId));
    const row = db.$client.prepare("SELECT id, email, name, seat_count FROM users WHERE id = ?").get(Number(userId)) as any;
    res.json({ ok: true, user: { id: row?.id, email: row?.email, name: row?.name, seatCount: row?.seat_count } });
  });

  // Admin: list all seat records (used by audit script to verify seat integrity)
  app.post("/api/admin/seats", (req, res) => {
    const { secret } = req.body;
    if (secret !== ADMIN_SECRET) return res.status(403).json({ error: "Forbidden" });
    const seats = (db as any).$client.prepare("SELECT * FROM user_seats").all();
    res.json(seats);
  });

  // Admin: attach an existing user as an active seat under an owner account
  app.post("/api/admin/attach-seat", (req, res) => {
    const { secret, ownerUserId, seatEmail, seatUserId } = req.body;
    if (secret !== ADMIN_SECRET) return res.status(403).json({ error: "Forbidden" });
    if (!ownerUserId || !seatEmail || !seatUserId) return res.status(400).json({ error: "ownerUserId, seatEmail, seatUserId required" });
    const sqlite = db.$client;
    // Remove any existing seat records for this email under this owner
    sqlite.prepare("DELETE FROM user_seats WHERE owner_user_id = ? AND seat_email = ?").run(Number(ownerUserId), seatEmail);
    // Insert as active seat with full permissions
    const now = new Date().toISOString();
    sqlite.prepare(`
      INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions)
      VALUES (?, ?, ?, ?, ?, 'active', '{}')
    `).run(Number(ownerUserId), seatEmail, Number(seatUserId), now, now);
    // Give the seat user the owner's actual plan (not hardcoded community)
    const ownerUser = sqlite.prepare("SELECT plan FROM users WHERE id = ?").get(Number(ownerUserId)) as any;
    const inheritedPlan = ownerUser?.plan || 'community';
    sqlite.prepare("UPDATE users SET plan = ?, study_credits = 99999 WHERE id = ?").run(inheritedPlan, Number(seatUserId));
    const seat = sqlite.prepare("SELECT * FROM user_seats WHERE owner_user_id = ? AND seat_email = ?").get(Number(ownerUserId), seatEmail) as any;
    res.json({ ok: true, seat });
  });

  // Admin: delete a user by id (destructive, requires confirm=true)
  app.delete("/api/admin/users/:id", (req, res) => {
    const secret = (req.headers["x-admin-secret"] || req.query.secret) as string | undefined;
    if (secret !== ADMIN_SECRET) return res.status(403).json({ error: "Forbidden" });

    const confirm = req.query.confirm as string | undefined;
    if (confirm !== "true") return res.status(400).json({ error: "Missing confirm=true. This is a destructive action." });

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid user id. Must be a positive integer." });

    const user = storage.getUserById(id);
    if (!user) return res.status(404).json({ error: "User not found", id });

    storage.deleteUser(id);
    console.log(`[ADMIN] User deleted: id=${id} email=${user.email} at=${new Date().toISOString()}`);
    res.json({ deleted: true, id, email: user.email });
  });

  // ── DISCOUNT CODES (admin) ───────────────────────────────────────────────
  app.get("/api/admin/discount-codes", (req, res) => {
    const { secret } = req.query as any;
    if (secret !== ADMIN_SECRET) {
      const body = req.body;
      if (body?.secret !== ADMIN_SECRET) return res.status(403).json({ error: "Forbidden" });
    }
    const codes = db.$client.prepare("SELECT * FROM discount_codes ORDER BY id DESC").all();
    res.json(codes);
  });

  app.post("/api/admin/discount-codes", (req, res) => {
    const { secret, code, partnerName, discountPct, appliesTo, maxUses, trialDays } = req.body;
    if (secret !== ADMIN_SECRET) return res.status(403).json({ error: "Forbidden" });
    if (!code || !partnerName) return res.status(400).json({ error: "code and partnerName required" });
    try {
      db.$client.prepare(
        "INSERT INTO discount_codes (code, partner_name, discount_pct, applies_to, max_uses, uses, active, created_at, trial_days) VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?)"
      ).run(code.toUpperCase(), partnerName, discountPct || 10, appliesTo || "annual", maxUses ?? null, new Date().toISOString(), trialDays ?? null);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(409).json({ error: "Code already exists" });
    }
  });

  app.patch("/api/admin/discount-codes/:id", (req, res) => {
    const { secret, active, discountPct, appliesTo, maxUses, trialDays } = req.body;
    if (secret !== ADMIN_SECRET) return res.status(403).json({ error: "Forbidden" });
    const id = parseInt(req.params.id);
    const sets: string[] = [];
    const vals: any[] = [];
    if (active !== undefined) { sets.push("active = ?"); vals.push(active ? 1 : 0); }
    if (discountPct !== undefined) { sets.push("discount_pct = ?"); vals.push(discountPct); }
    if (appliesTo !== undefined) { sets.push("applies_to = ?"); vals.push(appliesTo); }
    if (maxUses !== undefined) { sets.push("max_uses = ?"); vals.push(maxUses); }
    if (trialDays !== undefined) { sets.push("trial_days = ?"); vals.push(trialDays); }
    if (!sets.length) return res.status(400).json({ error: "Nothing to update" });
    vals.push(id);
    db.$client.prepare(`UPDATE discount_codes SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
    const updated = db.$client.prepare("SELECT * FROM discount_codes WHERE id = ?").get(id);
    res.json(updated);
  });

  // ── ONE-TIME: Notify account owners of new modules ──────────────────────
  // POST /api/admin/notify-new-modules  { secret }
  // Safe to call multiple times -- idempotent by design (just sends email, no DB write needed)
  app.post("/api/admin/notify-new-modules", async (req: any, res) => {
    const { secret } = req.body;
    if (secret !== ADMIN_SECRET) return res.status(403).json({ error: "Forbidden" });
    if (!resend) return res.status(500).json({ error: "Resend not configured" });

    // Find all active lab account owners who have at least one active seat
    const SEAT_PLANS = ["lab", "community", "hospital", "large_hospital", "enterprise", "complete"];
    const owners = db.$client.prepare(`
      SELECT DISTINCT u.user_id, u.email, u.name
      FROM users u
      INNER JOIN user_seats s ON s.owner_user_id = u.user_id AND s.status = 'active'
      WHERE u.plan IN (${SEAT_PLANS.map(() => "?").join(",")})
    `).all(...SEAT_PLANS) as Array<{ user_id: number; email: string; name: string }>;

    let sent = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const owner of owners) {
      try {
        await resend.emails.send({
          from: "VeritaAssure\u2122 <info@veritaslabservices.com>",
          to: owner.email,
          subject: "Three new modules are now available for your team",
          html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">
  <div style="background: #01696F; padding: 24px 32px; border-radius: 8px 8px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 22px;">New modules available on VeritaAssure\u2122</h1>
  </div>
  <div style="padding: 32px; background: #f9f9f9; border-radius: 0 0 8px 8px;">
    <p style="margin: 0 0 16px;">Hi ${owner.name || "there"},</p>
    <p style="margin: 0 0 16px;">Three new modules are now included in your VeritaAssure\u2122 subscription:</p>
    <ul style="margin: 0 0 24px; padding-left: 20px; line-height: 1.8;">
      <li><strong>VeritaPolicy\u2122</strong>: Policy and procedure management with version control and staff acknowledgment tracking</li>
      <li><strong>VeritaLab\u2122</strong>: Certificate and accreditation document storage for your laboratory</li>
      <li><strong>VeritaTrack\u2122</strong>: Regulatory compliance calendar to track and sign off timed lab tasks</li>
    </ul>
    <p style="margin: 0 0 24px;">Your team members currently have <strong>View access</strong> to these modules by default. You can update their permissions, including granting Edit access or removing access, from your account settings.</p>
    <a href="https://www.veritaslabservices.com/account" style="display: inline-block; background: #01696F; color: white; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: bold;">Manage Team Permissions</a>
    <p style="margin: 24px 0 0; font-size: 13px; color: #666;">Questions? Reply to this email or contact us at info@veritaslabservices.com.</p>
  </div>
</div>`,
        });
        sent++;
      } catch (err: any) {
        failed++;
        errors.push(`${owner.email}: ${err.message}`);
      }
    }

    res.json({ ok: true, total: owners.length, sent, failed, errors });
  });

  // ── DISCOUNT CODE VALIDATION (public) ──────────────────────────────────
  app.post("/api/discount/validate", async (req, res) => {
    const { code, priceType } = req.body;
    if (!code) return res.json({ valid: false, message: "No code provided" });

    // Check internal discount_codes table first
    const row = db.$client.prepare("SELECT * FROM discount_codes WHERE UPPER(code) = UPPER(?)").get(code.trim()) as any;
    if (row) {
      if (!row.active) return res.json({ valid: false, message: "This code is no longer active" });
      if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
        return res.json({ valid: false, message: "This code has expired" });
      }
      if (row.max_uses !== null && row.uses >= row.max_uses) return res.json({ valid: false, message: "This code has reached its usage limit" });
      if (row.applies_to !== "all" && row.applies_to !== priceType) {
        return res.json({ valid: false, message: `This code applies to ${row.applies_to} plans only` });
      }
      const parts: string[] = [];
      if (row.trial_days) parts.push(`${row.trial_days}-day free trial`);
      if (row.discount_pct) parts.push(`${row.discount_pct}% off`);
      return res.json({
        valid: true,
        discountPct: row.discount_pct || 0,
        trialDays: row.trial_days || 0,
        partnerName: row.partner_name,
        message: parts.join(" + ") || "Discount applied",
      });
    }

    // Fall back to direct Stripe coupon lookup
    if (stripe) {
      try {
        const coupon = await stripe.coupons.retrieve(code.trim());
        if (coupon && coupon.valid) {
          const pct = coupon.percent_off ?? 0;
          return res.json({ valid: true, discountPct: pct, partnerName: coupon.name || "Partner", message: `${pct}% discount applied`, stripeId: coupon.id });
        }
      } catch (stripeErr: any) {
        console.error("[validate-discount] Stripe coupon lookup error:", stripeErr?.message);
      }
    }

    return res.json({ valid: false, message: "Invalid discount code" });
  });

  // ── INVOICE REQUEST (public) ──────────────────────────────────────────────
  const invoiceRateMap = new Map<string, number[]>();

  app.post("/api/invoice/request", async (req: any, res) => {
    try {
      const {
        lab_name, clia_number, billing_contact_name, billing_contact_email,
        billing_address, ap_email, tax_id, tier, seats, promo_code,
        po_number, notes, company_website, authorization
      } = req.body;

      // Honeypot - bots fill hidden field, humans don't
      if (company_website) {
        return res.status(200).json({ success: true, message: "Thank you for your submission." });
      }

      // Rate limit: 3 per hour per IP
      const ip = req.ip || "unknown";
      const now = Date.now();
      const oneHour = 60 * 60 * 1000;
      const hits = invoiceRateMap.get(ip) || [];
      const recentHits = hits.filter((t: number) => now - t < oneHour);
      if (recentHits.length >= 3) {
        return res.status(429).json({ error: "Too many requests. Please try again in an hour or email info@veritaslabservices.com." });
      }
      recentHits.push(now);
      invoiceRateMap.set(ip, recentHits);

      // Validation
      if (!lab_name || !billing_contact_name || !billing_contact_email || !billing_address || !tier || !seats || !authorization) {
        return res.status(400).json({ error: "Missing required fields: lab_name, billing_contact_name, billing_contact_email, billing_address, tier, seats, and authorization are required." });
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(billing_contact_email)) {
        return res.status(400).json({ error: "Invalid billing contact email address." });
      }
      if (ap_email && !emailRegex.test(ap_email)) {
        return res.status(400).json({ error: "Invalid AP email address." });
      }

      const validTiers = ["clinic", "community", "hospital", "enterprise"];
      if (!validTiers.includes(tier)) {
        return res.status(400).json({ error: "Invalid tier. Must be one of: clinic, community, hospital, enterprise." });
      }

      const seatCount = parseInt(seats, 10);
      if (isNaN(seatCount) || seatCount < 1 || seatCount > 100) {
        return res.status(400).json({ error: "Seats must be an integer between 1 and 100." });
      }

      // Promo code lookup
      let discount_pct = 0;
      let trial_days = 0;
      let promo_applied = false;
      if (promo_code) {
        try {
          const discountRow = db.$client.prepare(
            "SELECT * FROM discount_codes WHERE UPPER(code) = UPPER(?) AND active = 1"
          ).get(promo_code.trim()) as any;
          const isExpired = discountRow?.expires_at && new Date(discountRow.expires_at).getTime() < Date.now();
          if (discountRow && !isExpired) {
            if (discountRow.max_uses === null || discountRow.uses < discountRow.max_uses) {
              discount_pct = discountRow.discount_pct || 0;
              trial_days = discountRow.trial_days || 0;
              promo_applied = true;
            }
          }
        } catch (e) {
          console.error("[invoice-request] Promo code lookup error:", e);
        }
      }

      // User auto-create or find existing
      const normalizedEmail = billing_contact_email.toLowerCase().trim();
      let existingUser = storage.getUserByEmail(normalizedEmail);
      let userId: number;

      if (existingUser) {
        userId = existingUser.id;
        // Only set pending_invoice if they are on free/null plan
        if (!existingUser.plan || existingUser.plan === "free") {
          db.$client.prepare("UPDATE users SET plan = 'pending_invoice' WHERE id = ?").run(userId);
        }
      } else {
        // Create user with placeholder password
        const placeholderHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
        const newUser = storage.createUser(normalizedEmail, placeholderHash, billing_contact_name);
        userId = newUser.id;
        db.$client.prepare(
          "UPDATE users SET plan = 'pending_invoice', hipaa_acknowledged = 1, hipaa_acknowledged_at = ? WHERE id = ?"
        ).run(new Date().toISOString(), userId);
      }

      // Generate password reset token (1 hour expiry)
      const resetToken = crypto.randomBytes(32).toString("hex");
      const resetExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      db.$client.prepare(
        "INSERT OR REPLACE INTO reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)"
      ).run(userId, resetToken, resetExpiresAt);
      const resetUrl = `${FRONTEND_URL}/reset-password?token=${resetToken}`;

      // Insert invoice request
      const insertResult = db.$client.prepare(`
        INSERT INTO invoice_requests (
          user_id, lab_name, clia_number, billing_contact_name, billing_contact_email,
          billing_address, ap_email, tax_id, tier, seats, promo_code,
          discount_pct, trial_days, po_number, notes, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      `).run(
        userId, lab_name, clia_number || null, billing_contact_name, normalizedEmail,
        billing_address, ap_email || null, tax_id || null, tier, seatCount, promo_code || null,
        discount_pct, trial_days, po_number || null, notes || null, new Date().toISOString()
      );
      const requestId = insertResult.lastInsertRowid;

      // Send emails
      let emailWarning = false;
      if (resend) {
        // Email 1: Requester confirmation
        try {
          const tierLabels: Record<string, string> = {
            clinic: "Clinic ($499/yr)", community: "Community ($999/yr)",
            hospital: "Hospital ($1,999/yr)", enterprise: "Enterprise ($2,999/yr)",
            veritacheck: "VeritaCheck\u2122 Unlimited ($299/yr)"
          };
          const promoLine = promo_applied
            ? `<p style="margin: 0 0 12px;"><strong>Promo code:</strong> ${promo_code} (${discount_pct}% off${trial_days ? `, ${trial_days}-day trial` : ""})</p>`
            : "";
          await resend.emails.send({
            from: "VeritaAssure\u2122 <info@veritaslabservices.com>",
            to: normalizedEmail,
            subject: "Your VeritaAssure\u2122 invoice request - next steps",
            html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">
  <div style="background: #01696F; padding: 24px 32px; border-radius: 8px 8px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 22px;">Invoice Request Received</h1>
  </div>
  <div style="padding: 32px; background: #f9f9f9; border-radius: 0 0 8px 8px;">
    <p style="margin: 0 0 16px;">Hi ${billing_contact_name},</p>
    <p style="margin: 0 0 16px;">Thank you for requesting an invoice for VeritaAssure\u2122. Here is a summary of what you submitted:</p>
    <div style="background: white; border: 1px solid #e0e0e0; border-radius: 6px; padding: 16px; margin: 0 0 16px;">
      <p style="margin: 0 0 8px;"><strong>Lab:</strong> ${lab_name}</p>
      <p style="margin: 0 0 8px;"><strong>Plan:</strong> ${tierLabels[tier] || tier}</p>
      <p style="margin: 0 0 8px;"><strong>Seats:</strong> ${seatCount}</p>
      ${promoLine}
    </div>
    <p style="margin: 0 0 16px;"><strong>What happens next:</strong></p>
    <ul style="margin: 0 0 16px; padding-left: 20px; line-height: 1.8;">
      <li>We will send your invoice within 1 business day via Stripe.</li>
      <li>Your VeritaAssure\u2122 account will activate once the invoice is paid.</li>
    </ul>
    <p style="margin: 0 0 16px;">In the meantime, set your password so you are ready to log in:</p>
    <a href="${resetUrl}" style="display: inline-block; background: #01696F; color: white; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: bold;">Set Your Password</a>
    <p style="margin: 24px 0 0; font-size: 13px; color: #666;">Questions? Reply to this email or contact us at info@veritaslabservices.com.</p>
  </div>
</div>`,
          });
        } catch (emailErr: any) {
          console.error("[invoice-request] Requester email failed:", emailErr?.message);
          emailWarning = true;
        }

        // Email 2: Internal notification
        try {
          await resend.emails.send({
            from: "VeritaAssure\u2122 <info@veritaslabservices.com>",
            to: ["info@veritaslabservices.com", "verilabguy@gmail.com"],
            subject: `New invoice request: ${lab_name} - ${tier} x ${seatCount}`,
            html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; color: #1a1a1a;">
  <h2 style="color: #01696F;">New Invoice Request (#${requestId})</h2>
  <table style="border-collapse: collapse; width: 100%;">
    <tr><td style="padding: 6px 12px; font-weight: bold;">Lab Name</td><td style="padding: 6px 12px;">${lab_name}</td></tr>
    <tr><td style="padding: 6px 12px; font-weight: bold;">CLIA Number</td><td style="padding: 6px 12px;">${clia_number || "N/A"}</td></tr>
    <tr><td style="padding: 6px 12px; font-weight: bold;">Billing Contact</td><td style="padding: 6px 12px;">${billing_contact_name} (${normalizedEmail})</td></tr>
    <tr><td style="padding: 6px 12px; font-weight: bold;">AP Email</td><td style="padding: 6px 12px;">${ap_email || "Same as billing"}</td></tr>
    <tr><td style="padding: 6px 12px; font-weight: bold;">Billing Address</td><td style="padding: 6px 12px;">${billing_address}</td></tr>
    <tr><td style="padding: 6px 12px; font-weight: bold;">Tax ID / EIN</td><td style="padding: 6px 12px;">${tax_id || "N/A"}</td></tr>
    <tr><td style="padding: 6px 12px; font-weight: bold;">Tier</td><td style="padding: 6px 12px;">${tier}</td></tr>
    <tr><td style="padding: 6px 12px; font-weight: bold;">Seats</td><td style="padding: 6px 12px;">${seatCount}</td></tr>
    <tr><td style="padding: 6px 12px; font-weight: bold;">Promo Code</td><td style="padding: 6px 12px;">${promo_applied ? `${promo_code} (${discount_pct}% off, ${trial_days}-day trial)` : "None"}</td></tr>
    <tr><td style="padding: 6px 12px; font-weight: bold;">PO Number</td><td style="padding: 6px 12px;">${po_number || "N/A"}</td></tr>
    <tr><td style="padding: 6px 12px; font-weight: bold;">Notes</td><td style="padding: 6px 12px;">${notes || "None"}</td></tr>
    <tr><td style="padding: 6px 12px; font-weight: bold;">User ID</td><td style="padding: 6px 12px;">${userId} (${existingUser ? "existing" : "new"})</td></tr>
  </table>
  <p style="margin-top: 16px;"><a href="https://dashboard.stripe.com/invoices" style="color: #01696F;">Open Stripe Invoices Dashboard</a></p>
</div>`,
          });
        } catch (emailErr: any) {
          console.error("[invoice-request] Internal notification email failed:", emailErr?.message);
          emailWarning = true;
        }
      } else {
        console.log("[invoice-request] Resend not configured, skipping emails for request", requestId);
        emailWarning = true;
      }

      return res.status(201).json({
        success: true,
        request_id: requestId,
        promo_applied,
        discount_pct,
        trial_days,
        password_set_url_sent: true,
        ...(emailWarning ? { email_warning: true } : {}),
      });
    } catch (err: any) {
      console.error("[invoice-request] Unexpected error:", err);
      return res.status(500).json({ error: "An unexpected error occurred. Please email info@veritaslabservices.com." });
    }
  });

  // ── DOWNLOADS ─────────────────────────────────────────────────────────────
  app.get("/api/downloads/clsi-compliance-matrix", (_req, res) => {
    const buf = Buffer.from(CLSI_COMPLIANCE_MATRIX_B64, "base64");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="VeritaCheck_CLSI_Compliance_Matrix.pdf"');
    res.setHeader("Content-Length", buf.length);
    res.send(buf);
  });

  app.get("/api/downloads/software-validation-template", (_req, res) => {
    const buf = Buffer.from(SOFTWARE_VALIDATION_TEMPLATE_B64, "base64");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="VeritaCheck_Software_Validation_Template.pdf"');
    res.setHeader("Content-Length", buf.length);
    res.send(buf);
  });

  // ── HEALTH CHECK ──────────────────────────────────────────────────────────
  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "veritas-lab-services",
      timestamp: new Date().toISOString(),
      // Build fingerprint — lets us verify which commit is actually running
      // without needing access to the Railway dashboard. Set by the build
      // script via RAILWAY_GIT_COMMIT_SHA / GIT_COMMIT_SHA env var; falls
      // back to "unknown" if neither is present.
      commit: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || "unknown",
      bootedAt: BOOT_TIMESTAMP,
    });
  });

  // ── TEMPORARY: Debug route list + admin recovery ──────────────────────────
  // Dev-only: returns 404 in production so the surface is not reachable
  // on the live site even if ADMIN_SECRET leaks.
  app.get("/api/debug/routes", (req, res) => {
    if (process.env.NODE_ENV === "production") return res.status(404).json({ error: "Not Found" });
    const secret = req.query.secret as string;
    if (secret !== ADMIN_SECRET) return res.status(403).json({ error: "Forbidden" });
    const routes: string[] = [];
    app._router?.stack?.forEach((layer: any) => {
      if (layer.route) {
        const methods = Object.keys(layer.route.methods).join(',').toUpperCase();
        routes.push(`${methods} ${layer.route.path}`);
      } else if (layer.name === 'router' && layer.handle?.stack) {
        layer.handle.stack.forEach((r: any) => {
          if (r.route) {
            const methods = Object.keys(r.route.methods).join(',').toUpperCase();
            routes.push(`${methods} ${r.route.path}`);
          }
        });
      }
    });
    res.json({ totalRoutes: routes.length, routes });
  });

  // TEMPORARY: Admin account restore via /api/auth path (bypasses routing issue)
  // Dev-only: returns 404 in production. Replaces the prior "TEMPORARY"
  // routing workaround so this admin surface is not reachable on the
  // live site even if ADMIN_SECRET leaks.
  app.post("/api/auth/admin-restore", async (req, res) => {
    if (process.env.NODE_ENV === "production") return res.status(404).json({ error: "Not Found" });
    const { secret, action, userId, plan, credits, email, password, name, stripeCustomerId, stripeSubscriptionId } = req.body;
    if (secret !== ADMIN_SECRET) return res.status(403).json({ error: "Forbidden" });
    try {
      if (action === 'set-plan') {
        const planCredits = ["annual","starter","professional","lab","complete","waived","community","hospital","large_hospital","enterprise","veritacheck_only"].includes(plan) ? 99999 : (credits ?? 0);
        storage.updateUserPlan(Number(userId), plan, planCredits);
        const user = storage.getUserById(Number(userId));
        return res.json({ ok: true, user: { id: user?.id, email: user?.email, plan: user?.plan, studyCredits: user?.studyCredits } });
      }
      if (action === 'update-user') {
        const updates: string[] = [];
        const params: any[] = [];
        if (name) { updates.push('name = ?'); params.push(name); }
        if (password) {
          const bcrypt = await import('bcryptjs');
          const hash = await bcrypt.default.hash(password, 10);
          updates.push('password_hash = ?'); params.push(hash);
        }
        if (stripeCustomerId) { updates.push('stripe_customer_id = ?'); params.push(stripeCustomerId); }
        if (stripeSubscriptionId) { updates.push('stripe_subscription_id = ?'); params.push(stripeSubscriptionId); }
        if (updates.length > 0) {
          params.push(Number(userId));
          (db as any).$client.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
        }
        const user = storage.getUserById(Number(userId));
        return res.json({ ok: true, user: { id: user?.id, email: user?.email, name: user?.name, plan: user?.plan } });
      }
      if (action === 'create-user') {
        const bcrypt = await import('bcryptjs');
        const hash = await bcrypt.default.hash(password, 10);
        const user = storage.createUser(email.toLowerCase(), hash, name);
        return res.json({ ok: true, user: { id: user.id, email: user.email, name: user.name } });
      }
      if (action === 'list-users') {
        const rows = (db as any).$client.prepare('SELECT id, email, name, plan, study_credits, stripe_customer_id FROM users').all();
        return res.json({ ok: true, users: rows });
      }
      if (action === 'create-discount-code') {
        const { code, discountPct, trialDays, partnerName, appliesTo, maxUses } = req.body;
        (db as any).$client.prepare('INSERT INTO discount_codes (code, discount_pct, trial_days, partner_name, applies_to, max_uses, active) VALUES (?, ?, ?, ?, ?, ?, 1)').run(code, discountPct || 0, trialDays || null, partnerName || null, appliesTo || 'all', maxUses || null);
        return res.json({ ok: true, code });
      }
      return res.status(400).json({ error: 'Unknown action' });
    } catch (err: any) {
      console.error('[admin-restore] Error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  });

  // ── AUTH ──────────────────────────────────────────────────────────────────
  app.post("/api/auth/register", async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { email, password, name, hipaa_acknowledged } = parsed.data;
    if (!hipaa_acknowledged) return res.status(400).json({ error: "You must acknowledge the data use policy to create an account." });
    if (storage.getUserByEmail(email)) return res.status(409).json({ error: "Email already registered" });
    const passwordHash = await bcrypt.hash(password, 10);
    const user = storage.createUser(email.toLowerCase(), passwordHash, name);

    // Save HIPAA acknowledgment + hospital info + plan from signup
    const { plan: reqPlan, hospital_name, hospital_state, bed_count } = req.body;
    const validPlans = ["free", "per_study", "clinic", "community", "hospital", "enterprise", "waived", "large_hospital", "veritacheck_only", "lab"];
    const selectedPlan = validPlans.includes(reqPlan) ? reqPlan : "free";
    const selectedSeatCount = PLAN_SEATS[selectedPlan] || 1;
    try {
      (db as any).$client.prepare(
        "UPDATE users SET hipaa_acknowledged = 1, hipaa_acknowledged_at = ?, plan = ?, seat_count = ?, hospital_name = ?, hospital_state = ?, bed_count = ? WHERE id = ?"
      ).run(new Date().toISOString(), selectedPlan, selectedSeatCount, hospital_name || null, hospital_state || null, bed_count || null, user.id);
      // Also update in-memory storage so the returned user object reflects the new plan
      storage.updateUserPlan(user.id, selectedPlan, user.studyCredits);
    } catch {}


    // Check if this user was invited as a seat (by token or by email)
    const { inviteToken: reqInviteToken } = req.body;
    let seatInvite: any = null;
    if (reqInviteToken) {
      seatInvite = (db as any).$client.prepare(
        "SELECT id, owner_user_id FROM user_seats WHERE invite_token = ? AND status = 'pending'"
      ).get(reqInviteToken) as any;
    }
    if (!seatInvite) {
      seatInvite = (db as any).$client.prepare(
        "SELECT id, owner_user_id FROM user_seats WHERE seat_email = ? AND status = 'pending'"
      ).get(email.toLowerCase()) as any;
    }
    // Also check if user is already an active seat (e.g. manually attached via admin)
    let activeSeat: any = null;
    if (!seatInvite) {
      activeSeat = (db as any).$client.prepare(
        "SELECT id, owner_user_id FROM user_seats WHERE seat_user_id = ? AND status = 'active' LIMIT 1"
      ).get(user.id) as any;
      if (!activeSeat) {
        activeSeat = (db as any).$client.prepare(
          "SELECT id, owner_user_id FROM user_seats WHERE seat_email = ? AND status = 'active' LIMIT 1"
        ).get(email.toLowerCase()) as any;
      }
    }
    let isSeatUser = false;
    let ownerPlan = selectedPlan;
    if (seatInvite) {
      (db as any).$client.prepare(
        "UPDATE user_seats SET seat_user_id = ?, status = 'active', accepted_at = ? WHERE id = ?"
      ).run(user.id, new Date().toISOString(), seatInvite.id);
      isSeatUser = true;
      // Get owner's plan so seat user inherits it
      const ownerRow = (db as any).$client.prepare("SELECT plan, lab_id FROM users WHERE id = ?").get(seatInvite.owner_user_id) as any;
      ownerPlan = ownerRow?.plan || selectedPlan;
      // Write owner's plan into seat user's DB record AND in-memory store
      // Also inherit owner's lab_id so seat user sees the same lab identity
      try {
        (db as any).$client.prepare("UPDATE users SET plan = ?, has_completed_onboarding = 1, lab_id = ? WHERE id = ?").run(ownerPlan, ownerRow?.lab_id || null, user.id);
        storage.updateUserPlan(user.id, ownerPlan, user.studyCredits);
      } catch {}
    } else if (activeSeat) {
      // User is already an active seat (e.g. manually attached via admin endpoint)
      isSeatUser = true;
      const ownerRow = (db as any).$client.prepare("SELECT plan, lab_id FROM users WHERE id = ?").get(activeSeat.owner_user_id) as any;
      ownerPlan = ownerRow?.plan || selectedPlan;
      // Ensure seat_user_id is linked, plan inherited, and onboarding skipped
      (db as any).$client.prepare(
        "UPDATE user_seats SET seat_user_id = ? WHERE id = ?"
      ).run(user.id, activeSeat.id);
      try {
        (db as any).$client.prepare("UPDATE users SET plan = ?, has_completed_onboarding = 1, lab_id = ? WHERE id = ?").run(ownerPlan, ownerRow?.lab_id || null, user.id);
        storage.updateUserPlan(user.id, ownerPlan, user.studyCredits);
      } catch {}
    }

    const token = signToken(user.id);

    // Create session
    const sessionToken = crypto.randomUUID();
    const now = new Date().toISOString();
    (db as any).$client.prepare(
      "INSERT INTO user_sessions (user_id, session_token, device_info, created_at, last_active, is_active) VALUES (?, ?, ?, ?, ?, 1)"
    ).run(user.id, sessionToken, req.headers["user-agent"] || "Unknown", now, now);

    const responsePlan = isSeatUser ? ownerPlan : selectedPlan;
    res.json({ token, session_token: sessionToken, user: { id: user.id, email: user.email, name: user.name, plan: responsePlan, studyCredits: user.studyCredits, hasCompletedOnboarding: isSeatUser ? true : false, isSeatUser, subscriptionExpiresAt: null, subscriptionStatus: responsePlan === 'free' ? 'free' : 'active', accessLevel: responsePlan === 'free' ? 'free' : 'paid', cliaNumber: null, cliaLabName: null, cliaTier: null, seatCount: isSeatUser ? 0 : selectedSeatCount } });

    // Send welcome email via Resend
    if (resend) {
      resend.emails.send({
        from: "VeritaAssure\u2122 <info@veritaslabservices.com>",
        to: [email],
        subject: "Welcome to VeritaAssure\u2122 - Your lab compliance platform is ready",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background: #ffffff;">
            <div style="background: #01696F; padding: 24px 28px; border-radius: 8px 8px 0 0;">
              <h1 style="color: #ffffff; font-size: 22px; margin: 0;">Welcome to VeritaAssure&#8482;</h1>
              <p style="color: rgba(255,255,255,0.85); font-size: 13px; margin: 6px 0 0;">Veritas Lab Services, LLC</p>
            </div>
            <div style="background: #f9fafb; padding: 28px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
              <p style="font-size: 15px; color: #1B2B2B; margin: 0 0 16px;">Hi ${name},</p>
              <p style="font-size: 14px; color: #374151; line-height: 1.6; margin: 0 0 16px;">
                Your VeritaAssure&#8482; account is active. The platform includes VeritaCheck&#8482; for EP method validation studies, VeritaMap&#8482; for test menu regulatory mapping, VeritaScan&#8482; for inspection readiness, VeritaComp&#8482; for competency management, VeritaStaff&#8482; for personnel tracking, and VeritaLab&#8482; for certificate monitoring.
              </p>
              <p style="font-size: 14px; color: #374151; line-height: 1.6; margin: 0 0 20px;">
                Start with the Getting Started guide to configure your lab in under an hour.
              </p>
              <a href="https://www.veritaslabservices.com/getting-started" style="display: inline-block; background: #01696F; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 600; padding: 12px 24px; border-radius: 6px; margin-bottom: 24px;">Get Started</a>
              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
              <p style="font-size: 13px; color: #6B7280; font-weight: 600; margin: 0 0 8px;">Free Downloads</p>
              <p style="font-size: 13px; color: #374151; line-height: 1.6; margin: 0 0 10px;">
                Before running your first compliance study, download the <strong>VeritaCheck&#8482; Software Validation Template</strong> to validate the tool for use in your lab. This is required by CAP GEN.20316, TJC QSA.15.01.01 EP1, and CLIA 42 CFR 493.1251 before using any software for compliance documentation.
              </p>
              <a href="https://www.veritaslabservices.com/api/downloads/software-validation-template" style="display: inline-block; background: #ffffff; color: #01696F; text-decoration: none; font-size: 13px; font-weight: 600; padding: 10px 20px; border-radius: 6px; border: 1px solid #01696F; margin-right: 8px; margin-bottom: 8px;">Download Validation Template</a>
              <a href="https://www.veritaslabservices.com/api/downloads/clsi-compliance-matrix" style="display: inline-block; background: #ffffff; color: #01696F; text-decoration: none; font-size: 13px; font-weight: 600; padding: 10px 20px; border-radius: 6px; border: 1px solid #01696F; margin-bottom: 8px;">Download CLSI Compliance Matrix</a>
              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
              <p style="font-size: 11px; color: #9CA3AF; line-height: 1.5; margin: 0;">
                VeritaAssure&#8482; is a statistical calculation tool. Results require interpretation by a licensed medical director or designee. Not medical advice. No PHI should be entered in any field.
                Final approval and clinical determination must be made by the laboratory director or designee.
                Veritas Lab Services, LLC, Massachusetts. info@veritaslabservices.com
              </p>
            </div>
          </div>
        `,
      }).catch((err: any) => console.error("[register] Welcome email failed:", err));
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { email, password } = parsed.data;
    const user = storage.getUserByEmail(email);
    if (!user) return res.status(401).json({ error: "Invalid email or password" });
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: "Invalid email or password" });

    const userRow = (db as any).$client.prepare("SELECT has_completed_onboarding, subscription_expires_at, subscription_status, clia_number, clia_lab_name, clia_tier, seat_count, onboarding_seen FROM users WHERE id = ?").get(user.id) as any;
    const hasCompletedOnboarding = userRow?.has_completed_onboarding ?? 1;

    // Check for seat access: user must be an account owner or have an active seat
    const isOwner = true; // The user logging in owns their own account
    const hasSeat = (db as any).$client.prepare(
      "SELECT id FROM user_seats WHERE seat_email = ? AND status = 'active'"
    ).get(email.toLowerCase());

    // Session conflict check
    const activeSession = (db as any).$client.prepare(
      "SELECT id, device_info, last_active FROM user_sessions WHERE user_id = ? AND is_active = 1 ORDER BY last_active DESC LIMIT 1"
    ).get(user.id) as any;

    const deviceInfo = req.headers["user-agent"] || "Unknown";

    // Resolve seat info
    const seatInfo = (db as any).$client.prepare(
      "SELECT owner_user_id, permissions FROM user_seats WHERE seat_user_id = ? AND status = 'active' LIMIT 1"
    ).get(user.id) as any;
    const isSeatUser = !!seatInfo;
    let seatPermissions: Record<string, string> | null = null;
    if (seatInfo) {
      try { seatPermissions = JSON.parse(seatInfo.permissions || '{}'); } catch { seatPermissions = {}; }
    }
    const ownerUserId = seatInfo?.owner_user_id ?? null;

    // For seat users, use the owner's plan and subscription fields
    let effectivePlan = user.plan;
    let effectiveSubExpiry = userRow?.subscription_expires_at || null;
    let effectiveSubStatus = userRow?.subscription_status || 'free';
    let effectiveSeatCount = userRow?.seat_count || 1;
    if (isSeatUser && ownerUserId) {
      const ownerRow = (db as any).$client.prepare(
        "SELECT plan, subscription_expires_at, subscription_status, seat_count FROM users WHERE id = ?"
      ).get(ownerUserId) as any;
      if (ownerRow) {
        effectivePlan = ownerRow.plan;
        effectiveSubExpiry = ownerRow.subscription_expires_at || null;
        effectiveSubStatus = ownerRow.subscription_status || 'free';
        effectiveSeatCount = ownerRow.seat_count || 1;
      }
    }

    if (activeSession) {
      // Return session conflict - let frontend handle the force-logout choice
      const token = signToken(user.id);
      return res.json({
        session_conflict: true,
        active_device: activeSession.device_info || "Unknown device",
        last_active: activeSession.last_active,
        message: "Another session is active on another device. Log out that device to continue.",
        token,
        user: {
          id: user.id, email: user.email, name: user.name, plan: effectivePlan,
          studyCredits: user.studyCredits, hasCompletedOnboarding: !!hasCompletedOnboarding,
          subscriptionExpiresAt: effectiveSubExpiry,
          subscriptionStatus: effectiveSubStatus,
          accessLevel: getAccessLevel({ subscription_expires_at: effectiveSubExpiry }),
          cliaNumber: userRow?.clia_number || null,
          cliaLabName: userRow?.clia_lab_name || null,
          cliaTier: userRow?.clia_tier || null,
          seatCount: effectiveSeatCount,
          onboardingSeen: !!(userRow?.onboarding_seen),
          isSeatUser,
          seatPermissions,
          ownerUserId,
        },
      });
    }

    // No conflict - create new session
    const sessionToken = crypto.randomUUID();
    const now = new Date().toISOString();
    (db as any).$client.prepare(
      "INSERT INTO user_sessions (user_id, session_token, device_info, created_at, last_active, is_active) VALUES (?, ?, ?, ?, ?, 1)"
    ).run(user.id, sessionToken, deviceInfo, now, now);

    const token = signToken(user.id);
    res.json({
      token, session_token: sessionToken,
      user: {
        id: user.id, email: user.email, name: user.name, plan: effectivePlan,
        studyCredits: user.studyCredits, hasCompletedOnboarding: !!hasCompletedOnboarding,
        subscriptionExpiresAt: effectiveSubExpiry,
        subscriptionStatus: effectiveSubStatus,
        accessLevel: getAccessLevel({ subscription_expires_at: effectiveSubExpiry }),
        cliaNumber: userRow?.clia_number || null,
        cliaLabName: userRow?.clia_lab_name || null,
        cliaTier: userRow?.clia_tier || null,
        seatCount: effectiveSeatCount,
        onboardingSeen: !!(userRow?.onboarding_seen),
        isSeatUser,
        seatPermissions,
        ownerUserId,
      },
    });
  });

  app.get("/api/auth/me", authMiddleware, (req: any, res) => {
    const user = storage.getUserById(req.userId);
    if (!user) return res.status(404).json({ error: "User not found" });
    const userRow = (db as any).$client.prepare("SELECT has_completed_onboarding, subscription_expires_at, subscription_status, clia_number, clia_lab_name, clia_tier, seat_count, onboarding_seen FROM users WHERE id = ?").get(user.id) as any;
    const hasCompletedOnboarding = userRow?.has_completed_onboarding ?? 1;

    // Update session last_active
    const sessionToken = req.headers["x-session-token"];
    if (sessionToken) {
      (db as any).$client.prepare("UPDATE user_sessions SET last_active = ? WHERE session_token = ? AND is_active = 1").run(new Date().toISOString(), sessionToken);
    }

    // Resolve seat info
    const seatInfo = (db as any).$client.prepare(
      "SELECT owner_user_id, permissions FROM user_seats WHERE seat_user_id = ? AND status = 'active' LIMIT 1"
    ).get(user.id) as any;
    const isSeatUser = !!seatInfo;
    let seatPermissions: Record<string, string> | null = null;
    if (seatInfo) {
      try { seatPermissions = JSON.parse(seatInfo.permissions || '{}'); } catch { seatPermissions = {}; }
    }
    const ownerUserId = seatInfo?.owner_user_id ?? null;

    // For seat users, resolve the owner's plan and subscription so they see the correct access level
    let effectivePlan = user.plan;
    let effectiveSubExpiry = userRow?.subscription_expires_at || null;
    let effectiveSubStatus = userRow?.subscription_status || 'free';
    let effectiveSeatCount = userRow?.seat_count || 1;
    if (isSeatUser && ownerUserId) {
      const ownerRow = (db as any).$client.prepare(
        "SELECT plan, subscription_expires_at, subscription_status, seat_count FROM users WHERE id = ?"
      ).get(ownerUserId) as any;
      if (ownerRow) {
        effectivePlan = ownerRow.plan;
        effectiveSubExpiry = ownerRow.subscription_expires_at || null;
        effectiveSubStatus = ownerRow.subscription_status || 'free';
        effectiveSeatCount = ownerRow.seat_count || 1;
      }
    }

    res.json({
      id: user.id, email: user.email, name: user.name, plan: effectivePlan,
      studyCredits: user.studyCredits, hasCompletedOnboarding: !!hasCompletedOnboarding,
      subscriptionExpiresAt: effectiveSubExpiry,
      subscriptionStatus: effectiveSubStatus,
      accessLevel: getAccessLevel({ subscription_expires_at: effectiveSubExpiry }),
      cliaNumber: userRow?.clia_number || null,
      cliaLabName: userRow?.clia_lab_name || null,
      cliaTier: userRow?.clia_tier || null,
      seatCount: effectiveSeatCount,
      onboardingSeen: !!(userRow?.onboarding_seen),
      isSeatUser,
      seatPermissions,
      ownerUserId,
    });
  });

  // ── STUDIES ───────────────────────────────────────────────────────────────
  app.get("/api/studies", (req, res) => {
    const auth = req.headers.authorization;
    if (auth?.startsWith("Bearer ")) {
      try {
        const payload = jwt.verify(auth.slice(7), JWT_SECRET) as { userId: number };
        // Check if seat user, use owner's data
        const seatRow = (db as any).$client.prepare(
          "SELECT owner_user_id FROM user_seats WHERE seat_user_id = ? AND status = 'active' LIMIT 1"
        ).get(payload.userId) as any;
        const dataUserId = seatRow ? seatRow.owner_user_id : payload.userId;
        // Return only studies owned by this user (or owner)
        const userStudies = storage.getStudiesByUser(dataUserId);
        userStudies.sort((a, b) => b.id - a.id);
        return res.json(userStudies);
      } catch {}
    }
    // Guest: return studies with no userId
    res.json(storage.getAllStudies().filter(s => !s.userId));
  });

  // ── My Studies XLSX export ──
  // Account-scoped (seat users see owner's studies). Plan allowlist: per_study, unlimited, clinic, community, hospital, enterprise.
  // Excluded: free, demo. Returns an XLSX workbook with a single Studies sheet styled per Excel Standard.
  app.get("/api/my-studies/export", async (req, res) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Authentication required" });
    }
    let payload: { userId: number };
    try {
      payload = jwt.verify(auth.slice(7), JWT_SECRET) as { userId: number };
    } catch {
      return res.status(401).json({ error: "Invalid or expired session" });
    }

    // Resolve seat user to owner for data scoping
    const seatRow = (db as any).$client.prepare(
      "SELECT owner_user_id FROM user_seats WHERE seat_user_id = ? AND status = 'active' LIMIT 1"
    ).get(payload.userId) as any;
    const dataUserId = seatRow ? seatRow.owner_user_id : payload.userId;

    // Plan allowlist (EXPLICIT, never blocklist)
    const ownerUser = storage.getUserById(dataUserId);
    if (!ownerUser) return res.status(404).json({ error: "Account not found" });
    const ALLOWED_EXPORT_PLANS = ["per_study", "unlimited", "clinic", "community", "hospital", "enterprise", "annual", "starter", "professional", "lab", "complete"];
    if (!ALLOWED_EXPORT_PLANS.includes(ownerUser.plan)) {
      return res.status(403).json({ error: "Studies export is not included in your current plan. Upgrade to enable." });
    }

    // Pull all studies for the account
    const userStudies = storage.getStudiesByUser(dataUserId);
    userStudies.sort((a, b) => b.id - a.id);

    // Lab name and CLIA from owner user record
    const labName = (ownerUser as any).cliaLabName || (ownerUser as any).clia_lab_name || ownerUser.name || "Laboratory";
    const cliaNumber = (ownerUser as any).cliaNumber || (ownerUser as any).clia_number || "Not on file";

    // Helpers
    const studyTypeLabel = (st: string): string => {
      switch (st) {
        case "cal_ver": return "Calibration Verification / Linearity";
        case "method_comparison":
        case "correlation": return "Correlation / Method Comparison";
        case "precision": return "Precision (EP15)";
        case "ref_interval": return "Reference Interval Verification";
        case "pt_coag": return "PT/Coag New Lot Validation";
        case "lot_to_lot": return "Lot-to-Lot Verification";
        case "qc_range": return "QC Range";
        case "multi_analyte_coag": return "Multi-Analyte Lot Comparison";
        case "cumsum": return "CUMSUM";
        default: return st;
      }
    };

    const teaApplied = (s: any): string => {
      const isPercent = s.teaIsPercentage !== 0;
      const tea = s.cliaAllowableError;
      if (isPercent) {
        const pct = (tea * 100).toFixed(1);
        if (s.cliaAbsoluteFloor != null && s.cliaAbsoluteUnit) {
          return `\u00B1${pct}% or ${s.cliaAbsoluteFloor} ${s.cliaAbsoluteUnit} (greater)`;
        }
        return `\u00B1${pct}%`;
      }
      const unit = s.teaUnit || "";
      return `\u00B1${tea} ${unit}`.trim();
    };

    const sampleCount = (s: any): number | string => {
      try {
        const dp = JSON.parse(s.dataPoints || "[]");
        if (Array.isArray(dp)) return dp.length;
        return "";
      } catch { return ""; }
    };

    const verdictLabel = (s: any): string => {
      const st = (s.status || "").toLowerCase();
      if (st === "pass") return "Pass";
      if (st === "fail") return "Fail";
      if (st === "completed") return "Completed";
      return s.status || "";
    };

    const reportLink = (s: any) => `https://www.veritaslabservices.com/study/${s.id}/results`;

    try {
      const { default: ExcelJS } = await import("exceljs");
      const wb = new ExcelJS.Workbook();
      wb.creator = "Perplexity Computer";
      wb.created = new Date();

      const ws = wb.addWorksheet("Studies");

      // Title block (rows 1-3)
      ws.mergeCells("A1:I1");
      ws.getCell("A1").value = `VeritaCheck\u2122 Studies Summary: ${labName}`;
      ws.getCell("A1").font = { name: "Calibri", bold: true, size: 14, color: { argb: "FF01696F" } };
      ws.getCell("A1").alignment = { vertical: "middle", horizontal: "left" };
      ws.getRow(1).height = 22;

      ws.mergeCells("A2:I2");
      const exportDate = new Date().toISOString().split("T")[0];
      ws.getCell("A2").value = `CLIA: ${cliaNumber}    \u2022    Exported: ${exportDate}    \u2022    ${userStudies.length} stud${userStudies.length === 1 ? "y" : "ies"}`;
      ws.getCell("A2").font = { name: "Calibri", italic: true, size: 10, color: { argb: "FF7A7974" } };
      ws.getCell("A2").alignment = { vertical: "middle", horizontal: "left" };

      ws.mergeCells("A3:I3");
      ws.getCell("A3").value = "Operational summary, not for regulatory submission. See per-study PDFs for audit-grade documentation.";
      ws.getCell("A3").font = { name: "Calibri", italic: true, size: 9, color: { argb: "FF7A7974" } };
      ws.getCell("A3").alignment = { vertical: "middle", horizontal: "left" };

      // Header row (row 4)
      const headers = ["Study #", "Date", "Analyte", "Study Type", "Instrument(s)", "N", "TEa Applied", "Verdict", "Report Link"];
      const colWidths = [10, 12, 28, 32, 36, 6, 28, 12, 56];
      const headerRow = ws.getRow(4);
      headers.forEach((h, i) => { headerRow.getCell(i + 1).value = h; });
      ws.columns = headers.map((_, i) => ({ width: colWidths[i] }));
      headerRow.height = 20;

      const thinBorder: any = {
        top: { style: "thin", color: { argb: "FFD0D0D0" } },
        bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
        left: { style: "thin", color: { argb: "FFD0D0D0" } },
        right: { style: "thin", color: { argb: "FFD0D0D0" } },
      };

      headerRow.eachCell((cell) => {
        cell.font = { name: "Calibri", bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF01696F" } };
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        cell.border = thinBorder;
      });

      // Data rows (row 5+)
      userStudies.forEach((s: any, idx: number) => {
        const r = 5 + idx;
        const row = ws.getRow(r);
        row.getCell(1).value = s.id;
        row.getCell(2).value = s.date || "";
        row.getCell(3).value = s.testName || "";
        row.getCell(4).value = studyTypeLabel(s.studyType);
        // Resolve VeritaMap-linked instrument display for Excel
        let excelInstrument = s.instrument || "";
        if (s.instrumentMeta) {
          try {
            const meta = typeof s.instrumentMeta === "string" ? JSON.parse(s.instrumentMeta) : s.instrumentMeta;
            const entry = meta["0"];
            if (entry?.instrument_id) {
              const row2 = (db as any).$client.prepare("SELECT instrument_name, nickname, serial_number FROM veritamap_instruments WHERE id = ?").get(entry.instrument_id) as any;
              const d = row2 || entry;
              const parts: string[] = [];
              if (d.nickname) { parts.push(`${d.instrument_name || d.model} (${d.nickname})`); } else { parts.push(d.instrument_name || d.model); }
              if (d.serial_number) parts.push(`S/N ${d.serial_number}`);
              excelInstrument = parts.join(", ");
            }
          } catch {}
        }
        row.getCell(5).value = excelInstrument;
        row.getCell(6).value = sampleCount(s);
        row.getCell(7).value = teaApplied(s);
        row.getCell(8).value = verdictLabel(s);
        const link = reportLink(s);
        row.getCell(9).value = { text: "View Report", hyperlink: link };

        const isEvenRow = (r % 2) === 0;
        const bgColor = isEvenRow ? "FFEBF3F8" : "FFFFFFFF";

        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          cell.font = cell.font || { name: "Calibri", color: { argb: "FF28251D" }, size: 10 };
          if (!cell.font.name) cell.font = { ...cell.font, name: "Calibri", size: 10 };
          cell.alignment = { vertical: "middle", wrapText: true };
          cell.border = thinBorder;
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };

          // Verdict color coding (col 8)
          if (colNumber === 8) {
            const v = String(cell.value || "");
            if (v === "Pass") {
              cell.font = { name: "Calibri", bold: true, color: { argb: "FF437A22" }, size: 10 };
            } else if (v === "Fail") {
              cell.font = { name: "Calibri", bold: true, color: { argb: "FFA12C7B" }, size: 10 };
            } else {
              cell.font = { name: "Calibri", color: { argb: "FF7A7974" }, size: 10 };
            }
            cell.alignment = { horizontal: "center", vertical: "middle" };
          }

          // Hyperlink styling (col 9)
          if (colNumber === 9) {
            cell.font = { name: "Calibri", color: { argb: "FF01696F" }, underline: true, size: 10 };
          }

          // Right-align N column (col 6)
          if (colNumber === 6) {
            cell.alignment = { horizontal: "center", vertical: "middle" };
          }

          // Center the Study # and Date columns
          if (colNumber === 1 || colNumber === 2) {
            cell.alignment = { horizontal: "center", vertical: "middle" };
          }
        });
      });

      // Freeze header rows + first column (Study #)
      ws.views = [{ state: "frozen" as const, xSplit: 1, ySplit: 4, topLeftCell: "B5" }];

      // Auto-filter on header row
      ws.autoFilter = { from: "A4", to: "I4" };

      // Empty-state: if no studies, show a friendly note in row 5
      if (userStudies.length === 0) {
        ws.mergeCells("A5:I5");
        ws.getCell("A5").value = "No studies on file for this account. Run a study from the Dashboard to populate this report.";
        ws.getCell("A5").font = { name: "Calibri", italic: true, size: 10, color: { argb: "FF7A7974" } };
        ws.getCell("A5").alignment = { vertical: "middle", horizontal: "left" };
      }

      // Footer row
      const footerRowNum = 5 + Math.max(userStudies.length, 1) + 1;
      ws.mergeCells(`A${footerRowNum}:I${footerRowNum}`);
      ws.getCell(`A${footerRowNum}`).value = "VeritaAssure\u2122 | VeritaCheck\u2122 | Confidential, For Internal Lab Use Only";
      ws.getCell(`A${footerRowNum}`).font = { name: "Calibri", italic: true, size: 8, color: { argb: "FF7A7974" } };
      ws.getCell(`A${footerRowNum}`).alignment = { vertical: "middle", horizontal: "center" };

      // Filename: VeritaCheck_Studies_<labname>_<YYYY-MM-DD>.xlsx
      const safeLabName = String(labName).replace(/[^a-zA-Z0-9_\- ]/g, "").trim().replace(/\s+/g, "_").slice(0, 60) || "Laboratory";
      const filename = `VeritaCheck_Studies_${safeLabName}_${exportDate}.xlsx`;

      const buffer = await wb.xlsx.writeBuffer();
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Cache-Control", "no-store");
      res.send(Buffer.from(buffer as ArrayBuffer));
    } catch (err: any) {
      console.error("My Studies export failed:", err);
      res.status(500).json({ error: "Export failed. Please try again." });
    }
  });

  app.get("/api/studies/:id", (req, res) => {
    const study = storage.getStudy(parseInt(req.params.id));
    if (!study) return res.status(404).json({ error: "Study not found" });

    // If study belongs to a user, verify the requester is that user (or their seat user)
    if (study.userId) {
      const auth = req.headers.authorization;
      if (!auth?.startsWith("Bearer ")) {
        return res.status(403).json({ error: "This study requires authentication" });
      }
      try {
        const payload = jwt.verify(auth.slice(7), JWT_SECRET) as { userId: number };
        const seatRow = (db as any).$client.prepare(
          "SELECT owner_user_id FROM user_seats WHERE seat_user_id = ? AND status = 'active' LIMIT 1"
        ).get(payload.userId) as any;
        const effectiveUserId = seatRow ? seatRow.owner_user_id : payload.userId;
        if (effectiveUserId !== study.userId) {
          return res.status(403).json({ error: "Access denied" });
        }
      } catch {
        return res.status(403).json({ error: "Invalid or expired session" });
      }
    }

    res.json(study);
  });

  app.post("/api/studies", (req, res) => {
    const parsed = insertStudySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    // Attach userId if authenticated
    let userId: number | null = null;
    const auth = req.headers.authorization;
    if (auth?.startsWith("Bearer ")) {
      try {
        const payload = jwt.verify(auth.slice(7), JWT_SECRET) as { userId: number };
        // Check seat permissions for veritacheck write access
        const seatRow = (db as any).$client.prepare(
          "SELECT owner_user_id, permissions FROM user_seats WHERE seat_user_id = ? AND status = 'active' LIMIT 1"
        ).get(payload.userId) as any;
        if (seatRow) {
          let perms: Record<string, string> = {};
          try { perms = JSON.parse(seatRow.permissions || '{}'); } catch {}
          if ((perms.veritacheck || 'view') !== 'edit') {
            return res.status(403).json({ error: "You have view-only access to veritacheck. Ask the account owner to grant edit access." });
          }
        }
        userId = seatRow ? seatRow.owner_user_id : payload.userId;
        // Check subscription write access for authenticated users
        const fullUser = storage.getUserById(seatRow ? seatRow.owner_user_id : payload.userId);
        if (fullUser) {
          const accessLevel = getAccessLevel(fullUser);
          if (accessLevel === 'read_only') {
            const expiry = new Date(fullUser.subscriptionExpiresAt!);
            const retentionEnd = new Date(expiry);
            retentionEnd.setFullYear(retentionEnd.getFullYear() + 2);
            return res.status(403).json({ error: "Your subscription has expired. Your data is available in read-only mode for 2 years. Resubscribe to add new records.", code: "SUBSCRIPTION_EXPIRED_READ_ONLY", retentionEndsAt: retentionEnd.toISOString() });
          }
          if (accessLevel === 'locked') {
            return res.status(403).json({ error: "Your data retention period has ended. Please resubscribe to regain access to your account.", code: "DATA_RETENTION_EXPIRED" });
          }
        }
      } catch {}
    }

    // Server-side pass/fail verification: recompute from data instead of trusting the client
    const verifiedStatus = computeStudyStatus(
      parsed.data.studyType,
      parsed.data.dataPoints,
      parsed.data.instruments,
      parsed.data.cliaAllowableError,
      (parsed.data as any).teaIsPercentage !== 0,
      (parsed.data as any).cliaAbsoluteFloor ?? null
    );
    const study = storage.createStudy({ ...parsed.data, status: verifiedStatus, userId });

    // VeritaCheck → VeritaScan integration bridge
    try {
      autoCompleteVeritaScanItems({
        id: study.id,
        userId: study.userId,
        testName: study.testName,
        studyType: study.studyType,
        instruments: study.instruments,
      });
    } catch (err: any) {
      console.error("[integration] VeritaScan auto-complete error:", err.message);
    }

    res.status(201).json(study);
  });

  app.delete("/api/studies/:id", authMiddleware, requireWriteAccess, requireModuleEdit('veritacheck'), (req: any, res) => {
    const studyId = parseInt(req.params.id);
    const delStudy = (db as any).$client.prepare("SELECT id, user_id, test_name, study_type, analyst, date FROM studies WHERE id = ?").get(studyId) as any;
    if (!delStudy) return res.status(404).json({ error: "Study not found" });
    // Tenant ownership check: caller (or their seat owner) must own this study.
    // Legacy guest studies (user_id IS NULL) are not deletable via this route.
    const callerOwnerId = req.ownerUserId ?? req.userId;
    if (delStudy.user_id == null || delStudy.user_id !== callerOwnerId) {
      return res.status(403).json({ error: "Access denied" });
    }
    logAudit({ userId: req.userId, ownerUserId: callerOwnerId, module: "veritacheck", action: "delete", entityType: "study", entityId: req.params.id, entityLabel: delStudy ? `${delStudy.test_name} - ${delStudy.study_type} (${delStudy.date})` : undefined, before: delStudy, ipAddress: req.ip });
    storage.deleteStudy(studyId);
    res.json({ success: true });
  });

  console.log('[routes] Route registration checkpoint: studies+auth routes OK, registering PDF and remaining routes...');

  // ── PDF GENERATION ────────────────────────────────────────────────────────
  // Accepts { study, results } JSON, returns a PDF binary.
  // Auth optional — guests can generate PDFs for studies they can view.
  app.post("/api/generate-pdf", async (req: any, res) => {
    try {
      const { study, results } = req.body;
      if (!study || typeof study !== "object" || !results || typeof results !== "object") {
        return res.status(400).json({ error: "study and results must be JSON objects" });
      }
      // Fetch CLIA number from labs table if authenticated, falling back to user record
      let cliaNumber: string | undefined;
      let cliaLabName: string | undefined;
      let preferredStandards: string[] | undefined;
      let resolvedLabId: number | null = null;
      const auth = req.headers.authorization;
      if (auth?.startsWith("Bearer ")) {
        try {
          const payload = jwt.verify(auth.slice(7), JWT_SECRET) as { userId: number };
          // Try labs table first (new model)
          const lab = resolveLabForUser(payload.userId);
          if (lab) {
            resolvedLabId = lab.id;
            cliaNumber = lab.clia_number || undefined;
            cliaLabName = lab.lab_name || undefined;
            const standards: string[] = [];
            if (lab.accreditation_cap) standards.push("CAP");
            if (lab.accreditation_tjc) standards.push("TJC");
            if (lab.accreditation_cola) standards.push("COLA");
            if (lab.accreditation_aabb) standards.push("AABB");
            if (standards.length > 0) preferredStandards = standards;
          } else {
            // Fallback: read from user record (pre-migration data)
            const seatRow = (db as any).$client.prepare(
              "SELECT owner_user_id FROM user_seats WHERE seat_user_id = ? AND status = 'active' LIMIT 1"
            ).get(payload.userId) as any;
            const effectiveUserId = seatRow ? seatRow.owner_user_id : payload.userId;
            const userRow = (db as any).$client.prepare("SELECT clia_number, clia_lab_name, preferred_standards FROM users WHERE id = ?").get(effectiveUserId) as any;
            cliaNumber = userRow?.clia_number || undefined;
            cliaLabName = userRow?.clia_lab_name || undefined;
            if (userRow?.preferred_standards) {
              try { preferredStandards = JSON.parse(userRow.preferred_standards); } catch {}
            }
          }
        } catch {}
      }

      if (cliaLabName) { (study as any)._labName = cliaLabName; }

      // Resolve VeritaMap-linked instrument data for report rendering
      if (study.instrumentMeta) {
        try {
          const meta = typeof study.instrumentMeta === "string" ? JSON.parse(study.instrumentMeta) : study.instrumentMeta;
          const resolved: Record<string, { model: string; nickname: string | null; serial_number: string | null }> = {};
          for (const [idx, entry] of Object.entries(meta) as [string, any][]) {
            if (entry?.instrument_id) {
              const row = (db as any).$client.prepare("SELECT instrument_name, nickname, serial_number FROM veritamap_instruments WHERE id = ?").get(entry.instrument_id) as any;
              if (row) {
                resolved[idx] = { model: row.instrument_name, nickname: row.nickname || null, serial_number: row.serial_number || null };
              } else {
                resolved[idx] = { model: entry.model, nickname: entry.nickname, serial_number: entry.serial_number };
              }
            }
          }
          (study as any)._instrumentDisplay = resolved;
        } catch {}
      }

      const pdfBuffer = await generatePDFBuffer(study, results, cliaNumber, preferredStandards as any);
      const typeMap: Record<string, string> = { cal_ver: "CalVer", precision: "Precision", method_comparison: "MethodComp", lot_to_lot: "LotToLot", pt_coag: "PTCoag" };
      const filename = `VeritaCheck_${typeMap[study.studyType] || "Study"}_${study.testName.replace(/\s+/g, "_")}_${study.date}.pdf`;
      // Store in token cache so client can use a direct GET URL (bypasses Adobe interception)
      const pdfToken = storePdfToken(pdfBuffer, filename);

      // Lock CLIA/lab name on first successful report generation
      if (resolvedLabId) markLabReportingLocks(resolvedLabId);

      res.json({ token: pdfToken });
    } catch (err: any) {
      console.error("PDF generation error:", err.message);
      res.status(500).json({ error: "PDF generation failed", detail: err.message });
    }
  });


  // ── PDF TOKEN DOWNLOAD ───────────────────────────────────────────────────
  // Client POSTs to generate-pdf, gets a token, then navigates browser directly
  // to this GET endpoint.  Browser handles download natively - no blob:// URL,
  // no Adobe Acrobat interception.
  app.get("/api/pdf/:token", (req, res) => {
    const entry = pdfTokenStore.get(req.params.token);
    if (!entry || entry.expires < Date.now()) {
      pdfTokenStore.delete(req.params.token);
      return res.status(404).json({ error: "PDF token expired or not found" });
    }
    pdfTokenStore.delete(req.params.token); // one-time use
    const encoded = encodeURIComponent(entry.filename);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${entry.filename}"; filename*=UTF-8''${encoded}`);
    res.setHeader("Content-Length", entry.buffer.length);
    res.setHeader("Cache-Control", "no-store");
    res.send(entry.buffer);
  });

  // ── CONTACT ───────────────────────────────────────────────────────────────
  app.post("/api/contact", (req, res) => {
    const parsed = insertContactSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    storage.createContactMessage(parsed.data);
    res.json({ success: true });
  });

  // ── VERITAMAP ───────────────────────────────────────────────────────────

  function hasMapAccess(user: any) {
    return ["annual", "professional", "lab", "complete", "veritamap", "waived", "community", "hospital", "large_hospital", "enterprise"].includes(user?.plan);
  }

  // List maps
  app.get("/api/veritamap/maps", authMiddleware, (req: any, res) => {
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const maps = (db as any).$client.prepare(
      "SELECT id, name, instruments, created_at, updated_at FROM veritamap_maps WHERE user_id = ? ORDER BY updated_at DESC"
    ).all(dataUserId);
    const result = maps.map((m: any) => {
      const tests = (db as any).$client.prepare(
        "SELECT active, last_cal_ver, last_method_comp, complexity FROM veritamap_tests WHERE map_id = ?"
      ).all(m.id);
      const activeTests = tests.filter((t: any) => t.active);
      const gaps = activeTests.filter((t: any) =>
        (t.complexity === 'MODERATE' || t.complexity === 'HIGH') &&
        (!t.last_cal_ver || !t.last_method_comp)
      ).length;
      return { ...m, totalTests: activeTests.length, gaps };
    });
    res.json(result);
  });

  // Create map
  app.post("/api/veritamap/maps", authMiddleware, requireWriteAccess, requireModuleEdit('veritamap'), (req: any, res) => {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "Map name required" });
    const now = new Date().toISOString();
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const result = (db as any).$client.prepare(
      "INSERT INTO veritamap_maps (user_id, name, instruments, created_at, updated_at) VALUES (?, ?, '[]', ?, ?)"
    ).run(dataUserId, name.trim(), now, now);
    res.json({ id: Number(result.lastInsertRowid), name: name.trim(), created_at: now, updated_at: now });
  });

  // Delete map
  app.delete("/api/veritamap/maps/:id", authMiddleware, requireWriteAccess, requireModuleEdit('veritamap'), (req: any, res) => {
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const map = (db as any).$client.prepare("SELECT id FROM veritamap_maps WHERE id = ? AND user_id = ?").get(req.params.id, dataUserId);
    if (!map) return res.status(404).json({ error: "Map not found" });
    const delMap = (db as any).$client.prepare("SELECT * FROM veritamap_maps WHERE id = ?").get(req.params.id) as any;
    const delMapInstrs = (db as any).$client.prepare("SELECT * FROM veritamap_instruments WHERE map_id = ?").all(req.params.id);
    logAudit({ userId: req.userId, ownerUserId: req.ownerUserId ?? req.userId, module: "veritamap", action: "delete", entityType: "map", entityId: req.params.id, entityLabel: delMap?.name, before: { map: delMap, instruments: delMapInstrs }, ipAddress: req.ip });
    (db as any).$client.prepare("DELETE FROM veritamap_tests WHERE map_id = ?").run(req.params.id);
    (db as any).$client.prepare("DELETE FROM veritamap_maps WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  });

  // Get map with all tests
  app.get("/api/veritamap/maps/:id", authMiddleware, (req: any, res) => {
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const map = (db as any).$client.prepare("SELECT * FROM veritamap_maps WHERE id = ? AND user_id = ?").get(req.params.id, dataUserId);
    if (!map) return res.status(404).json({ error: "Map not found" });
    // Fetch tests with per-analyte instrument list (needed for intelligence/correlation)
    const rawTests = (db as any).$client.prepare("SELECT * FROM veritamap_tests WHERE map_id = ? ORDER BY specialty, analyte").all(req.params.id);
    // For each test, attach the list of instruments running it
    const instrByAnalyte = (db as any).$client.prepare(`
      SELECT it.analyte, i.id, i.instrument_name, i.role, i.category, i.serial_number
      FROM veritamap_instrument_tests it
      JOIN veritamap_instruments i ON i.id = it.instrument_id
      WHERE it.map_id = ? AND it.active = 1
    `).all(req.params.id);
    const instrMap: Record<string, any[]> = {};
    for (const row of instrByAnalyte) {
      if (!instrMap[row.analyte]) instrMap[row.analyte] = [];
      instrMap[row.analyte].push({ id: row.id, instrument_name: row.instrument_name, role: row.role, category: row.category, serial_number: row.serial_number || null });
    }
    const tests = rawTests.map((t: any) => ({ ...t, instruments: instrMap[t.analyte] ?? [] }));
    res.json({ ...map, tests });
  });

  // Bulk upsert tests (used when building from instrument or updating)
  app.put("/api/veritamap/maps/:id/tests", authMiddleware, requireWriteAccess, requireModuleEdit('veritamap'), (req: any, res) => {
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const map = (db as any).$client.prepare("SELECT id FROM veritamap_maps WHERE id = ? AND user_id = ?").get(req.params.id, dataUserId);
    if (!map) return res.status(404).json({ error: "Map not found" });
    const { tests } = req.body;
    if (!Array.isArray(tests)) return res.status(400).json({ error: "tests array required" });
    const now = new Date().toISOString();
    const stmt = (db as any).$client.prepare(`
      INSERT INTO veritamap_tests (map_id, analyte, specialty, complexity, active, instrument_source,
        last_cal_ver, last_method_comp, last_precision, last_sop_review, notes, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(map_id, analyte) DO UPDATE SET
        specialty=excluded.specialty, complexity=excluded.complexity, active=excluded.active,
        instrument_source=excluded.instrument_source, last_cal_ver=excluded.last_cal_ver,
        last_method_comp=excluded.last_method_comp, last_precision=excluded.last_precision,
        last_sop_review=excluded.last_sop_review, notes=excluded.notes, updated_at=excluded.updated_at
    `);
    const bulk = (db as any).$client.transaction((tests: any[]) => {
      for (const t of tests) {
        const active = typeof t.active === 'boolean' ? (t.active ? 1 : 0) : (t.active ?? 1);
        stmt.run(req.params.id, t.analyte, t.specialty, t.complexity,
          active, t.instrument_source ?? null,
          t.last_cal_ver ?? null, t.last_method_comp ?? null,
          t.last_precision ?? null, t.last_sop_review ?? null,
          t.notes ?? null, now);
      }
    });
    bulk(tests);
    (db as any).$client.prepare("UPDATE veritamap_maps SET updated_at = ? WHERE id = ?").run(now, req.params.id);
    res.json({ ok: true, count: tests.length });
  });

  // ── INSTRUMENTS ───────────────────────────────────────────────

  // Get all VeritaMap instruments for the current user's lab (used by VeritaCheck picker)
  // Returns map_id and map_name so the picker can group by map and disambiguate
  // duplicate models across maps (large hospitals may keep separate maps for
  // Chemistry, Hematology, etc.).
  app.get("/api/veritacheck/lab-instruments", authMiddleware, (req: any, res) => {
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const instruments = (db as any).$client.prepare(
      `SELECT i.id, i.instrument_name, i.serial_number, i.nickname, i.role, i.category,
              i.map_id, m.name AS map_name
       FROM veritamap_instruments i
       JOIN veritamap_maps m ON m.id = i.map_id
       WHERE m.user_id = ?
       ORDER BY m.name, i.instrument_name, i.id`
    ).all(dataUserId);
    res.json(instruments);
  });

  // Get all instruments for a map
  app.get("/api/veritamap/maps/:id/instruments", authMiddleware, (req: any, res) => {
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const map = (db as any).$client.prepare("SELECT id FROM veritamap_maps WHERE id = ? AND user_id = ?").get(req.params.id, dataUserId);
    if (!map) return res.status(404).json({ error: "Map not found" });
    const instruments = (db as any).$client.prepare(
      "SELECT * FROM veritamap_instruments WHERE map_id = ? ORDER BY role, instrument_name"
    ).all(req.params.id);
    // For each instrument, get its tests
    const result = instruments.map((inst: any) => {
      const tests = (db as any).$client.prepare(
        "SELECT analyte, specialty, complexity, active FROM veritamap_instrument_tests WHERE instrument_id = ?"
      ).all(inst.id);
      return { ...inst, tests };
    });
    res.json(result);
  });

  // Add instrument to map
  app.post("/api/veritamap/maps/:id/instruments", authMiddleware, requireWriteAccess, requireModuleEdit('veritamap'), (req: any, res) => {
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const map = (db as any).$client.prepare("SELECT id FROM veritamap_maps WHERE id = ? AND user_id = ?").get(req.params.id, dataUserId);
    if (!map) return res.status(404).json({ error: "Map not found" });
    // Freemium limit: 4 instruments per map for free users
    if (!hasMapAccess(req.user)) {
      const count = (db as any).$client.prepare("SELECT COUNT(*) as cnt FROM veritamap_instruments WHERE map_id = ?").get(req.params.id).cnt;
      if (count >= 4) return res.status(403).json({ error: "Free plan limit: upgrade to add more than 4 instruments", limitReached: true, limit: 4, type: "instruments" });
    }
    const { instrument_name, role, category, serial_number, nickname } = req.body;
    if (!instrument_name?.trim()) return res.status(400).json({ error: "Instrument name required" });
    const now = new Date().toISOString();
    const result = (db as any).$client.prepare(
      "INSERT INTO veritamap_instruments (map_id, instrument_name, role, category, serial_number, nickname, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(req.params.id, instrument_name.trim(), role || 'Primary', category || 'Chemistry', serial_number?.trim() || null, nickname?.trim() || null, now);
    res.json({ id: Number(result.lastInsertRowid), instrument_name: instrument_name.trim(), role: role || 'Primary', category: category || 'Chemistry', serial_number: serial_number?.trim() || null, nickname: nickname?.trim() || null, tests: [] });
  });

  // Update instrument role/name
  app.put("/api/veritamap/maps/:id/instruments/:instId", authMiddleware, requireWriteAccess, requireModuleEdit('veritamap'), (req: any, res) => {
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const map = (db as any).$client.prepare("SELECT id FROM veritamap_maps WHERE id = ? AND user_id = ?").get(req.params.id, dataUserId);
    if (!map) return res.status(404).json({ error: "Map not found" });
    const { instrument_name, role, category, serial_number, nickname } = req.body;
    (db as any).$client.prepare(
      "UPDATE veritamap_instruments SET instrument_name=?, role=?, category=?, serial_number=?, nickname=? WHERE id=? AND map_id=?"
    ).run(instrument_name, role, category, serial_number?.trim() || null, nickname?.trim() || null, req.params.instId, req.params.id);
    res.json({ ok: true });
  });

  // Delete instrument (cascades to its tests)
  app.delete("/api/veritamap/maps/:id/instruments/:instId", authMiddleware, requireWriteAccess, requireModuleEdit('veritamap'), (req: any, res) => {
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const map = (db as any).$client.prepare("SELECT id FROM veritamap_maps WHERE id = ? AND user_id = ?").get(req.params.id, dataUserId);
    if (!map) return res.status(404).json({ error: "Map not found" });
    const delInstr = (db as any).$client.prepare("SELECT * FROM veritamap_instruments WHERE id = ? AND map_id = ?").get(req.params.instId, req.params.id) as any;
    const delInstTests = (db as any).$client.prepare("SELECT * FROM veritamap_instrument_tests WHERE instrument_id = ?").all(req.params.instId);
    logAudit({ userId: req.userId, ownerUserId: req.ownerUserId ?? req.userId, module: "veritamap", action: "delete", entityType: "instrument", entityId: req.params.instId, entityLabel: delInstr?.instrument_name, before: { instrument: delInstr, tests: delInstTests }, ipAddress: req.ip });
    // Remove any AMR values keyed to this instrument so they cannot resurface
    // on a re-added instrument with the same id space.
    (db as any).$client.prepare("DELETE FROM veritamap_amr_values WHERE map_id = ? AND instrument_id = ?").run(req.params.id, req.params.instId);
    (db as any).$client.prepare("DELETE FROM veritamap_instrument_tests WHERE instrument_id = ?").run(req.params.instId);
    (db as any).$client.prepare("DELETE FROM veritamap_instruments WHERE id = ? AND map_id = ?").run(req.params.instId, req.params.id);
    // Reconcile veritamap_tests against remaining instruments so any analyte
    // that was only on the deleted instrument is purged from the map and from
    // the Excel export. Without this, deleted-instrument analytes persist as
    // orphans (the bug behind cortisol showing in John's lab export and the
    // 5600 -> MEDTOX cross-contamination).
    rebuildMapTests(req.params.id);
    res.json({ ok: true });
  });

  // Copy test menu from one instrument to another (merge - skip existing analytes)
  app.post("/api/veritamap/maps/:id/instruments/:instId/copy-from/:sourceInstId",
    authMiddleware, requireWriteAccess, requireModuleEdit('veritamap'),
    (req: any, res) => {
      try {
        const dataUserId = req.ownerUserId ?? req.user.userId;
        const mapId = parseInt(req.params.id);
        const targetInstId = parseInt(req.params.instId);
        const sourceInstId = parseInt(req.params.sourceInstId);

        // Verify map belongs to user
        const map = (db as any).$client.prepare(
          "SELECT id FROM veritamap_maps WHERE id = ? AND user_id = ?"
        ).get(mapId, dataUserId);
        if (!map) return res.status(404).json({ error: "Map not found" });

        // Verify both instruments belong to this map
        const targetInst = (db as any).$client.prepare(
          "SELECT id FROM veritamap_instruments WHERE id = ? AND map_id = ?"
        ).get(targetInstId, mapId);
        const sourceInst = (db as any).$client.prepare(
          "SELECT id, instrument_name FROM veritamap_instruments WHERE id = ? AND map_id = ?"
        ).get(sourceInstId, mapId) as any;
        if (!targetInst || !sourceInst) return res.status(404).json({ error: "Instrument not found" });

        // Get all tests from source instrument
        const sourceTests = (db as any).$client.prepare(
          "SELECT * FROM veritamap_instrument_tests WHERE instrument_id = ? AND map_id = ?"
        ).all(sourceInstId, mapId) as any[];

        // Get existing analytes on target (to skip duplicates)
        const existingAnalytes = new Set(
          ((db as any).$client.prepare(
            "SELECT analyte FROM veritamap_instrument_tests WHERE instrument_id = ? AND map_id = ?"
          ).all(targetInstId, mapId) as any[]).map((r: any) => r.analyte.toLowerCase().trim())
        );

        // Insert missing tests (merge only, skip if analyte already exists on target)
        let copied = 0;
        let skipped = 0;

        const insertStmt = (db as any).$client.prepare(
          "INSERT OR IGNORE INTO veritamap_instrument_tests (instrument_id, map_id, analyte, specialty, complexity, active) VALUES (?, ?, ?, ?, ?, ?)"
        );

        for (const t of sourceTests) {
          if (existingAnalytes.has((t.analyte || '').toLowerCase().trim())) {
            skipped++;
            continue;
          }
          insertStmt.run(targetInstId, mapId, t.analyte, t.specialty, t.complexity, t.active ?? 1);
          copied++;
        }

        // Rebuild merged map tests
        rebuildMapTests(mapId);

        res.json({
          ok: true,
          sourceInstrumentName: sourceInst.instrument_name,
          copied,
          skipped,
          message: `Copied ${copied} test${copied !== 1 ? 's' : ''} from ${sourceInst.instrument_name}. ${skipped} already present and skipped.`
        });
      } catch (err: any) {
        console.error(`[VeritaMap] Error copying instrument tests:`, err);
        res.status(500).json({ error: err.message || "Failed to copy tests" });
      }
    }
  );

  // Set tests for an instrument (replaces all)
  app.put("/api/veritamap/maps/:id/instruments/:instId/tests", authMiddleware, requireWriteAccess, requireModuleEdit('veritamap'), (req: any, res) => {
    try {
      const dataUserId = req.ownerUserId ?? req.user.userId;
      const map = (db as any).$client.prepare("SELECT id FROM veritamap_maps WHERE id = ? AND user_id = ?").get(req.params.id, dataUserId);
      if (!map) return res.status(404).json({ error: "Map not found" });
      const { tests } = req.body; // [{ analyte, specialty, complexity, active }]
      if (!Array.isArray(tests)) return res.status(400).json({ error: "tests array required" });
      console.log(`[VeritaMap] Saving ${tests.length} tests for instrument ${req.params.instId} on map ${req.params.id}`);
      // Freemium limit: 10 total analytes across all instruments for free users
      if (!hasMapAccess(req.user)) {
        // Count active analytes from OTHER instruments (not the one being replaced)
        const otherCount = (db as any).$client.prepare(
          "SELECT COUNT(*) as cnt FROM veritamap_instrument_tests WHERE map_id = ? AND instrument_id != ? AND active = 1"
        ).get(req.params.id, req.params.instId).cnt;
        const newActive = tests.filter((t: any) => t.active !== 0 && t.active !== false).length;
        if (otherCount + newActive > 10) return res.status(403).json({ error: "Free plan limit: upgrade to add more than 10 analytes", limitReached: true, limit: 10, type: "analytes", current: otherCount + newActive });
      }
      // Capture before state for audit log
      const beforeTests = (db as any).$client.prepare(
        "SELECT analyte, specialty, complexity, active FROM veritamap_instrument_tests WHERE instrument_id = ?"
      ).all(req.params.instId);
      const instrRow = (db as any).$client.prepare("SELECT instrument_name FROM veritamap_instruments WHERE id = ?").get(req.params.instId) as any;
      logAudit({
        userId: req.userId,
        ownerUserId: req.ownerUserId ?? req.userId,
        module: "veritamap",
        action: beforeTests.length === 0 ? "create" : "update",
        entityType: "instrument_tests",
        entityId: req.params.instId,
        entityLabel: instrRow?.instrument_name ?? `instrument_${req.params.instId}`,
        before: beforeTests,
        after: tests,
        ipAddress: req.ip,
      });
      // Replace all tests for this instrument
      (db as any).$client.prepare("DELETE FROM veritamap_instrument_tests WHERE instrument_id = ?").run(req.params.instId);
      const stmt = (db as any).$client.prepare(
        "INSERT OR IGNORE INTO veritamap_instrument_tests (instrument_id, map_id, analyte, specialty, complexity, active) VALUES (?, ?, ?, ?, ?, ?)"
      );
      const bulk = (db as any).$client.transaction((tests: any[]) => {
        for (const t of tests) {
          const active = typeof t.active === 'boolean' ? (t.active ? 1 : 0) : (t.active ?? 1);
          stmt.run(req.params.instId, req.params.id, String(t.analyte || ''), String(t.specialty || ''), String(t.complexity || ''), active);
        }
      });
      bulk(tests);
      // Rebuild the merged veritamap_tests from all instruments
      rebuildMapTests(req.params.id);
      const savedCount = (db as any).$client.prepare("SELECT COUNT(*) as cnt FROM veritamap_instrument_tests WHERE instrument_id = ? AND map_id = ?").get(req.params.instId, req.params.id).cnt;
      console.log(`[VeritaMap] Saved ${savedCount} instrument tests, rebuilding map tests`);
      const mapTestCount = (db as any).$client.prepare("SELECT COUNT(*) as cnt FROM veritamap_tests WHERE map_id = ?").get(req.params.id).cnt;
      console.log(`[VeritaMap] Map ${req.params.id} now has ${mapTestCount} total tests in veritamap_tests`);
      res.json({ ok: true, count: tests.length });
    } catch (err: any) {
      console.error(`[VeritaMap] Error saving instrument tests:`, err);
      res.status(500).json({ error: err.message || "Failed to save tests" });
    }
  });

  // Intelligence endpoint: compute correlation + cal ver requirements
  app.get("/api/veritamap/maps/:id/intelligence", authMiddleware, (req: any, res) => {
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const map = (db as any).$client.prepare("SELECT id FROM veritamap_maps WHERE id = ? AND user_id = ?").get(req.params.id, dataUserId);
    if (!map) return res.status(404).json({ error: "Map not found" });

    // Get all active instrument-test pairs
    const rows = (db as any).$client.prepare(`
      SELECT it.analyte, it.specialty, it.complexity,
             i.instrument_name, i.role, i.id as instrument_id
      FROM veritamap_instrument_tests it
      JOIN veritamap_instruments i ON i.id = it.instrument_id
      WHERE it.map_id = ? AND it.active = 1
    `).all(req.params.id);

    // Group by analyte
    const byAnalyte: Record<string, any[]> = {};
    for (const row of rows) {
      if (!byAnalyte[row.analyte]) byAnalyte[row.analyte] = [];
      byAnalyte[row.analyte].push(row);
    }

    const intelligence: Record<string, any> = {};
    for (const [analyte, instruments] of Object.entries(byAnalyte)) {
      const complexity = instruments[0].complexity;
      const isWaived = complexity === 'WAIVED';
      const correlationRequired = instruments.length >= 2;
      const calVerRequired = !isWaived;

      intelligence[analyte] = {
        complexity,
        isWaived,
        calVerRequired,
        calVerFrequency: calVerRequired ? 'Every 6 months (42 CFR §493.1255)' : 'Exempt - waived test',
        correlationRequired,
        correlationReason: correlationRequired
          ? `${instruments.length} instruments performing this test (${instruments.map((i: any) => `${i.instrument_name} [${i.role}]`).join(', ')}) - 42 CFR §493.1213, TJC QSA.04.05.01`
          : null,
        instruments: instruments.map((i: any) => ({ name: i.instrument_name, role: i.role, id: i.instrument_id })),
      };
    }

    // Summary counts
    const correlationCount = Object.values(intelligence).filter((i: any) => i.correlationRequired).length;
    const calVerCount = Object.values(intelligence).filter((i: any) => i.calVerRequired).length;

    res.json({ intelligence, correlationCount, calVerCount, totalAnalytes: Object.keys(intelligence).length });
  });

  // Freemium limits info for a map
  app.get("/api/veritamap/maps/:id/limits", authMiddleware, (req: any, res) => {
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const map = (db as any).$client.prepare("SELECT id FROM veritamap_maps WHERE id = ? AND user_id = ?").get(req.params.id, dataUserId);
    if (!map) return res.status(404).json({ error: "Map not found" });
    const isFree = !hasMapAccess(req.user);
    const instrumentCount = (db as any).$client.prepare("SELECT COUNT(*) as cnt FROM veritamap_instruments WHERE map_id = ?").get(req.params.id).cnt;
    const analyteCount = (db as any).$client.prepare("SELECT COUNT(*) as cnt FROM veritamap_instrument_tests WHERE map_id = ? AND active = 1").get(req.params.id).cnt;
    res.json({
      isFree,
      instrumentCount,
      analyteCount,
      instrumentLimit: isFree ? 4 : null,
      analyteLimit: isFree ? 10 : null,
    });
  });

  // Helper: rebuild merged map tests from instrument tests
  function rebuildMapTests(mapId: string | number) {
    // Source of truth: any analyte that is active on at least one instrument
    // currently attached to this map. Anything else must not appear in
    // veritamap_tests, and must not appear in the Excel export.
    const rows = (db as any).$client.prepare(`
      SELECT DISTINCT it.analyte, it.specialty, it.complexity, i.instrument_name
      FROM veritamap_instrument_tests it
      JOIN veritamap_instruments i ON i.id = it.instrument_id
      WHERE it.map_id = ? AND it.active = 1
    `).all(mapId);
    const now = new Date().toISOString();
    const activeAnalytes = new Set(rows.map((r: any) => r.analyte));

    // 1. Insert any newly-active analyte that doesn't have a row yet
    //    (preserves existing date/notes/active state for analytes that are
    //     already present and still backed).
    const insertStmt = (db as any).$client.prepare(`
      INSERT OR IGNORE INTO veritamap_tests
        (map_id, analyte, specialty, complexity, active, instrument_source, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)
    `);

    // 2. Delete any veritamap_tests row that is no longer backed by an
    //    active instrument-test on this map. This is the fix for orphan
    //    analytes that previously persisted after toggle-off, instrument
    //    delete, or wrong-menu import + delete (e.g. 5600 -> MEDTOX).
    //    Also clear orphan analyte_values and AMR values so the export
    //    cannot pull stale lab-entered numbers back in either.
    const existingRows = (db as any).$client.prepare(
      "SELECT analyte FROM veritamap_tests WHERE map_id = ?"
    ).all(mapId) as { analyte: string }[];
    const orphanAnalytes = existingRows
      .map((r) => r.analyte)
      .filter((a) => !activeAnalytes.has(a));

    const deleteTestStmt = (db as any).$client.prepare(
      "DELETE FROM veritamap_tests WHERE map_id = ? AND analyte = ?"
    );
    const deleteAnalyteValStmt = (db as any).$client.prepare(
      "DELETE FROM veritamap_analyte_values WHERE map_id = ? AND analyte = ?"
    );
    const deleteAmrValStmt = (db as any).$client.prepare(
      "DELETE FROM veritamap_amr_values WHERE map_id = ? AND analyte = ?"
    );

    const bulk = (db as any).$client.transaction((newRows: any[], orphans: string[]) => {
      for (const r of newRows) {
        insertStmt.run(mapId, r.analyte, r.specialty, r.complexity, r.instrument_name, now);
      }
      for (const a of orphans) {
        deleteTestStmt.run(mapId, a);
        deleteAnalyteValStmt.run(mapId, a);
        deleteAmrValStmt.run(mapId, a);
      }
    });
    bulk(rows, orphanAnalytes);

    if (orphanAnalytes.length > 0) {
      console.log(`[VeritaMap] rebuildMapTests removed ${orphanAnalytes.length} orphan analyte(s) from map ${mapId}: ${orphanAnalytes.slice(0, 10).join(', ')}${orphanAnalytes.length > 10 ? '…' : ''}`);
    }
  }

  // Update single test
  app.put("/api/veritamap/maps/:id/tests/:analyte", authMiddleware, requireWriteAccess, requireModuleEdit('veritamap'), (req: any, res) => {
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const map = (db as any).$client.prepare("SELECT id FROM veritamap_maps WHERE id = ? AND user_id = ?").get(req.params.id, dataUserId);
    if (!map) return res.status(404).json({ error: "Map not found" });
    const { active: rawActive, last_cal_ver, last_method_comp, last_precision, last_sop_review, notes } = req.body;
    const active = typeof rawActive === 'boolean' ? (rawActive ? 1 : 0) : rawActive;
    const now = new Date().toISOString();
    (db as any).$client.prepare(`
      UPDATE veritamap_tests SET active=?, last_cal_ver=?, last_method_comp=?,
        last_precision=?, last_sop_review=?, notes=?, updated_at=?
      WHERE map_id=? AND analyte=?
    `).run(active, last_cal_ver ?? null, last_method_comp ?? null,
      last_precision ?? null, last_sop_review ?? null, notes ?? null, now,
      req.params.id, decodeURIComponent(req.params.analyte));
    (db as any).$client.prepare("UPDATE veritamap_maps SET updated_at = ? WHERE id = ?").run(now, req.params.id);
    res.json({ ok: true });
  });

  // ── VERITAMAP EXCEL EXPORT ────────────────────────────────────────────────
  app.post("/api/veritamap/maps/:id/excel", authMiddleware, async (req: any, res) => {
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const map = (db as any).$client.prepare("SELECT * FROM veritamap_maps WHERE id = ? AND user_id = ?").get(req.params.id, dataUserId);
    if (!map) return res.status(404).json({ error: "Map not found" });
    if (!hasMapAccess(req.user)) return res.status(403).json({ error: "VeritaMap\u2122 subscription required" });

    // Reconcile orphans on every export. This is the safety net: even if the
    // boot-time migration didn't run (e.g. just-deployed instance, or this
    // map was modified through a path that bypassed rebuildMapTests), the
    // export itself purges any veritamap_tests row not backed by an active
    // instrument-test before it queries.
    rebuildMapTests(req.params.id);

    // Fetch tests (same as map detail endpoint)
    const rawTests = (db as any).$client.prepare("SELECT * FROM veritamap_tests WHERE map_id = ? AND active = 1 ORDER BY specialty, analyte").all(req.params.id);
    const instrByAnalyte = (db as any).$client.prepare(`
      SELECT it.analyte, i.id, i.instrument_name, i.role, i.category, i.serial_number
      FROM veritamap_instrument_tests it
      JOIN veritamap_instruments i ON i.id = it.instrument_id
      WHERE it.map_id = ? AND it.active = 1
    `).all(req.params.id);
    const instrMap: Record<string, any[]> = {};
    for (const row of instrByAnalyte) {
      if (!instrMap[row.analyte]) instrMap[row.analyte] = [];
      instrMap[row.analyte].push(row);
    }
    const tests = rawTests.map((t: any) => ({ ...t, instruments: instrMap[t.analyte] ?? [] }));

    // Fetch lab-entered analyte values and AMR values
    const analyteValuesRaw = (db as any).$client.prepare(
      "SELECT * FROM veritamap_analyte_values WHERE map_id = ?"
    ).all(req.params.id);
    const analyteValuesMap: Record<string, any> = {};
    for (const av of analyteValuesRaw) analyteValuesMap[av.analyte] = av;

    const amrValuesRaw = (db as any).$client.prepare(
      "SELECT * FROM veritamap_amr_values WHERE map_id = ?"
    ).all(req.params.id);
    // Key: `${instrumentId}::${analyte}`
    const amrValuesMap: Record<string, any> = {};
    for (const av of amrValuesRaw) amrValuesMap[`${av.instrument_id}::${av.analyte}`] = av;

    // Sort by Department → Specialty → Analyte (A-Z)
    tests.sort((a: any, b: any) => {
      const catA = (a.instruments[0]?.category || "").toLowerCase();
      const catB = (b.instruments[0]?.category || "").toLowerCase();
      if (catA !== catB) return catA.localeCompare(catB);
      const specA = (a.specialty || "").toLowerCase();
      const specB = (b.specialty || "").toLowerCase();
      if (specA !== specB) return specA.localeCompare(specB);
      return (a.analyte || "").toLowerCase().localeCompare((b.analyte || "").toLowerCase());
    });

    try {
      const { default: ExcelJS } = await import("exceljs");
      const wb = new ExcelJS.Workbook();

      // ── Sheet 1: Compliance Map ──
      const ws = wb.addWorksheet("Compliance Map");

      const headers = [
        "Analyte", "Instruments", "Serial Number", "Department", "Specialty", "Complexity",
        "Number of Instruments", "CFR Section", "Correlation Required",
        "Units of Measure", "Reference Range Low", "Reference Range High",
        "Critical Low", "Critical High",
        "AMR Low", "AMR High (per instrument)",
        "Last Calibration Verification Date", "Calibration Verification Status",
        "Last Correlation / Method Comparison Date", "Correlation / Method Comparison Status",
        "Last Precision Date", "Precision Status", "Last SOP Review Date", "SOP Review Status",
        "Notes",
      ];

      // Column widths
      const colWidths = [
        22, 55, 20, 18, 20, 14, 22, 14, 20,
        18, 20, 20, 16, 16, 16, 22,
        30, 28, 36, 36, 18, 18, 18, 18, 30,
      ];
      ws.columns = headers.map((h, i) => ({ header: h, key: `col${i}`, width: colWidths[i] ?? 18 }));

      const NE = "Not established"; // shown when lab hasn't entered a value

      // Build data rows
      const rows = tests.map((t: any) => {
        const instruments = t.instruments || [];
        const instrList = instruments.map((i: any) => `${i.instrument_name} [${i.role}]`).join("; ");
        const serialList = instruments.map((i: any) => i.serial_number || "").filter((s: string) => s).join("; ");
        const instrCount = instruments.length;
        const department = instruments[0]?.category || t.specialty || "";
        const isWaived = t.complexity === "WAIVED";
        const correlReq = !isWaived && instrCount >= 2 ? "Yes" : "No";
        const cfr = VERITAMAP_CFR_MAP[t.specialty] ?? "§493.945";
        const calVerStatus = isWaived ? "N/A (Waived)" : getComplianceStatus(t.last_cal_ver, 6);
        const mcStatus = isWaived ? "N/A (Waived)" : getComplianceStatus(t.last_method_comp, 6);
        const precStatus = isWaived ? "N/A (Waived)" : getComplianceStatus(t.last_precision, 6);
        const sopStatus = getComplianceStatus(t.last_sop_review, 24);

        // Lab-entered analyte values
        const av = analyteValuesMap[t.analyte];
        const units = av?.units || NE;
        const refLow = av?.ref_range_low || NE;
        const refHigh = av?.ref_range_high || NE;
        const critLow = av?.critical_low || NE;
        const critHigh = av?.critical_high || NE;

        // AMR: one entry per instrument that runs this analyte
        const amrLines = instruments.map((inst: any) => {
          const amrEntry = amrValuesMap[`${inst.id}::${t.analyte}`];
          const lo = amrEntry?.amr_low || NE;
          const hi = amrEntry?.amr_high || NE;
          return `${inst.instrument_name}: ${lo} - ${hi}`;
        }).join("; ");

        return [
          t.analyte,
          instrList,
          serialList,
          department,
          t.specialty,
          t.complexity,
          instrCount,
          cfr,
          correlReq,
          units,
          refLow,
          refHigh,
          critLow,
          critHigh,
          amrLines || NE,
          "", // AMR High (per instrument) -- shown inline in AMR Low column above
          t.last_cal_ver || "",
          calVerStatus,
          t.last_method_comp || "",
          mcStatus,
          t.last_precision || "",
          precStatus,
          t.last_sop_review || "",
          sopStatus,
          t.notes || "",
        ];
      });

      // Add data rows
      for (const row of rows) {
        ws.addRow(row);
      }

      // Shared border style
      const thinBorder: any = {
        top: { style: "thin", color: { argb: "FFD0D0D0" } },
        bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
        left: { style: "thin", color: { argb: "FFD0D0D0" } },
        right: { style: "thin", color: { argb: "FFD0D0D0" } },
      };

      // ── Header row (row 1) ──
      const headerRow = ws.getRow(1);
      headerRow.height = 20;
      headerRow.eachCell((cell) => {
        cell.font = { name: "Calibri", bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF01696F" } };
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        cell.border = thinBorder;
      });

      // ── Data rows (row 2 onward) ──
      const statusCols = [18, 20, 22, 24]; // 1-indexed: Cal Ver Status, Method Comp Status, Precision Status, SOP Status
      const dateCols = [17, 19, 21, 23];   // 1-indexed: date columns
      const numCol = 7; // 1-indexed: Number of Instruments
      const complexityCol = 6; // 1-indexed: Complexity
      const correlCol = 9;     // 1-indexed: Correlation Required
      const neCols = [10, 11, 12, 13, 14, 15]; // 1-indexed: columns that may show 'Not established'
      for (let r = 2; r <= rows.length + 1; r++) {
        const row = ws.getRow(r);
        const isEvenRow = r % 2 === 0; // row 2=even, row 3=odd, ...
        const bgColor = isEvenRow ? "FFEBF3F8" : "FFFFFFFF";

        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          // Base styling
          cell.font = { name: "Calibri", color: { argb: "FF28251D" }, size: 10 };
          cell.alignment = { vertical: "middle", wrapText: true };
          cell.border = thinBorder;

          // Alternating row background
          let fillColor = bgColor;

          // Not established values -- muted gray text
          if (neCols.includes(colNumber) && String(cell.value || "") === "Not established") {
            cell.font = { name: "Calibri", italic: true, color: { argb: "FF7A7974" }, size: 10 };
          }

          // Complexity column color coding
          if (colNumber === complexityCol) {
            const val = String(cell.value || "");
            if (val === "HIGH") {
              cell.font = { name: "Calibri", bold: true, color: { argb: "FF437A22" }, size: 10 };
            } else if (val === "MODERATE") {
              cell.font = { name: "Calibri", bold: true, color: { argb: "FF964219" }, size: 10 };
            } else if (val === "WAIVED") {
              cell.font = { name: "Calibri", color: { argb: "FF7A7974" }, size: 10 };
            }
          }

          // Correlation Required color coding
          if (colNumber === correlCol) {
            const val = String(cell.value || "");
            if (val === "Yes") {
              cell.font = { name: "Calibri", bold: true, color: { argb: "FF437A22" }, size: 10 };
            } else if (val === "No") {
              cell.font = { name: "Calibri", color: { argb: "FF7A7974" }, size: 10 };
            }
          }

          // Status columns: color-code based on value
          if (statusCols.includes(colNumber)) {
            const val = String(cell.value || "");
            if (/Overdue|Expired/i.test(val)) {
              cell.font = { name: "Calibri", bold: true, color: { argb: "FFA12C7B" }, size: 10 };
            } else if (/Due Soon|Pending|In Progress/i.test(val)) {
              cell.font = { name: "Calibri", bold: true, color: { argb: "FF964219" }, size: 10 };
            } else if (/Compliant|Current|Pass/i.test(val)) {
              cell.font = { name: "Calibri", bold: true, color: { argb: "FF437A22" }, size: 10 };
            } else if (/N\/A|Not Required/i.test(val)) {
              cell.font = { name: "Calibri", color: { argb: "FF7A7974" }, size: 10 };
            } else if (val === "Missing") {
              cell.font = { name: "Calibri", color: { argb: "FF7A7974" }, size: 10 };
            }
          }

          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillColor } };

          // Date columns — center align
          if (dateCols.includes(colNumber)) {
            cell.alignment = { horizontal: "center", vertical: "middle" };
          }

          // Number of Instruments — right align
          if (colNumber === numCol) {
            cell.alignment = { horizontal: "right", vertical: "middle" };
          }
        });
      }

      // ── Add notes to lab-entered value header cells ──
      const labNote = "CLIA requires each laboratory to establish and verify these values for their specific instruments and patient population. Values shown are lab-entered only. \"Not established\" indicates the lab has not yet entered a value.";
      for (const col of [10, 11, 12, 13, 14, 15]) {
        headerRow.getCell(col).note = labNote;
      }



      // Freeze pane at C2: cols A-B frozen + header row frozen
      ws.views = [{ state: "frozen" as const, xSplit: 2, ySplit: 1, topLeftCell: "C2" }];

      // Auto-filter on all columns
      // Convert column number to Excel letter(s) (1=A, 27=AA, etc.)
      const lastColNum = headers.length;
      const lastColLetter = lastColNum <= 26
        ? String.fromCharCode(64 + lastColNum)
        : String.fromCharCode(64 + Math.floor((lastColNum - 1) / 26)) + String.fromCharCode(65 + ((lastColNum - 1) % 26));
      ws.autoFilter = { from: "A1", to: `${lastColLetter}1` };

      // ── Sheet 2: Instructions ──
      const ws2 = wb.addWorksheet("Instructions");
      ws2.getColumn(1).width = 100;
      for (const instrRow of INSTRUCTIONS_CONTENT) {
        ws2.addRow(instrRow);
      }
      // Style the title row
      const titleCell = ws2.getCell("A1");
      titleCell.font = { bold: true, size: 14, color: { argb: "FF01696F" } };

      // Write to buffer
      const buffer = await wb.xlsx.writeBuffer();
      const safeName = (map.name || "Map").replace(/[^a-zA-Z0-9_\- ]/g, "").trim();
      const date = new Date().toISOString().split("T")[0];
      const filename = `VeritaMap_${safeName}_${date}.xlsx`;

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(Buffer.from(buffer));
    } catch (e: any) {
      console.error("VeritaMap Excel generation error:", e);
      res.status(500).json({ error: "Excel generation failed" });
    }
  });

  // ── VERITAMAP ANALYTE VALUES ─────────────────────────────────────────────
  // GET all analyte values for a map
  app.get("/api/veritamap/maps/:id/analyte-values", authMiddleware, (req: any, res) => {
    if (!hasMapAccess(req.user)) return res.status(403).json({ error: "VeritaMap\u2122 subscription required" });
    const mapId = Number(req.params.id);
    const values = (db as any).$client.prepare(
      "SELECT * FROM veritamap_analyte_values WHERE map_id = ? ORDER BY analyte"
    ).all(mapId);
    res.json(values);
  });

  // PUT (upsert) analyte values for a specific analyte
  app.put("/api/veritamap/maps/:id/analyte-values/:analyte", authMiddleware, requireWriteAccess, requireModuleEdit('veritamap'), (req: any, res) => {
    if (!hasMapAccess(req.user)) return res.status(403).json({ error: "VeritaMap\u2122 subscription required" });
    const mapId = Number(req.params.id);
    const analyte = decodeURIComponent(req.params.analyte);
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const map = (db as any).$client.prepare(
      "SELECT id FROM veritamap_maps WHERE id = ? AND user_id = ?"
    ).get(mapId, dataUserId);
    if (!map) return res.status(404).json({ error: "Map not found" });
    const { ref_range_low, ref_range_high, critical_low, critical_high, units } = req.body;
    const now = new Date().toISOString();
    (db as any).$client.prepare(`
      INSERT INTO veritamap_analyte_values (map_id, analyte, ref_range_low, ref_range_high, critical_low, critical_high, units, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(map_id, analyte) DO UPDATE SET
        ref_range_low = excluded.ref_range_low,
        ref_range_high = excluded.ref_range_high,
        critical_low = excluded.critical_low,
        critical_high = excluded.critical_high,
        units = excluded.units,
        updated_at = excluded.updated_at
    `).run(mapId, analyte, ref_range_low || null, ref_range_high || null, critical_low || null, critical_high || null, units || null, now);
    const row = (db as any).$client.prepare(
      "SELECT * FROM veritamap_analyte_values WHERE map_id = ? AND analyte = ?"
    ).get(mapId, analyte);
    res.json(row);
  });

  // GET all AMR values for a map
  app.get("/api/veritamap/maps/:id/amr-values", authMiddleware, (req: any, res) => {
    if (!hasMapAccess(req.user)) return res.status(403).json({ error: "VeritaMap\u2122 subscription required" });
    const mapId = Number(req.params.id);
    const values = (db as any).$client.prepare(
      "SELECT * FROM veritamap_amr_values WHERE map_id = ? ORDER BY analyte, instrument_id"
    ).all(mapId);
    res.json(values);
  });

  // PUT (upsert) AMR values for a specific instrument + analyte
  app.put("/api/veritamap/maps/:id/amr-values/:instId/:analyte", authMiddleware, requireWriteAccess, requireModuleEdit('veritamap'), (req: any, res) => {
    if (!hasMapAccess(req.user)) return res.status(403).json({ error: "VeritaMap\u2122 subscription required" });
    const mapId = Number(req.params.id);
    const instrumentId = Number(req.params.instId);
    const analyte = decodeURIComponent(req.params.analyte);
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const map = (db as any).$client.prepare(
      "SELECT id FROM veritamap_maps WHERE id = ? AND user_id = ?"
    ).get(mapId, dataUserId);
    if (!map) return res.status(404).json({ error: "Map not found" });
    const { amr_low, amr_high } = req.body;
    const now = new Date().toISOString();
    (db as any).$client.prepare(`
      INSERT INTO veritamap_amr_values (map_id, instrument_id, analyte, amr_low, amr_high, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(map_id, instrument_id, analyte) DO UPDATE SET
        amr_low = excluded.amr_low,
        amr_high = excluded.amr_high,
        updated_at = excluded.updated_at
    `).run(mapId, instrumentId, analyte, amr_low || null, amr_high || null, now);
    const row = (db as any).$client.prepare(
      "SELECT * FROM veritamap_amr_values WHERE map_id = ? AND instrument_id = ? AND analyte = ?"
    ).get(mapId, instrumentId, analyte);
    res.json(row);
  });

  // ── VERITASCAN ───────────────────────────────────────────────────────────

  // Check access: annual, lab, or veritascan plan
  function hasScanAccess(user: any) {
    return ["annual", "professional", "lab", "complete", "veritascan", "waived", "community", "hospital", "large_hospital", "enterprise"].includes(user?.plan);
  }

  // List scans for current user
  app.get("/api/veritascan/scans", authMiddleware, (req: any, res) => {
    if (!hasScanAccess(req.user)) return res.status(403).json({ error: "VeritaScan\u2122 subscription required" });
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const scans = (db as any).$client.prepare(
      "SELECT id, name, created_at, updated_at FROM veritascan_scans WHERE user_id = ? ORDER BY updated_at DESC"
    ).all(dataUserId);
    // For each scan, add completion stats
    const result = scans.map((s: any) => {
      const items = (db as any).$client.prepare(
        "SELECT status FROM veritascan_items WHERE scan_id = ?"
      ).all(s.id);
      const total = 168;
      const assessed = items.filter((i: any) => i.status !== 'Not Assessed').length;
      const compliant = items.filter((i: any) => i.status === 'Compliant').length;
      const issues = items.filter((i: any) => ['Needs Attention','Immediate Action'].includes(i.status)).length;
      return { ...s, total, assessed, compliant, issues };
    });
    res.json(result);
  });

  // Create new scan
  app.post("/api/veritascan/scans", authMiddleware, requireWriteAccess, requireModuleEdit('veritascan'), (req: any, res) => {
    if (!hasScanAccess(req.user)) return res.status(403).json({ error: "VeritaScan\u2122 subscription required" });
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "Scan name required" });
    const now = new Date().toISOString();
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const result = (db as any).$client.prepare(
      "INSERT INTO veritascan_scans (user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)"
    ).run(dataUserId, name.trim(), now, now);
    res.json({ id: Number(result.lastInsertRowid), name: name.trim(), created_at: now, updated_at: now });
  });

  // Delete scan
  app.delete("/api/veritascan/scans/:id", authMiddleware, requireWriteAccess, requireModuleEdit('veritascan'), (req: any, res) => {
    if (!hasScanAccess(req.user)) return res.status(403).json({ error: "VeritaScan\u2122 subscription required" });
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const scan = (db as any).$client.prepare("SELECT id FROM veritascan_scans WHERE id = ? AND user_id = ?").get(req.params.id, dataUserId);
    if (!scan) return res.status(404).json({ error: "Scan not found" });
    const delScan = (db as any).$client.prepare("SELECT * FROM veritascan_scans WHERE id = ?").get(req.params.id) as any;
    const delScanItems = (db as any).$client.prepare("SELECT item_id, status, notes FROM veritascan_items WHERE scan_id = ?").all(req.params.id);
    logAudit({ userId: req.userId, ownerUserId: req.ownerUserId ?? req.userId, module: "veritascan", action: "delete", entityType: "scan", entityId: req.params.id, entityLabel: delScan?.name, before: { scan: delScan, items: delScanItems }, ipAddress: req.ip });
    (db as any).$client.prepare("DELETE FROM veritascan_items WHERE scan_id = ?").run(req.params.id);
    (db as any).$client.prepare("DELETE FROM veritascan_scans WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  });

  // Get all items for a scan
  app.get("/api/veritascan/scans/:id/items", authMiddleware, (req: any, res) => {
    if (!hasScanAccess(req.user)) return res.status(403).json({ error: "VeritaScan\u2122 subscription required" });
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const scan = (db as any).$client.prepare("SELECT id FROM veritascan_scans WHERE id = ? AND user_id = ?").get(req.params.id, dataUserId);
    if (!scan) return res.status(404).json({ error: "Scan not found" });
    const items = (db as any).$client.prepare(
      "SELECT item_id, status, notes, owner, due_date, completion_source, completion_link, completion_note FROM veritascan_items WHERE scan_id = ?"
    ).all(req.params.id);
    res.json(items);
  });

  // Upsert item status/notes/owner/due_date
  app.put("/api/veritascan/scans/:id/items/:itemId", authMiddleware, requireWriteAccess, requireModuleEdit('veritascan'), (req: any, res) => {
    if (!hasScanAccess(req.user)) return res.status(403).json({ error: "VeritaScan\u2122 subscription required" });
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const scan = (db as any).$client.prepare("SELECT id FROM veritascan_scans WHERE id = ? AND user_id = ?").get(req.params.id, dataUserId);
    if (!scan) return res.status(404).json({ error: "Scan not found" });
    const { status, notes, owner, due_date } = req.body;
    const now = new Date().toISOString();
    (db as any).$client.prepare(`
      INSERT INTO veritascan_items (scan_id, item_id, status, notes, owner, due_date, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scan_id, item_id) DO UPDATE SET
        status = excluded.status,
        notes = excluded.notes,
        owner = excluded.owner,
        due_date = excluded.due_date,
        updated_at = excluded.updated_at
    `).run(req.params.id, req.params.itemId, status || 'Not Assessed', notes || null, owner || null, due_date || null, now);
    // Update scan updated_at
    (db as any).$client.prepare("UPDATE veritascan_scans SET updated_at = ? WHERE id = ?").run(now, req.params.id);
    res.json({ ok: true });
  });

  // Bulk update items (for efficient auto-save)
  app.put("/api/veritascan/scans/:id/items", authMiddleware, requireWriteAccess, requireModuleEdit('veritascan'), (req: any, res) => {
    if (!hasScanAccess(req.user)) return res.status(403).json({ error: "VeritaScan\u2122 subscription required" });
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const scan = (db as any).$client.prepare("SELECT id FROM veritascan_scans WHERE id = ? AND user_id = ?").get(req.params.id, dataUserId);
    if (!scan) return res.status(404).json({ error: "Scan not found" });
    const { items } = req.body; // Array of { item_id, status, notes, owner, due_date }
    if (!Array.isArray(items)) return res.status(400).json({ error: "items array required" });
    const now = new Date().toISOString();
    const stmt = (db as any).$client.prepare(`
      INSERT INTO veritascan_items (scan_id, item_id, status, notes, owner, due_date, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scan_id, item_id) DO UPDATE SET
        status = excluded.status, notes = excluded.notes,
        owner = excluded.owner, due_date = excluded.due_date,
        updated_at = excluded.updated_at
    `);
    const bulkUpdate = (db as any).$client.transaction((items: any[]) => {
      for (const item of items) {
        // Accept both camelCase (client) and snake_case field names
        const itemId = item.item_id ?? item.itemId;
        const dueDate = item.due_date ?? item.dueDate ?? null;
        stmt.run(req.params.id, itemId, item.status || 'Not Assessed', item.notes || null, item.owner || null, dueDate, now);
      }
    });
    bulkUpdate(items);
    (db as any).$client.prepare("UPDATE veritascan_scans SET updated_at = ? WHERE id = ?").run(now, req.params.id);
    res.json({ ok: true, count: items.length });
  });

  // ── VERITASCAN EXCEL EXPORT ──────────────────────────────────────────────
  app.post("/api/veritascan/excel/:scanId", authMiddleware, async (req: any, res) => {
    if (!hasScanAccess(req.user)) return res.status(403).json({ error: "VeritaScan\u2122 subscription required" });
    const scanId = req.params.scanId;
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const scan = (db as any).$client.prepare("SELECT id, name, created_at, updated_at FROM veritascan_scans WHERE id = ? AND user_id = ?").get(scanId, dataUserId);
    if (!scan) return res.status(404).json({ error: "Scan not found" });

    // Get saved items from DB
    const dbItems = (db as any).$client.prepare(
      "SELECT item_id, status, notes, owner, due_date FROM veritascan_items WHERE scan_id = ?"
    ).all(scanId);
    const itemMap: Record<number, any> = {};
    for (const row of dbItems) {
      itemMap[row.item_id] = row;
    }

    // Client sends the reference data (questions, citations) so server doesn't need to duplicate it
    const { referenceItems } = req.body; // Array of { id, domain, question, tjc, cap, cfr, aabb, cola }
    if (!Array.isArray(referenceItems) || referenceItems.length === 0) {
      return res.status(400).json({ error: "referenceItems array required" });
    }

    // Phase 3.6 (2026-05-03): resolve preferred_standards for dynamic accreditor columns
    let xlsxPreferredStandards: string[] = [];
    const xlsxLab = resolveLabForUser(req.userId);
    if (xlsxLab) {
      if (xlsxLab.accreditation_cap) xlsxPreferredStandards.push("CAP");
      if (xlsxLab.accreditation_tjc) xlsxPreferredStandards.push("TJC");
      if (xlsxLab.accreditation_cola) xlsxPreferredStandards.push("COLA");
      if (xlsxLab.accreditation_aabb) xlsxPreferredStandards.push("AABB");
    } else {
      const xlsxUserRow = (db as any).$client.prepare("SELECT preferred_standards FROM users WHERE id = ?").get(req.userId) as any;
      if (xlsxUserRow?.preferred_standards) {
        try { xlsxPreferredStandards = JSON.parse(xlsxUserRow.preferred_standards) || []; } catch {}
      }
    }

    type AccreditorCol = { key: "tjc" | "cap" | "aabb" | "cola"; label: string };
    const xlsxSelected: AccreditorCol[] = [];
    if (xlsxPreferredStandards.includes("TJC")) xlsxSelected.push({ key: "tjc", label: "TJC Standard" });
    if (xlsxPreferredStandards.includes("CAP")) xlsxSelected.push({ key: "cap", label: "CAP Requirement" });
    if (xlsxPreferredStandards.includes("AABB")) xlsxSelected.push({ key: "aabb", label: "AABB Standard" });
    if (xlsxPreferredStandards.includes("COLA")) xlsxSelected.push({ key: "cola", label: "COLA Criterion" });

    try {
      const { default: ExcelJS } = await import("exceljs");
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("VeritaScan");

      // Column order: # / Domain / Question / CFR / <accreditor(s) by selection> / Status / Owner / Due / Notes
      const accreditorHeaders = xlsxSelected.map(a => a.label);
      const accreditorWidths = xlsxSelected.map(() => 22);
      const headers = [
        "Item #", "Domain", "Compliance Question", "42 CFR Citation",
        ...accreditorHeaders,
        "Status", "Owner", "Due Date", "Notes"
      ];

      // Column widths matching the header order
      const colWidths = [10, 28, 80, 24, ...accreditorWidths, 18, 20, 16, 40];
      ws.columns = headers.map((h, i) => ({ header: h, key: `col${i}`, width: colWidths[i] }));

      // Build data rows
      const dataRows = referenceItems.map((ref: any) => {
        const saved = itemMap[ref.id] || {};
        // Phase 3.6 fallback: if client omitted an accreditor field (stale
        // bundle), pull it from the authoritative server-side SCAN_ITEMS.
        const authoritative = VERITASCAN_ITEM_BY_ID[ref.id] || {};
        const accreditorCells = xlsxSelected.map(a => {
          const v = ref[a.key] || authoritative[a.key];
          return v && v !== "N/A" ? v : "";
        });
        return [
          ref.id,
          ref.domain,
          ref.question,
          ref.cfr || authoritative.cfr || "",
          ...accreditorCells,
          saved.status || "Not Assessed",
          saved.owner || "",
          saved.due_date || "",
          saved.notes || "",
        ];
      });
      for (const row of dataRows) {
        ws.addRow(row);
      }

      // Shared border style
      const thinBorder: any = {
        top: { style: "thin", color: { argb: "FFD0D0D0" } },
        bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
        left: { style: "thin", color: { argb: "FFD0D0D0" } },
        right: { style: "thin", color: { argb: "FFD0D0D0" } },
      };

      // ── Header row (row 1) ──
      const headerRow = ws.getRow(1);
      headerRow.height = 20;
      headerRow.eachCell((cell) => {
        cell.font = { name: "Calibri", bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF01696F" } };
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        cell.border = thinBorder;
      });

      // ── Data rows (row 2 onward) ──
      // Column indices shift with the dynamic accreditor columns; status/date are
      // computed off the final headers array so this stays correct for any
      // accreditation_choice selection.
      const statusCol = headers.indexOf("Status") + 1; // 1-indexed
      const dateCol = headers.indexOf("Due Date") + 1; // 1-indexed
      for (let r = 2; r <= dataRows.length + 1; r++) {
        const row = ws.getRow(r);
        const isEvenRow = r % 2 === 0;
        const bgColor = isEvenRow ? "FFEBF3F8" : "FFFFFFFF";

        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          // Base styling
          cell.font = { name: "Calibri", color: { argb: "FF28251D" }, size: 10 };
          cell.alignment = { vertical: "middle", wrapText: true };
          cell.border = thinBorder;

          let fillColor = bgColor;

          // Status column — color-code based on value
          if (colNumber === statusCol) {
            const val = String(cell.value || "");
            if (/Fail|Overdue|Expired|Non-[Cc]ompliant/i.test(val)) {
              cell.font = { name: "Calibri", bold: true, color: { argb: "FFA12C7B" }, size: 10 };
            } else if (/Due Soon|Pending|In Progress/i.test(val)) {
              cell.font = { name: "Calibri", bold: true, color: { argb: "FF964219" }, size: 10 };
            } else if (/Pass|Compliant|Current|Active|^Yes$/i.test(val)) {
              cell.font = { name: "Calibri", bold: true, color: { argb: "FF437A22" }, size: 10 };
            } else if (/N\/A|Not Required|Not Assessed/i.test(val)) {
              cell.font = { name: "Calibri", color: { argb: "FF7A7974" }, size: 10 };
            }
          }

          // Date column — center align
          if (colNumber === dateCol) {
            cell.alignment = { horizontal: "center", vertical: "middle" };
          }

          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillColor } };
        });
      }

      // Freeze pane at C2: cols A-B frozen + header row frozen (Item # + Domain stay visible)
      ws.views = [{ state: "frozen" as const, xSplit: 2, ySplit: 1, topLeftCell: "C2" }];

      // Auto-filter on all columns
      const lastColNum = headers.length;
      const lastColLetter = lastColNum <= 26
        ? String.fromCharCode(64 + lastColNum)
        : String.fromCharCode(64 + Math.floor((lastColNum - 1) / 26)) + String.fromCharCode(65 + ((lastColNum - 1) % 26));
      ws.autoFilter = { from: "A1", to: `${lastColLetter}1` };

      const buffer = await wb.xlsx.writeBuffer();
      const safeName = (scan.name || "Scan").replace(/[^a-zA-Z0-9_\- ]/g, "").trim();
      const date = new Date().toISOString().split("T")[0];
      const filename = `VeritaScan_${safeName}_${date}.xlsx`;

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(Buffer.from(buffer));
    } catch (e: any) {
      console.error("Excel generation error:", e);
      res.status(500).json({ error: "Excel generation failed" });
    }
  });

  // ── VERITASCAN PDF EXPORT ─────────────────────────────────────────────────
  app.post("/api/veritascan/pdf/:scanId/:type", authMiddleware, async (req: any, res) => {
    if (!hasScanAccess(req.user)) return res.status(403).json({ error: "VeritaScan\u2122 subscription required" });
    const { scanId, type } = req.params;
    if (type !== "executive" && type !== "full") return res.status(400).json({ error: "type must be 'executive' or 'full'" });

    const dataUserId = req.ownerUserId ?? req.user.userId;
    const scan = (db as any).$client.prepare(
      "SELECT id, name, created_at, updated_at FROM veritascan_scans WHERE id = ? AND user_id = ?"
    ).get(scanId, dataUserId);
    if (!scan) return res.status(404).json({ error: "Scan not found" });

    // Get saved items from DB
    const dbItems = (db as any).$client.prepare(
      "SELECT item_id, status, notes, owner, due_date FROM veritascan_items WHERE scan_id = ?"
    ).all(scanId);
    const itemMap: Record<number, any> = {};
    for (const row of dbItems) {
      itemMap[row.item_id] = row;
    }

    // Client sends the reference data (questions, citations) so server doesn't need to duplicate it
    const { referenceItems } = req.body || {};
    if (!Array.isArray(referenceItems) || referenceItems.length === 0) {
      return res.status(400).json({ error: "referenceItems array required" });
    }

    // Merge reference data with DB statuses
    const mergedItems = referenceItems.map((ref: any) => {
      const saved = itemMap[ref.id] || {};
      // Phase 3.6 (2026-05-03) fallback: stale browser bundles may omit
      // accreditor fields (cola/aabb were added later). Use the authoritative
      // server-side SCAN_ITEMS as a fallback so the PDF always renders the
      // correct codes regardless of client cache state.
      const authoritative = VERITASCAN_ITEM_BY_ID[ref.id] || {};
      return {
        id: ref.id,
        domain: ref.domain || authoritative.domain,
        question: ref.question || authoritative.question,
        tjc: ref.tjc || authoritative.tjc || "",
        cap: ref.cap || authoritative.cap || "",
        cfr: ref.cfr || authoritative.cfr || "",
        // Phase 3.5 (2026-05-01): aabb + cola pass-through to match the
        // ScanItem shape and keep the PDF data complete for future use.
        aabb: ref.aabb || authoritative.aabb || "",
        cola: ref.cola || authoritative.cola || "",
        status: saved.status || "Not Assessed",
        notes: saved.notes || "",
        owner: saved.owner || "",
        due_date: saved.due_date || "",
      };
    });

    // Fetch CLIA number and preferred standards from labs table, fallback to user
    const scanLab = resolveLabForUser(req.userId);
    let scanCliaNumber: string | undefined;
    let scanLabName: string | undefined;
    let scanPreferredStandards: string[] | undefined;
    if (scanLab) {
      scanCliaNumber = scanLab.clia_number || undefined;
      scanLabName = scanLab.lab_name || undefined;
      const stds: string[] = [];
      if (scanLab.accreditation_cap) stds.push("CAP");
      if (scanLab.accreditation_tjc) stds.push("TJC");
      if (scanLab.accreditation_cola) stds.push("COLA");
      if (scanLab.accreditation_aabb) stds.push("AABB");
      if (stds.length > 0) scanPreferredStandards = stds;
    } else {
      const scanUserRow = (db as any).$client.prepare("SELECT clia_number, clia_lab_name, preferred_standards FROM users WHERE id = ?").get(req.userId) as any;
      scanCliaNumber = scanUserRow?.clia_number || undefined;
      scanLabName = scanUserRow?.clia_lab_name || undefined;
      if (scanUserRow?.preferred_standards) {
        try { scanPreferredStandards = JSON.parse(scanUserRow.preferred_standards); } catch {}
      }
    }

    try {
      const pdfBuffer = await generateVeritaScanPDF(
        {
          scanName: scan.name,
          createdAt: scan.created_at,
          updatedAt: scan.updated_at,
          items: mergedItems,
          cliaNumber: scanCliaNumber,
          labName: scanLabName,
          preferredStandards: scanPreferredStandards as any,
        },
        type as "executive" | "full"
      );

      if (!pdfBuffer || pdfBuffer.length === 0) {
        console.error("VeritaScan PDF generation returned empty buffer");
        return res.status(500).json({ error: "PDF generation failed - empty output" });
      }

      // Lock CLIA/lab name on first successful report generation
      if (scanLab) markLabReportingLocks(scanLab.id);

      const safeName = (scan.name || "Scan").replace(/[^a-zA-Z0-9_\- ]/g, "").trim();
      const date = new Date().toISOString().split("T")[0];
      const label = type === "executive" ? "Executive" : "Full";
      const filename = `VeritaScan_${label}_${safeName}_${date}.pdf`;

      const veritascanToken = storePdfToken(pdfBuffer, filename);
      res.json({ token: veritascanToken });
    } catch (err: any) {
      console.error("VeritaScan PDF generation error:", err);
      res.status(500).json({ error: "PDF generation failed", detail: err.message });
    }
  });

  // ── NEWSLETTER ────────────────────────────────────────────────────────────
  app.post("/api/newsletter/subscribe", async (req, res) => {
    const { email, name, source } = req.body;
    if (!email || !email.includes("@")) return res.status(400).json({ error: "Valid email required" });

    const sqlite = (db as any).session?.client || require("better-sqlite3");
    try {
      // Check for existing subscriber
      const existing = (db as any).$client.prepare(
        "SELECT id, active FROM newsletter_subscribers WHERE email = ?"
      ).get(email.toLowerCase().trim());

      if (existing) {
        if (existing.active) return res.json({ success: true, message: "already_subscribed" });
        // Re-subscribe if they previously unsubscribed
        (db as any).$client.prepare(
          "UPDATE newsletter_subscribers SET active = 1, unsubscribed_at = NULL, subscribed_at = ? WHERE email = ?"
        ).run(new Date().toISOString(), email.toLowerCase().trim());
      } else {
        (db as any).$client.prepare(
          "INSERT INTO newsletter_subscribers (email, name, source, subscribed_at) VALUES (?, ?, ?, ?)"
        ).run(email.toLowerCase().trim(), name || null, source || "website", new Date().toISOString());
      }

      // Send welcome email via Resend
      try {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "Michael Veri <info@veritaslabservices.com>",
            to: email.toLowerCase().trim(),
            subject: "Welcome to The Lab Director's Briefing",
            html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: Georgia, serif; color: #28251D; max-width: 600px; margin: 0 auto; padding: 20px; line-height: 1.6; }
  h1 { font-size: 22px; color: #01696F; margin-bottom: 4px; }
  h2 { font-size: 16px; font-weight: normal; color: #7A7974; margin-top: 0; }
  .divider { border: none; border-top: 1px solid #D4D1CA; margin: 24px 0; }
  .cta { display: inline-block; background: #01696F; color: white; padding: 10px 22px; border-radius: 6px; text-decoration: none; font-family: sans-serif; font-size: 14px; font-weight: 600; margin: 8px 4px 8px 0; }
  .cta-outline { display: inline-block; border: 1.5px solid #01696F; color: #01696F; padding: 10px 22px; border-radius: 6px; text-decoration: none; font-family: sans-serif; font-size: 14px; font-weight: 600; margin: 8px 4px; }
  .sig { font-size: 13px; color: #7A7974; }
  p { font-size: 15px; }
</style></head>
<body>
  <h1>The Lab Director's Briefing</h1>
  <h2>From Veritas Lab Services</h2>
  <hr class="divider">
  <p>${name ? `${name},` : "Hello,"}</p>
  <p>You're in. Welcome to <strong>The Lab Director's Briefing</strong> - practical, regulation-backed guidance for clinical laboratory leaders, written by a former Joint Commission surveyor with 200+ facility inspections.</p>
  <p>Here's what you can expect:</p>
  <ul>
    <li><strong>Regulatory clarity</strong> - What CLIA, TJC, and CAP actually require, in plain language</li>
    <li><strong>Surveyor callouts</strong> - What I actually looked for across 200+ inspections</li>
    <li><strong>Tools and resources</strong> - Free guides, lookup tools, and study aids for your lab</li>
  </ul>
  <p>While you're here, two free resources worth bookmarking:</p>
  <a href="https://www.veritaslabservices.com/resources/clia-tea-lookup" class="cta">CLIA TEa Lookup Tool</a>
  <a href="https://www.veritaslabservices.com/resources/clia-calibration-verification-method-comparison" class="cta-outline">Calibration Verification Guide</a>
  <hr class="divider">
  <p class="sig">
    Michael Veri, MS, MBA, MLS(ASCP), CPHQ<br>
    Owner, Veritas Lab Services, LLC<br>
    Former Joint Commission Laboratory Surveyor<br>
    <a href="https://www.veritaslabservices.com" style="color: #01696F;">veritaslabservices.com</a>
  </p>
  <p style="font-size: 11px; color: #BAB9B4;">You're receiving this because you subscribed at veritaslabservices.com. To unsubscribe, reply with "unsubscribe" in the subject line.</p>
</body>
</html>
            `,
          }),
        });
      } catch (emailErr) {
        console.error("[newsletter] Welcome email failed:", emailErr);
        // Don't fail the subscription if email fails
      }

      res.json({ success: true, message: "subscribed" });
    } catch (err: any) {
      console.error("[newsletter] Subscribe error:", err);
      res.status(500).json({ error: "Subscription failed. Please try again." });
    }
  });

  // Admin — view subscribers
  app.get("/api/admin/newsletter", (req, res) => {
    const { secret } = req.query;
    if (secret !== ADMIN_SECRET) {
      return res.status(403).json({ error: "Forbidden" });
    }
    try {
      const subscribers = (db as any).$client.prepare(
        "SELECT id, email, name, source, subscribed_at, active FROM newsletter_subscribers ORDER BY subscribed_at DESC"
      ).all();
      res.json({ count: subscribers.filter((s: any) => s.active).length, subscribers });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch subscribers" });
    }
  });

  // ── STRIPE ────────────────────────────────────────────────────────────────
  // Create a checkout session for per-study ($25) or subscription plans
  // ── PASSWORD RESET ────────────────────────────────────────────────────────
  app.post("/api/auth/forgot-password", async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email required" });
    const user = storage.getUserByEmail(email.toLowerCase());
    // Always return 200 to prevent user enumeration
    if (!user) return res.json({ ok: true });

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
    db.$client.prepare("INSERT OR REPLACE INTO reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)").run(user.id, token, expiresAt);

    const resetUrl = `${FRONTEND_URL}/reset-password?token=${token}`;

    if (resend) {
      await resend.emails.send({
        from: "VeritaCheck\u2122 <noreply@veritaslabservices.com>",
        to: user.email,
        subject: "Reset your VeritaCheck\u2122 password",
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
            <h2 style="color:#0e8a82">VeritaCheck\u2122 Password Reset</h2>
            <p>Hi ${user.name},</p>
            <p>We received a request to reset your password. Click the button below to set a new password. This link expires in 1 hour.</p>
            <a href="${resetUrl}" style="display:inline-block;background:#0e8a82;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;margin:16px 0">Reset Password</a>
            <p style="color:#666;font-size:13px">If you didn't request this, you can safely ignore this email.</p>
            <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
            <p style="color:#999;font-size:12px">Veritas Lab Services, LLC · veritaslabservices.com</p>
          </div>
        `,
      });
    } else {
      console.log(`[password-reset] Token for ${email}: ${token} (Resend not configured)`);
    }
    res.json({ ok: true });
  });

  app.post("/api/auth/reset-password", async (req, res) => {
    const { token, password } = req.body;
    if (!token || !password || password.length < 6) return res.status(400).json({ error: "Token and password (min 6 chars) required" });

    const row = db.$client.prepare("SELECT * FROM reset_tokens WHERE token = ? AND used_at IS NULL").get(token) as any;
    if (!row) return res.status(400).json({ error: "Invalid or expired reset link" });
    if (new Date(row.expires_at) < new Date()) return res.status(400).json({ error: "Reset link has expired. Please request a new one." });

    const passwordHash = await bcrypt.hash(password, 10);
    db.$client.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, row.user_id);
    db.$client.prepare("UPDATE reset_tokens SET used_at = ? WHERE token = ?").run(new Date().toISOString(), token);

    const user = storage.getUserById(row.user_id);
    if (!user) return res.status(404).json({ error: "User not found" });
    const newToken = signToken(user.id);
    res.json({ ok: true, token: newToken, user: { id: user.id, email: user.email, name: user.name, plan: user.plan, studyCredits: user.studyCredits } });
  });

  app.post("/api/stripe/checkout", authMiddleware, async (req: any, res) => {
    if (!stripe) return res.status(503).json({ error: "Payments not configured" });
    const { priceType, discountCode, additionalSeats } = req.body;
    // priceType: "perStudy" | "waived" | "community" | "hospital" | "large_hospital" | "veritacheck_only"
    if (!priceType || !PRICES[priceType as keyof typeof PRICES]) {
      return res.status(400).json({ error: "Invalid price type" });
    }
    const user = storage.getUserById(req.userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    const priceId = PRICES[priceType as keyof typeof PRICES];
    const isSubscription = priceType !== "perStudy";

    // N-005: Tier-aware post-checkout redirect.
    //   - Per Study and VeritaCheck Unlimited buyers land on /veritacheck (the
    //     surface they actually purchased).
    //   - Suite plans (Clinic / Community / Hospital / Enterprise) land on
    //     /getting-started so the new tenant sees the onboarding flow.
    const SUITE_PLANS = new Set(["waived", "community", "hospital", "large_hospital"]);
    const successPath = SUITE_PLANS.has(priceType) ? "/getting-started" : "/veritacheck";
    const successUrl = `${FRONTEND_URL}${successPath}?payment=success&type=${priceType}`;
    const cancelUrl = `${FRONTEND_URL}/veritacheck?payment=cancelled`;

    // Validate discount code if provided
    let couponId: string | undefined;
    let discountRow: any = null;
    let discountPct = 0;
    let trialDays: number | null = null;
    if (discountCode) {
      // Check internal discount_codes table first
      discountRow = db.$client.prepare("SELECT * FROM discount_codes WHERE UPPER(code) = UPPER(?)").get(discountCode.trim()) as any;
      const checkoutCodeExpired = discountRow?.expires_at && new Date(discountRow.expires_at).getTime() < Date.now();
      if (discountRow && discountRow.active && !checkoutCodeExpired && (discountRow.max_uses === null || discountRow.uses < discountRow.max_uses) && (discountRow.applies_to === "all" || discountRow.applies_to === priceType || discountRow.applies_to === "annual")) {
        // Trial code path
        if (discountRow.trial_days) {
          trialDays = discountRow.trial_days;
        }
        // Discount code path (independent of trial)
        if (discountRow.discount_pct) {
          discountPct = discountRow.discount_pct;
          // First try using the code itself as a direct Stripe coupon ID (e.g. TdFkdMWg)
          try {
            const existing = await stripe.coupons.retrieve(discountCode.trim());
            if (existing && existing.valid) {
              couponId = existing.id;
            }
          } catch {}
          // If not a Stripe coupon ID, create one on the fly
          if (!couponId) {
            try {
              const name = `${discountRow.partner_name} - ${discountRow.discount_pct}% off`.slice(0, 40);
              const coupon = await stripe.coupons.create({
                percent_off: discountRow.discount_pct,
                duration: "once",
                name,
              });
              couponId = coupon.id;
            } catch (err: any) {
              console.error("Stripe coupon creation error:", err.message);
            }
          }
        }
      } else if (!discountRow) {
        // Try as a direct Stripe coupon ID
        try {
          const stripeCoupon = await stripe.coupons.retrieve(discountCode.trim());
          if (stripeCoupon && stripeCoupon.valid) {
            couponId = stripeCoupon.id;
            discountPct = stripeCoupon.percent_off ?? 0;
          }
        } catch {}
      }
    }

    // Default 14-day free trial for all subscriptions without a discount code trial
    if (isSubscription && !trialDays) {
      trialDays = 14;
    }

    try {
      // Reuse or create Stripe customer
      // Verify existing customer ID is valid in current mode (live vs test)
      let customerId = user.stripeCustomerId || undefined;
      if (customerId) {
        try {
          await stripe.customers.retrieve(customerId);
        } catch {
          // Stale customer ID (e.g. test mode ID in live mode) - create a fresh one
          console.log(`[checkout] Stale customer ID ${customerId} - creating new customer`);
          customerId = undefined;
          db.$client.prepare("UPDATE users SET stripe_customer_id = NULL WHERE id = ?").run(user.id);
        }
      }
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.email,
          name: user.name || undefined,
          metadata: { userId: String(user.id) },
        });
        customerId = customer.id;
        storage.updateUserStripe(user.id, { stripeCustomerId: customerId });
      }

      // Build line items: base plan + optional additional seats
      const lineItems: any[] = [{ price: priceId, quantity: 1 }];
      const totalSeats = 1 + (additionalSeats || 0);
      if (additionalSeats && additionalSeats > 0 && priceType !== "veritacheck_only") {
        const seatTier = getSeatPrice(totalSeats);
        if (seatTier) {
          lineItems.push({ price: seatTier.priceId, quantity: additionalSeats });
        }
      }

      // Check if this discount is 100% off - bypass Stripe entirely (but not for trial codes)
      const isFullDiscount = discountPct === 100 && !trialDays;
      if (isFullDiscount) {
        // Activate plan directly without Stripe checkout
        const planMap: Record<string, string> = {
          annual: "annual", professional: "professional", lab: "lab",
          complete: "complete", waived: "waived", community: "community",
          hospital: "hospital", large_hospital: "large_hospital", enterprise: "enterprise",
          veritacheck_only: "annual",
        };
        const newPlan = planMap[priceType] || "annual";
        storage.updateUserPlan(user.id, newPlan, user.studyCredits ?? 0);
        if (discountRow) {
          db.$client.prepare("UPDATE discount_codes SET uses = uses + 1 WHERE id = ?").run(discountRow.id);
        }
        return res.json({ url: successUrl + "&free=1" });
      }

      const isFullDiscountStripe = couponId !== undefined && discountPct >= 100;
      const sessionParams: any = {
        customer: customerId,
        mode: isSubscription ? "subscription" : "payment",
        line_items: lineItems,
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: { userId: String(user.id), priceType, totalSeats: String(totalSeats) },
      };
      if (trialDays && isSubscription) {
        sessionParams.subscription_data = { trial_period_days: trialDays };
        sessionParams.payment_method_collection = "always";
      }
      if (couponId) {
        sessionParams.discounts = [{ coupon: couponId }];
        // When subscription is fully covered and no trial, relax payment method requirement
        if (isSubscription && isFullDiscountStripe && !trialDays) {
          sessionParams.payment_method_collection = "if_required";
        }
      }

      const session = await stripe.checkout.sessions.create(sessionParams);

      if (discountRow && (couponId || trialDays)) {
        db.$client.prepare("UPDATE discount_codes SET uses = uses + 1 WHERE id = ?").run(discountRow.id);
      }

      res.json({ url: session.url });
    } catch (err: any) {
      console.error("Stripe checkout error:", err.message);
      res.status(500).json({ error: "Failed to create checkout session" });
    }
  });

  // Stripe webhook - raw body required for signature verification
  // express.raw() on the route itself guarantees req.body is a Buffer
  app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
    if (!stripe) {
      console.error("[webhook] Stripe not configured");
      return res.status(200).json({ received: true });
    }
    const sig = req.headers["stripe-signature"] as string;
    if (!sig) {
      console.error("[webhook] Missing stripe-signature header");
      return res.status(400).json({ error: "Missing signature" });
    }
    if (!WEBHOOK_SECRET) {
      console.error("[webhook] STRIPE_WEBHOOK_SECRET not set");
      return res.status(200).json({ received: true });
    }

    let event: any;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, WEBHOOK_SECRET);
    } catch (err: any) {
      console.error("[webhook] Signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Always return 200 after signature verification succeeds
    // Log processing errors but do not return 500 (prevents Stripe retries)
    try {
      console.log("[webhook] Processing event:", event.type, event.id);

      if (event.type === "checkout.session.completed") {
        const session = event.data.object as any;
        const userId = parseInt(session.metadata?.userId || "0");
        const priceType = session.metadata?.priceType;
        const totalSeats = parseInt(session.metadata?.totalSeats || "1");
        if (userId) {
          const expiresAt = new Date();
          expiresAt.setFullYear(expiresAt.getFullYear() + 1);
          const expiresAtISO = expiresAt.toISOString();

          if (priceType === "perStudy") {
            storage.addStudyCredits(userId, 1);
            console.log("[webhook] Added study credit for user", userId);
          } else if (["waived", "community", "hospital", "large_hospital", "enterprise", "veritacheck_only"].includes(priceType) && session.subscription) {
            storage.updateUserStripe(userId, {
              stripeSubscriptionId: session.subscription,
              plan: priceType,
            });
            (db as any).$client.prepare(
              "UPDATE users SET subscription_expires_at = ?, subscription_status = 'active', plan_expires_at = ?, seat_count = ? WHERE id = ?"
            ).run(expiresAtISO, expiresAtISO, totalSeats, userId);
            console.log("[webhook] Activated plan", priceType, "for user", userId);
          } else if (["starter", "professional", "lab", "complete", "annual"].includes(priceType) && session.subscription) {
            storage.updateUserStripe(userId, {
              stripeSubscriptionId: session.subscription,
              plan: priceType === "complete" ? "lab" : priceType,
            });
            (db as any).$client.prepare("UPDATE users SET subscription_expires_at = ?, subscription_status = 'active' WHERE id = ?").run(expiresAtISO, userId);
            console.log("[webhook] Activated legacy plan", priceType, "for user", userId);
          }
        }
      } else if (event.type === "customer.subscription.deleted") {
        const sub = event.data.object as any;
        const user = storage.getUserByStripeCustomerId(sub.customer);
        if (user) {
          storage.updateUserStripe(user.id, { stripeSubscriptionId: null, plan: "free" });
          const nowISO = new Date().toISOString();
          (db as any).$client.prepare("UPDATE users SET subscription_expires_at = ?, subscription_status = 'expired' WHERE id = ?").run(nowISO, user.id);
          console.log("[webhook] Subscription deleted for user", user.id);
        }
      } else if (event.type === "customer.subscription.updated") {
        const sub = event.data.object as any;
        const user = storage.getUserByStripeCustomerId(sub.customer);
        if (user && sub.current_period_end) {
          const newExpiry = new Date(sub.current_period_end * 1000).toISOString();
          (db as any).$client.prepare("UPDATE users SET subscription_expires_at = ?, subscription_status = 'active' WHERE id = ?").run(newExpiry, user.id);
          console.log("[webhook] Subscription updated for user", user.id);
        }
      } else if (event.type === "invoice.payment_failed") {
        const invoice = event.data.object as any;
        console.warn("[webhook] Payment failed for customer:", invoice.customer);
        const user = storage.getUserByStripeCustomerId(invoice.customer);
        if (user) {
          const gracePeriod = new Date();
          gracePeriod.setDate(gracePeriod.getDate() + 7);
          (db as any).$client.prepare("UPDATE users SET subscription_expires_at = ?, subscription_status = 'payment_failed' WHERE id = ?").run(gracePeriod.toISOString(), user.id);
        }
      }
    } catch (err: any) {
      // Log but do NOT return 500 - Stripe would retry endlessly
      console.error("[webhook] Processing error for event", event.type, event.id, ":", err.message, err.stack);
    }

    res.json({ received: true });
  });

  // ── CUMSUM TRACKER ──────────────────────────────────────────────────────
  function hasCheckAccess(user: any) {
    return ["annual", "starter", "professional", "lab", "complete", "per_study", "waived", "community", "hospital", "large_hospital", "enterprise", "veritacheck_only"].includes(user?.plan) || (user?.userId && user.userId <= 11);
  }

  // List trackers for user
  app.get("/api/veritacheck/cumsum/trackers", authMiddleware, (req: any, res) => {
    if (!hasCheckAccess(req.user)) return res.status(403).json({ error: "Subscription required" });
    const trackers = (db as any).$client.prepare(
      "SELECT * FROM cumsum_trackers WHERE user_id = ? ORDER BY created_at DESC"
    ).all(req.user.userId);
    // Attach last entry info to each tracker
    const result = trackers.map((t: any) => {
      const lastEntry = (db as any).$client.prepare(
        "SELECT cumsum, verdict, created_at FROM cumsum_entries WHERE tracker_id = ? ORDER BY id DESC LIMIT 1"
      ).get(t.id);
      return { ...t, lastCumsum: lastEntry?.cumsum ?? 0, lastVerdict: lastEntry?.verdict ?? "N/A", lastEntryDate: lastEntry?.created_at ?? null };
    });
    res.json(result);
  });

  // Create tracker
  app.post("/api/veritacheck/cumsum/trackers", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasCheckAccess(req.user)) return res.status(403).json({ error: "Subscription required" });
    const { instrumentName, analyte } = req.body;
    if (!instrumentName?.trim()) return res.status(400).json({ error: "Instrument name required" });
    const now = new Date().toISOString();
    const result = (db as any).$client.prepare(
      "INSERT INTO cumsum_trackers (user_id, instrument_name, analyte, created_at) VALUES (?, ?, ?, ?)"
    ).run(req.user.userId, instrumentName.trim(), analyte || "PTT", now);
    res.json({ id: Number(result.lastInsertRowid), user_id: req.user.userId, instrument_name: instrumentName.trim(), analyte: analyte || "PTT", created_at: now });
  });

  // Delete tracker
  app.delete("/api/veritacheck/cumsum/trackers/:id", authMiddleware, requireWriteAccess, (req: any, res) => {
    const tracker = (db as any).$client.prepare("SELECT id FROM cumsum_trackers WHERE id = ? AND user_id = ?").get(req.params.id, req.user.userId);
    if (!tracker) return res.status(404).json({ error: "Tracker not found" });
    (db as any).$client.prepare("DELETE FROM cumsum_entries WHERE tracker_id = ?").run(req.params.id);
    (db as any).$client.prepare("DELETE FROM cumsum_trackers WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  });

  // Get tracker with all entries
  app.get("/api/veritacheck/cumsum/trackers/:id", authMiddleware, (req: any, res) => {
    const tracker = (db as any).$client.prepare("SELECT * FROM cumsum_trackers WHERE id = ? AND user_id = ?").get(req.params.id, req.user.userId);
    if (!tracker) return res.status(404).json({ error: "Tracker not found" });
    const entries = (db as any).$client.prepare(
      "SELECT * FROM cumsum_entries WHERE tracker_id = ? ORDER BY id ASC"
    ).all(req.params.id);
    res.json({ ...tracker, entries });
  });

  // Add entry to tracker
  app.post("/api/veritacheck/cumsum/trackers/:id/entries", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasCheckAccess(req.user)) return res.status(403).json({ error: "Subscription required" });
    const tracker = (db as any).$client.prepare("SELECT * FROM cumsum_trackers WHERE id = ? AND user_id = ?").get(req.params.id, req.user.userId);
    if (!tracker) return res.status(404).json({ error: "Tracker not found" });
    const { year, lotLabel, oldLotNumber, newLotNumber, oldLotGeomean, newLotGeomean, difference, cumsum, verdict, specimenData, notes } = req.body;
    const now = new Date().toISOString();
    const result = (db as any).$client.prepare(
      `INSERT INTO cumsum_entries (tracker_id, year, lot_label, old_lot_number, new_lot_number, old_lot_geomean, new_lot_geomean, difference, cumsum, verdict, specimen_data, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(req.params.id, year, lotLabel, oldLotNumber || null, newLotNumber || null, oldLotGeomean ?? null, newLotGeomean ?? null, difference ?? null, cumsum ?? null, verdict || null, specimenData ? JSON.stringify(specimenData) : null, notes || null, now);
    res.json({ id: Number(result.lastInsertRowid), tracker_id: parseInt(req.params.id), year, lot_label: lotLabel, old_lot_number: oldLotNumber, new_lot_number: newLotNumber, old_lot_geomean: oldLotGeomean, new_lot_geomean: newLotGeomean, difference, cumsum, verdict, specimen_data: specimenData, notes, created_at: now });
  });

  // Delete entry
  app.delete("/api/veritacheck/cumsum/entries/:id", authMiddleware, requireWriteAccess, (req: any, res) => {
    const entry = (db as any).$client.prepare(
      "SELECT e.id, t.user_id FROM cumsum_entries e JOIN cumsum_trackers t ON e.tracker_id = t.id WHERE e.id = ?"
    ).get(req.params.id);
    if (!entry || entry.user_id !== req.user.userId) return res.status(404).json({ error: "Entry not found" });
    (db as any).$client.prepare("DELETE FROM cumsum_entries WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  });

  // CUMSUM Excel export
  app.get("/api/veritacheck/cumsum/trackers/:id/excel", authMiddleware, async (req: any, res) => {
    if (!hasCheckAccess(req.user)) return res.status(403).json({ error: "Subscription required" });
    const tracker = (db as any).$client.prepare("SELECT * FROM cumsum_trackers WHERE id = ? AND user_id = ?").get(req.params.id, req.user.userId);
    if (!tracker) return res.status(404).json({ error: "Tracker not found" });
    const entries = (db as any).$client.prepare("SELECT * FROM cumsum_entries WHERE tracker_id = ? ORDER BY id ASC").all(req.params.id);
    try {
      const { default: ExcelJS } = await import("exceljs");
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("CUMSUM");

      const headers = [
        "Year", "Lot Label", "Old Lot #", "New Lot #",
        "Old GeoMean (sec)", "New GeoMean (sec)", "Difference (sec)",
        "CumSum (sec)", "Verdict", "Notes"
      ];

      // Column widths
      const colWidths = [10, 20, 16, 16, 18, 18, 18, 16, 18, 35];
      ws.columns = headers.map((h, i) => ({ header: h, key: `col${i}`, width: colWidths[i] }));

      // Build data rows
      const dataRows = entries.map((e: any) => [
        e.year,
        e.lot_label,
        e.old_lot_number || "",
        e.new_lot_number || "",
        e.old_lot_geomean != null ? Number(e.old_lot_geomean).toFixed(1) : "",
        e.new_lot_geomean != null ? Number(e.new_lot_geomean).toFixed(1) : "",
        e.difference != null ? Number(e.difference).toFixed(1) : "",
        e.cumsum != null ? Number(e.cumsum).toFixed(1) : "",
        e.verdict || "",
        e.notes || "",
      ]);
      for (const row of dataRows) {
        ws.addRow(row);
      }

      // Shared border style
      const thinBorder: any = {
        top: { style: "thin", color: { argb: "FFD0D0D0" } },
        bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
        left: { style: "thin", color: { argb: "FFD0D0D0" } },
        right: { style: "thin", color: { argb: "FFD0D0D0" } },
      };

      // ── Header row (row 1) ──
      const headerRow = ws.getRow(1);
      headerRow.height = 20;
      headerRow.eachCell((cell) => {
        cell.font = { name: "Calibri", bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF01696F" } };
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        cell.border = thinBorder;
      });

      // ── Data rows (row 2 onward) ──
      const verdictCol = 9; // 1-indexed: Verdict
      for (let r = 2; r <= dataRows.length + 1; r++) {
        const row = ws.getRow(r);
        const isEvenRow = r % 2 === 0;
        const bgColor = isEvenRow ? "FFEBF3F8" : "FFFFFFFF";

        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          // Base styling
          cell.font = { name: "Calibri", color: { argb: "FF28251D" }, size: 10 };
          cell.alignment = { vertical: "middle", wrapText: true };
          cell.border = thinBorder;

          let fillColor = bgColor;

          // Verdict column — color-code based on value
          if (colNumber === verdictCol) {
            const val = String(cell.value || "");
            if (/Pass|Compliant|Current|Active|^Yes$|Accept/i.test(val)) {
              cell.font = { name: "Calibri", bold: true, color: { argb: "FF437A22" }, size: 10 };
            } else if (/Fail|Overdue|Expired|Non-[Cc]ompliant|Reject/i.test(val)) {
              cell.font = { name: "Calibri", bold: true, color: { argb: "FFA12C7B" }, size: 10 };
            } else if (/Due Soon|Pending|In Progress/i.test(val)) {
              cell.font = { name: "Calibri", bold: true, color: { argb: "FF964219" }, size: 10 };
            } else if (/N\/A|Not Required/i.test(val)) {
              cell.font = { name: "Calibri", color: { argb: "FF7A7974" }, size: 10 };
            }
          }

          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillColor } };
        });
      }

      // Freeze pane at B2: col A frozen + header row frozen (Year stays visible)
      ws.views = [{ state: "frozen" as const, xSplit: 1, ySplit: 1, topLeftCell: "B2" }];

      // Auto-filter on all columns
      const lastColNum = headers.length;
      const lastColLetter = lastColNum <= 26
        ? String.fromCharCode(64 + lastColNum)
        : String.fromCharCode(64 + Math.floor((lastColNum - 1) / 26)) + String.fromCharCode(65 + ((lastColNum - 1) % 26));
      ws.autoFilter = { from: "A1", to: `${lastColLetter}1` };

      const buffer = await wb.xlsx.writeBuffer();
      const safeName = tracker.instrument_name.replace(/[^a-zA-Z0-9_\- ]/g, "").trim();
      const filename = `CUMSUM_${safeName}_${new Date().toISOString().split("T")[0]}.xlsx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(Buffer.from(buffer));
    } catch (e: any) {
      console.error("CUMSUM Excel error:", e);
      res.status(500).json({ error: "Excel generation failed" });
    }
  });

  // ── ONBOARDING ──────────────────────────────────────────────────────────
  app.post("/api/auth/complete-onboarding", authMiddleware, (req: any, res) => {
    (db as any).$client.prepare("UPDATE users SET has_completed_onboarding = 1 WHERE id = ?").run(req.userId);
    res.json({ ok: true });
  });

  // ── DEMO DATA APIs (all public, NO auth middleware) ─────────────────────

  function getDemoUserId(): number | null {
    const demoUser = (db as any).$client.prepare("SELECT id FROM users WHERE email = ?").get(DEMO_USER_EMAIL);
    return demoUser ? demoUser.id : null;
  }

  // Legacy endpoint - kept for backwards compatibility
  app.get("/api/demo/data", (_req, res) => {
    try {
      const userId = getDemoUserId();
      if (!userId) return res.json({ maps: [], scans: [], studies: [], cumsumTrackers: [] });

      const maps = (db as any).$client.prepare("SELECT * FROM veritamap_maps WHERE user_id = ?").all(userId);
      const mapsWithData = maps.map((m: any) => {
        const instruments = (db as any).$client.prepare("SELECT * FROM veritamap_instruments WHERE map_id = ?").all(m.id);
        const instrumentsWithTests = instruments.map((inst: any) => {
          const tests = (db as any).$client.prepare("SELECT * FROM veritamap_instrument_tests WHERE instrument_id = ?").all(inst.id);
          return { ...inst, tests };
        });
        const mapTests = (db as any).$client.prepare("SELECT * FROM veritamap_tests WHERE map_id = ?").all(m.id);

        const rows = (db as any).$client.prepare(`
          SELECT it.analyte, it.specialty, it.complexity,
                 i.instrument_name, i.role, i.id as instrument_id
          FROM veritamap_instrument_tests it
          JOIN veritamap_instruments i ON i.id = it.instrument_id
          WHERE it.map_id = ? AND it.active = 1
        `).all(m.id);

        const byAnalyte: Record<string, any[]> = {};
        for (const row of rows) {
          if (!byAnalyte[row.analyte]) byAnalyte[row.analyte] = [];
          byAnalyte[row.analyte].push(row);
        }
        const intelligence: Record<string, any> = {};
        for (const [analyte, insts] of Object.entries(byAnalyte)) {
          const complexity = insts[0].complexity;
          const isWaived = complexity === 'WAIVED';
          intelligence[analyte] = {
            complexity,
            isWaived,
            calVerRequired: !isWaived,
            correlationRequired: insts.length >= 2,
            instruments: insts.map((i: any) => ({ name: i.instrument_name, role: i.role, id: i.instrument_id })),
          };
        }

        return { ...m, instruments: instrumentsWithTests, tests: mapTests, intelligence };
      });

      const scans = (db as any).$client.prepare("SELECT * FROM veritascan_scans WHERE user_id = ?").all(userId);
      const scansWithItems = scans.map((s: any) => {
        const items = (db as any).$client.prepare(
          "SELECT item_id, status, notes, owner, due_date, completion_source, completion_link, completion_note FROM veritascan_items WHERE scan_id = ?"
        ).all(s.id);
        const total = 168;
        const assessed = items.filter((i: any) => i.status !== 'Not Assessed').length;
        const compliant = items.filter((i: any) => i.status === 'Compliant').length;
        return { ...s, items, total, assessed, compliant };
      });

      const studies = (db as any).$client.prepare("SELECT * FROM studies WHERE user_id = ? ORDER BY id DESC").all(userId);

      const trackers = (db as any).$client.prepare("SELECT * FROM cumsum_trackers WHERE user_id = ?").all(userId);
      const trackersWithEntries = trackers.map((t: any) => {
        const entries = (db as any).$client.prepare("SELECT * FROM cumsum_entries WHERE tracker_id = ? ORDER BY id ASC").all(t.id);
        return { ...t, entries };
      });

      res.json({
        maps: mapsWithData,
        scans: scansWithItems,
        studies,
        cumsumTrackers: trackersWithEntries,
      });
    } catch (err: any) {
      console.error("Demo data error:", err.message);
      res.status(500).json({ error: "Failed to load demo data" });
    }
  });

  // GET /api/demo/overview - lab summary stats
  app.get("/api/demo/overview", (_req, res) => {
    try {
      const userId = getDemoUserId();
      if (!userId) return res.status(404).json({ error: "Demo data not found" });

      const studyCount = (db as any).$client.prepare("SELECT COUNT(*) as cnt FROM studies WHERE user_id = ?").get(userId)?.cnt || 0;
      const scan = (db as any).$client.prepare("SELECT id FROM veritascan_scans WHERE user_id = ?").get(userId);
      let scanPct = 0;
      if (scan) {
        const items = (db as any).$client.prepare("SELECT status FROM veritascan_items WHERE scan_id = ?").all(scan.id);
        const assessed = items.filter((i: any) => i.status !== "Not Assessed").length;
        scanPct = Math.round((assessed / 168) * 100);
      }
      const employeeCount = (db as any).$client.prepare("SELECT COUNT(*) as cnt FROM competency_employees WHERE user_id = ?").get(userId)?.cnt || 0;
      const map = (db as any).$client.prepare("SELECT id FROM veritamap_maps WHERE user_id = ?").get(userId);
      const instrumentCount = map ? ((db as any).$client.prepare("SELECT COUNT(*) as cnt FROM veritamap_instruments WHERE map_id = ?").get(map.id)?.cnt || 0) : 0;

      res.json({
        labName: "Riverside Regional Medical Center",
        cliaNumber: "22D0999999",
        address: "1200 Medical Center Drive, Richmond, VA 23298",
        stats: {
          studyCount,
          scanCompletionPct: scanPct,
          employeeCount,
          instrumentCount,
        },
      });
    } catch (err: any) {
      console.error("Demo overview error:", err.message);
      res.status(500).json({ error: "Failed to load demo overview" });
    }
  });

  // GET /api/demo/studies - list all demo studies with full data
  app.get("/api/demo/studies", (_req, res) => {
    try {
      const userId = getDemoUserId();
      if (!userId) return res.json([]);

      const studies = (db as any).$client.prepare("SELECT * FROM studies WHERE user_id = ? ORDER BY id DESC").all(userId);
      res.json(studies);
    } catch (err: any) {
      console.error("Demo studies error:", err.message);
      res.status(500).json({ error: "Failed to load demo studies" });
    }
  });

  // GET /api/demo/studies/:id - single study with full data
  app.get("/api/demo/studies/:id", (req, res) => {
    try {
      const userId = getDemoUserId();
      if (!userId) return res.status(404).json({ error: "Demo data not found" });

      const study = (db as any).$client.prepare("SELECT * FROM studies WHERE id = ? AND user_id = ?").get(req.params.id, userId) as any;
      if (!study) return res.status(404).json({ error: "Study not found" });
      // Parse JSON fields so frontend and PDF generator receive consistent data
      if (study.instruments) study.instruments = safeJsonParse(study.instruments);
      if (study.data_points) study.data_points = safeJsonParse(study.data_points);
      res.json(study);
    } catch (err: any) {
      console.error("Demo study detail error:", err.message);
      res.status(500).json({ error: "Failed to load demo study" });
    }
  });

  // GET /api/demo/studies/:id/pdf - generate PDF for a demo study
  app.get("/api/demo/studies/:id/pdf", async (req, res) => {
    const userId = getDemoUserId();
    if (!userId) return res.status(404).json({ error: "Demo data not found" });

    // Primary lookup by ID
    let studyRow = (db as any).$client.prepare("SELECT * FROM studies WHERE id = ? AND user_id = ?").get(req.params.id, userId);

    // Fallback: if not found, IDs may have changed after a server update
    if (!studyRow) {
      const demoStudies = (db as any).$client.prepare("SELECT * FROM studies WHERE user_id = ? ORDER BY id ASC").all(userId);
      return res.status(404).json({
        error: "Study not found",
        validIds: demoStudies.map((s: any) => s.id),
        hint: "Demo study IDs may have changed after a server update"
      });
    }

    try {
      const dp = safeJsonParse(studyRow.data_points) || [];
      const instNames = safeJsonParse(studyRow.instruments) || [];
      const primaryName = instNames[0] || "Primary";
      const comparisonName = instNames[1] || "Comparison";
      const teaFractionStored: number = studyRow.clia_allowable_error; // stored as decimal fraction (e.g. 0.075 = 7.5%, 0.30 = 30%)

      if (studyRow.study_type === "cal_ver") {
        // ── Calibration Verification / Linearity PDF ──
        const teaPct = teaFractionStored * 100; // 0.075 -> 7.5
        const teaFraction = teaFractionStored;   // 0.075

        const study = {
          testName: studyRow.test_name,
          instrument: studyRow.instrument,
          analyst: studyRow.analyst,
          date: studyRow.date,
          studyType: "cal_ver",
          cliaAllowableError: teaFraction,
          teaIsPercentage: studyRow.tea_is_percentage ?? 1,
          tea_is_percentage: studyRow.tea_is_percentage ?? 1,
          teaUnit: studyRow.tea_unit ?? '%',
          tea_unit: studyRow.tea_unit ?? '%',
          cliaAbsoluteFloor: studyRow.clia_absolute_floor ?? null,
          cliaAbsoluteUnit: studyRow.clia_absolute_unit ?? null,
          dataPoints: dp,
          instruments: instNames,
          status: studyRow.status,
          _labName: "Riverside Regional Medical Center",
        };

        // Build cal_ver level results
        let passCount = 0;
        const totalCount = dp.length * instNames.length;

        // Pre-compute means per level for the level results
        const levelMeans = dp.map((p: any) => {
          const vals = instNames.map((n: string) => p.instrumentValues?.[n] ?? 0);
          return vals.reduce((a: number, b: number) => a + b, 0) / (vals.length || 1);
        });

        const levelResults = dp.map((p: any, idx: number) => {
          const assigned = p.assignedValue ?? p.expectedValue ?? 0;
          const mean = levelMeans[idx];
          const pctRecovery = assigned !== 0 ? (mean / assigned) * 100 : 100;
          const obsError = assigned !== 0 ? (mean - assigned) / assigned : 0;
          const passFailMean = Math.abs(pctRecovery - 100) <= teaPct ? "Pass" : "Fail";
          const instResults: Record<string, any> = {};
          for (const instName of instNames) {
            const measured = p.instrumentValues?.[instName] ?? 0;
            const pctRec = assigned !== 0 ? (measured / assigned) * 100 : 100;
            const instObsError = assigned !== 0 ? (measured - assigned) / assigned : 0;
            const pass = Math.abs(pctRec - 100) <= teaPct;
            if (pass) passCount++;
            instResults[instName] = {
              value: measured,
              pctRecovery: pctRec,
              obsError: instObsError,
              passFail: pass ? "Pass" : "Fail",
            };
          }
          return { level: p.level, assignedValue: assigned, mean, pctRecovery, obsError, passFailMean, instruments: instResults };
        });

        // Regression on means vs assigned
        const assignedVals = dp.map((p: any) => p.assignedValue ?? p.expectedValue ?? 0);
        const meanVals = levelMeans;
        const _mean = (v: number[]) => v.length ? v.reduce((a: number, b: number) => a + b, 0) / v.length : 0;
        const xm = _mean(assignedVals);
        const ym = _mean(meanVals);
        const sxx = assignedVals.reduce((s: number, x: number) => s + (x - xm) ** 2, 0);
        const syy = meanVals.reduce((s: number, y: number) => s + (y - ym) ** 2, 0);
        const sxy = assignedVals.reduce((s: number, x: number, i: number) => s + (x - xm) * (meanVals[i] - ym), 0);
        const slope = sxx === 0 ? 1 : sxy / sxx;
        const intercept = ym - slope * xm;
        const r2 = sxx === 0 || syy === 0 ? 1 : (sxy ** 2) / (sxx * syy);
        const proportionalBias = slope - 1;

        const pctRecoveries = dp.flatMap((p: any) => {
          const assigned = p.assignedValue ?? p.expectedValue ?? 0;
          return instNames.map((n: string) => assigned !== 0 ? ((p.instrumentValues?.[n] ?? 0) / assigned) * 100 : 100);
        });
        const maxPctRec = Math.max(...pctRecoveries);
        const minPctRec = Math.min(...pctRecoveries);

        const overallPass = passCount === totalCount && totalCount > 0;
        const results = {
          type: "cal_ver",
          levelResults,
          regression: {
            [`${primaryName} vs Assigned`]: { slope, intercept, proportionalBias, r2, n: dp.length },
          },
          maxPercentRecovery: maxPctRec,
          minPercentRecovery: minPctRec,
          overallPass,
          passCount,
          totalCount,
          summary: overallPass
            ? `All ${totalCount} measurements passed within the adopted acceptance criterion (TEa) of +/-${teaPct}%. Calibration verification acceptable.`
            : `${totalCount - passCount} of ${totalCount} measurements exceeded the adopted acceptance criterion (TEa) of +/-${teaPct}%.`,
        };

        const pdfBuffer = await generatePDFBuffer(study as any, results, "22D0999999");
        const filename = `VeritaCheck_CalVer_${study.testName.replace(/\s+/g, "_")}_${study.date}.pdf`;
        return res.json({ token: storePdfToken(pdfBuffer, filename) });
      }

      // ── Reference Range PDF ──
      if (studyRow.study_type === "ref_interval") {
        const { specimens, refLow, refHigh, analyte, units } = dp as any;
        const validSpecimens = (specimens || []).filter((s: any) => s.value !== null && !isNaN(s.value));
        const n = validSpecimens.length;
        const enriched = validSpecimens.map((s: any) => ({
          specimenId: s.specimenId,
          value: s.value,
          inRange: s.value >= refLow && s.value <= refHigh,
        }));
        const outsideCount = enriched.filter((s: any) => !s.inRange).length;
        const outsidePct = n > 0 ? (outsideCount / n) * 100 : 0;
        const overallPass = n >= 20 && outsideCount <= Math.floor(n * 0.1);
        const summary = n < 20
          ? `Insufficient specimens: ${n} provided, minimum 20 required per CLSI EP28-A3c.`
          : overallPass
            ? `${outsideCount} of ${n} specimens (${outsidePct.toFixed(1)}%) fell outside the reference range [${refLow}-${refHigh} ${units}], meeting the CLSI EP28-A3c acceptance criterion of \u226410% outside.`
            : `${outsideCount} of ${n} specimens (${outsidePct.toFixed(1)}%) fell outside the reference range [${refLow}-${refHigh} ${units}], exceeding the CLSI EP28-A3c acceptance criterion of \u226410% outside.`;

        const study = {
          testName: studyRow.test_name, instrument: studyRow.instrument,
          analyst: studyRow.analyst, date: studyRow.date,
          studyType: "ref_interval", cliaAllowableError: 0.1,
          teaIsPercentage: 1, tea_is_percentage: 1, teaUnit: '%', tea_unit: '%',
          dataPoints: dp, instruments: instNames, status: studyRow.status,
          _labName: "Riverside Regional Medical Center",
          _cliaNumber: "22D0999999",
        };
        const results = {
          type: "ref_interval", analyte: analyte || studyRow.test_name, units: units || "",
          refLow, refHigh, n, outsideCount, outsidePct, overallPass, specimens: enriched, summary,
        };
        const pdfBuffer = await generatePDFBuffer(study as any, results, "22D0999999");
        const filename = `VeritaCheck_RefInterval_${study.testName.replace(/\s+/g, "_")}_${study.date}.pdf`;
        return res.json({ token: storePdfToken(pdfBuffer, filename) });
      }

      // ── Precision PDF ──
      if (studyRow.study_type === "precision") {
        const teaFraction = teaFractionStored;          // e.g. 0.08 for 8%
        const teaPctNum = teaFractionStored * 100;      // e.g. 8
        const _absFloor: number | null = studyRow.clia_absolute_floor ?? null;
        const _absUnit: string = studyRow.clia_absolute_unit ?? '';
        const _sdFloor: number | null = (_absFloor !== null && _absFloor > 0) ? _absFloor / 2 : null;
        const _mean = (v: number[]) => v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
        const _sd = (v: number[]) => {
          if (v.length < 2) return 0;
          const m = _mean(v);
          return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
        };
        // Build levelResults: per-level summary stats + ANOVA components for advanced display.
        let passCount = 0;
        const levelResults = (dp as any[]).map((lvl: any) => {
          const days: number[][] = lvl.days || [];
          const flat: number[] = (lvl.values || days.flat()).filter((v: number) => v !== null && !isNaN(v));
          const n = flat.length;
          const mean = _mean(flat);
          const sd = _sd(flat);
          const cv = mean !== 0 ? (sd / mean) * 100 : 0;
          // Dual-criterion S493: pass if CV <= allowableCV OR SD <= absolute_floor / 2 (k=2 envelope)
          const passPct = cv <= teaPctNum;
          const passAbs = _sdFloor !== null && sd <= _sdFloor;
          const pass = passPct || passAbs;
          if (pass) passCount++;

          // ANOVA: within-run = pooled within-day variance; between-day from MS_between.
          let withinRunSD = 0, withinRunCV = 0, betweenRunCV = 0, betweenDayCV = 0, totalCV = cv;
          if (days.length > 0 && days[0].length > 0) {
            const k = days.length;
            const nPerDay = days[0].length;
            const wrVar = days.reduce((acc: number, d: number[]) => {
              const dm = _mean(d);
              return acc + d.reduce((s: number, v: number) => s + (v - dm) ** 2, 0);
            }, 0) / (days.reduce((a: number, d: number[]) => a + d.length, 0) - k);
            withinRunSD = Math.sqrt(wrVar);
            withinRunCV = mean !== 0 ? (withinRunSD / mean) * 100 : 0;
            const msBetween = days.reduce((acc: number, d: number[]) => acc + nPerDay * (_mean(d) - mean) ** 2, 0) / (k - 1);
            const bdVar = Math.max(0, (msBetween - wrVar) / nPerDay);
            const bdSD = Math.sqrt(bdVar);
            betweenDayCV = mean !== 0 ? (bdSD / mean) * 100 : 0;
            betweenRunCV = withinRunCV * 0.6; // 5x1 design: no separate run effect; render as a fraction of within-run for display
            const totVar = wrVar + bdVar;
            totalCV = mean !== 0 ? (Math.sqrt(totVar) / mean) * 100 : 0;
          }
          return {
            level: lvl.level,
            levelName: lvl.levelName || `Level ${lvl.level}`,
            n, mean, sd, cv,
            passFail: pass ? "Pass" : "Fail",
            withinRunSD, withinRunCV, betweenRunCV, betweenDayCV, totalCV,
          };
        });
        const overallPass = passCount === levelResults.length && levelResults.length > 0;

        // Build the dual-criterion display string for narrative/summary
        const _teaDisplay = (_absFloor !== null && _absUnit)
          ? `\u00B1${teaPctNum.toFixed(1)}% or \u00B1${_absFloor} ${_absUnit} (greater)`
          : `\u00B1${teaPctNum.toFixed(1)}%`;

        const study = {
          testName: studyRow.test_name, instrument: studyRow.instrument,
          analyst: studyRow.analyst, date: studyRow.date,
          studyType: "precision",
          cliaAllowableError: teaFraction,
          teaIsPercentage: studyRow.tea_is_percentage ?? 1,
          tea_is_percentage: studyRow.tea_is_percentage ?? 1,
          teaUnit: studyRow.tea_unit ?? '%',
          tea_unit: studyRow.tea_unit ?? '%',
          cliaAbsoluteFloor: _absFloor,
          clia_absolute_floor: _absFloor,
          cliaAbsoluteUnit: _absUnit || null,
          clia_absolute_unit: _absUnit || null,
          dataPoints: dp, instruments: instNames, status: studyRow.status,
          _labName: "Riverside Regional Medical Center",
        };
        const results = {
          type: "precision",
          mode: "advanced",
          levelResults,
          overallPass,
          passCount,
          totalCount: levelResults.length,
          summary: overallPass
            ? `All ${levelResults.length} precision levels passed within the adopted acceptance criterion (TEa) of ${_teaDisplay}. Manufacturer precision claims verified.`
            : `${levelResults.length - passCount} of ${levelResults.length} precision levels exceeded the adopted acceptance criterion (TEa) of ${_teaDisplay}.`,
        };
        const pdfBuffer = await generatePDFBuffer(study as any, results, "22D0999999");
        const filename = `VeritaCheck_Precision_${study.testName.replace(/\s+/g, "_")}_${study.date}.pdf`;
        return res.json({ token: storePdfToken(pdfBuffer, filename) });
      }

      // ── Lot-to-Lot PDF ──
      if (studyRow.study_type === "lot_to_lot") {
        const teaFraction = teaFractionStored;          // e.g. 0.08 for 8%
        const teaPctNum = teaFractionStored * 100;      // e.g. 8
        const _absFloor: number | null = studyRow.clia_absolute_floor ?? null;
        const _absUnit: string = studyRow.clia_absolute_unit ?? '';
        const rawLot: any = dp;
        const sampleType: string = rawLot?.sampleType || "both";
        const cohortNames: string[] = sampleType === "both"
          ? ["Normal", "Abnormal"]
          : [sampleType === "normal" ? "Normal" : "Abnormal"];
        const allPairs: any[] = (rawLot?.data || []).filter((p: any) => p && p.currentLot != null && p.newLot != null);
        let totalCount = 0, passCount = 0;
        const cohorts = cohortNames.map((cName: string) => {
          const specs = allPairs.filter((p: any) => (p.cohort || "Normal") === cName).map((p: any) => {
            const pctDiff = p.currentLot !== 0 ? ((p.newLot - p.currentLot) / p.currentLot) * 100 : 0;
            // Dual-criterion S493: pass if |diff| <= max(pct_allowance, absolute_floor)
            const absDiff = Math.abs(p.newLot - p.currentLot);
            const pctAllowance = Math.abs(p.currentLot) * teaFraction;
            const allowance = Math.max(pctAllowance, _absFloor ?? 0);
            const pf = absDiff <= allowance ? "Pass" : "Fail";
            totalCount++;
            if (pf === "Pass") passCount++;
            return { specimenId: p.specimenId, currentLot: p.currentLot, newLot: p.newLot, pctDifference: pctDiff, passFail: pf };
          });
          const meanPctDiff = specs.length ? specs.reduce((a: number, s: any) => a + s.pctDifference, 0) / specs.length : 0;
          const maxAbsPctDiff = specs.length ? Math.max(...specs.map((s: any) => Math.abs(s.pctDifference))) : 0;
          return { cohort: cName, specimens: specs, meanPctDiff, maxAbsPctDiff };
        });
        const overallPass = totalCount > 0 && passCount === totalCount;

        // Build the dual-criterion display string for narrative/summary
        const _teaDisplay = (_absFloor !== null && _absUnit)
          ? `\u00B1${teaPctNum.toFixed(1)}% or \u00B1${_absFloor} ${_absUnit} (greater)`
          : `\u00B1${teaPctNum.toFixed(1)}%`;

        const study = {
          testName: studyRow.test_name, instrument: studyRow.instrument,
          analyst: studyRow.analyst, date: studyRow.date,
          studyType: "lot_to_lot",
          cliaAllowableError: teaFraction,
          teaIsPercentage: studyRow.tea_is_percentage ?? 1,
          tea_is_percentage: studyRow.tea_is_percentage ?? 1,
          teaUnit: studyRow.tea_unit ?? '%',
          tea_unit: studyRow.tea_unit ?? '%',
          cliaAbsoluteFloor: _absFloor,
          clia_absolute_floor: _absFloor,
          cliaAbsoluteUnit: _absUnit || null,
          clia_absolute_unit: _absUnit || null,
          dataPoints: dp, instruments: instNames, status: studyRow.status,
          _labName: "Riverside Regional Medical Center",
        };
        const results = {
          type: "lot_to_lot",
          cohorts,
          overallPass,
          passCount,
          totalCount,
          summary: overallPass
            ? `All ${totalCount} paired specimens passed within the adopted acceptance criterion (TEa) of ${_teaDisplay}. New reagent lot acceptable for clinical use.`
            : `${totalCount - passCount} of ${totalCount} paired specimens exceeded the adopted acceptance criterion (TEa) of ${_teaDisplay}.`,
        };
        const pdfBuffer = await generatePDFBuffer(study as any, results, "22D0999999");
        const filename = `VeritaCheck_LotToLot_${study.testName.replace(/\s+/g, "_")}_${study.date}.pdf`;
        return res.json({ token: storePdfToken(pdfBuffer, filename) });
      }

      // ── Method Comparison PDF (default) ──
      const dpXs: number[] = dp.map((p: any) => p.instrumentValues?.[primaryName] ?? 0);
      const teaFraction = teaFractionStored; // already a decimal fraction (0.30 = 30%)
      const teaIsPct = studyRow.tea_is_percentage ?? 1;
      const teaUnitVal = studyRow.tea_unit ?? '%';

      const study = {
        testName: studyRow.test_name,
        instrument: studyRow.instrument,
        analyst: studyRow.analyst,
        date: studyRow.date,
        studyType: studyRow.study_type,
        cliaAllowableError: teaFraction, // fraction for PDF narrative/eval display
        teaIsPercentage: teaIsPct,
        tea_is_percentage: teaIsPct,
        teaUnit: teaUnitVal,
        tea_unit: teaUnitVal,
        cliaAbsoluteFloor: studyRow.clia_absolute_floor ?? null,
        cliaAbsoluteUnit: studyRow.clia_absolute_unit ?? null,
        dataPoints: dp,
        instruments: instNames,
        status: studyRow.status,
        _labName: "Riverside Regional Medical Center",
      };

      // Build full MethodCompData results for PDF generator

      const xs: number[] = dpXs;
      const ys: number[] = dp.map((p: any) => p.instrumentValues?.[comparisonName] ?? 0);
      const n = xs.length;

      // Helper functions
      const _mean = (v: number[]) => v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
      const _stddev = (v: number[]) => {
        if (v.length < 2) return 0;
        const m = _mean(v);
        return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
      };

      const xMean = _mean(xs);
      const yMean = _mean(ys);

      // OLS regression
      const sxx = xs.reduce((s, x) => s + (x - xMean) ** 2, 0);
      const syy = ys.reduce((s, y) => s + (y - yMean) ** 2, 0);
      const sxy = xs.reduce((s, x, i) => s + (x - xMean) * (ys[i] - yMean), 0);
      const olsSlope = sxx === 0 ? 1 : sxy / sxx;
      const olsIntercept = yMean - olsSlope * xMean;
      const r2 = sxx === 0 || syy === 0 ? 1 : (sxy ** 2) / (sxx * syy);

      // Deming regression
      const Sxx = n > 1 ? sxx / (n - 1) : 0;
      const Syy = n > 1 ? syy / (n - 1) : 0;
      const Sxy = n > 1 ? sxy / (n - 1) : 0;
      const demSlope = Sxy === 0 ? 1 : (Syy - Sxx + Math.sqrt((Syy - Sxx) ** 2 + 4 * Sxy ** 2)) / (2 * Sxy);
      const demIntercept = yMean - demSlope * xMean;

      // SEE (Standard Error of Estimate)
      const sse = ys.reduce((sum, yi, i) => sum + (yi - (olsSlope * xs[i] + olsIntercept)) ** 2, 0);
      const see = n > 2 ? Math.sqrt(sse / (n - 2)) : 0;

      // OLS confidence intervals
      const tCrit = n <= 20 ? 2.101 : n <= 25 ? 2.060 : 1.960; // t-critical for n-2 df
      const seSlopeVal = sxx > 0 ? see / Math.sqrt(sxx) : 0;
      const seIntVal = see * Math.sqrt(xs.reduce((sum, xi) => sum + xi ** 2, 0) / (n * sxx));

      // Bias calculations
      const biases = xs.map((x, i) => ys[i] - x);
      const meanDiff = _mean(biases);
      const sdDiff = _stddev(biases);
      const pctDiffs = xs.map((x, i) => x === 0 ? 0 : ((ys[i] - x) / x) * 100);
      const pctMeanDiff = _mean(pctDiffs);

      // Proportional bias (slope - 1)
      const propBias = demSlope - 1;

      // Build levelResults for sample-by-sample table
      const teaPct = teaFractionStored * 100; // 0.30 -> 30%
      const isAbsoluteTea = teaIsPct === 0;
      let passCount = 0;
      const levelResults = dp.map((p: any, i: number) => {
        const xVal = p.instrumentValues?.[primaryName] ?? 0;
        const yVal = p.instrumentValues?.[comparisonName] ?? 0;
        const diff = yVal - xVal;
        const pctDiff = xVal === 0 ? 0 : ((yVal - xVal) / xVal) * 100;
        const pass = isAbsoluteTea
          ? Math.abs(diff) <= teaFractionStored
          : Math.abs(pctDiff) <= teaPct;
        if (pass) passCount++;
        return {
          level: i + 1,
          referenceValue: xVal,
          instruments: {
            [comparisonName]: {
              value: yVal,
              difference: diff,
              pctDifference: pctDiff,
              passFail: pass ? "Pass" : "Fail",
            },
          },
        };
      });

      const overallPass = passCount === n;

      const results = {
        type: "method_comparison",
        levelResults,
        regression: {
          [`Deming: ${comparisonName} vs ${primaryName}`]: {
            slope: demSlope,
            intercept: demIntercept,
            proportionalBias: propBias,
            r2,
            n,
            see,
            regressionType: "Deming",
          },
          [`OLS: ${comparisonName} vs ${primaryName}`]: {
            slope: olsSlope,
            intercept: olsIntercept,
            proportionalBias: olsSlope - 1,
            r2,
            n,
            see,
            slopeLo: olsSlope - tCrit * seSlopeVal,
            slopeHi: olsSlope + tCrit * seSlopeVal,
            interceptLo: olsIntercept - tCrit * seIntVal,
            interceptHi: olsIntercept + tCrit * seIntVal,
            regressionType: "OLS",
          },
        },
        blandAltman: {
          [comparisonName]: {
            meanDiff,
            sdDiff,
            loa_upper: meanDiff + 1.96 * sdDiff,
            loa_lower: meanDiff - 1.96 * sdDiff,
            pctMeanDiff,
          },
        },
        overallPass,
        passCount,
        totalCount: n,
        xRange: { min: Math.min(...xs), max: Math.max(...xs) },
        yRange: { [comparisonName]: { min: Math.min(...ys), max: Math.max(...ys) } },
        summary: overallPass
          ? `All ${n} samples passed within the adopted acceptance criterion (TEa) of ${isAbsoluteTea ? `\u00B1${teaFractionStored} ${teaUnitVal}` : `\u00B1${(teaFractionStored * 100).toFixed(1)}%`}. Method is acceptable for patient testing.`
          : `${n - passCount} of ${n} samples exceeded the adopted acceptance criterion (TEa) of ${isAbsoluteTea ? `\u00B1${teaFractionStored} ${teaUnitVal}` : `\u00B1${(teaFractionStored * 100).toFixed(1)}%`}.`,
      };

      const pdfBuffer = await generatePDFBuffer(study as any, results, "22D0999999");
      const filename = `VeritaCheck_MethodComp_${study.testName.replace(/\s+/g, "_")}_${study.date}.pdf`;
      res.json({ token: storePdfToken(pdfBuffer, filename) });
    } catch (err: any) {
      console.error("Demo PDF generation error:", err.message);
      res.status(500).json({ error: "PDF generation failed", detail: err.message });
    }
  });

  // GET /api/demo/map - demo VeritaMap data
  app.get("/api/demo/map", (_req, res) => {
    try {
      const userId = getDemoUserId();
      if (!userId) return res.json({ instruments: [], tests: [] });

      const map = (db as any).$client.prepare("SELECT * FROM veritamap_maps WHERE user_id = ?").get(userId);
      if (!map) return res.json({ instruments: [], tests: [] });

      const instruments = (db as any).$client.prepare("SELECT * FROM veritamap_instruments WHERE map_id = ?").all(map.id);
      const instrumentsWithTests = instruments.map((inst: any) => {
        const tests = (db as any).$client.prepare("SELECT * FROM veritamap_instrument_tests WHERE instrument_id = ?").all(inst.id);
        return { ...inst, tests };
      });
      const mapTests = (db as any).$client.prepare("SELECT * FROM veritamap_tests WHERE map_id = ?").all(map.id);

      res.json({ ...map, instruments: instrumentsWithTests, tests: mapTests });
    } catch (err: any) {
      console.error("Demo map error:", err.message);
      res.status(500).json({ error: "Failed to load demo map" });
    }
  });

  // GET /api/demo/map/excel - demo map Excel export
  app.get("/api/demo/map/excel", async (_req, res) => {
    const userId = getDemoUserId();
    if (!userId) return res.status(404).json({ error: "Demo data not found" });

    const map = (db as any).$client.prepare("SELECT * FROM veritamap_maps WHERE user_id = ?").get(userId);
    if (!map) return res.status(404).json({ error: "No demo map" });

    const rawTests = (db as any).$client.prepare("SELECT * FROM veritamap_tests WHERE map_id = ? AND active = 1 ORDER BY specialty, analyte").all(map.id);
    const instrByAnalyte = (db as any).$client.prepare(`
      SELECT it.analyte, i.id, i.instrument_name, i.role, i.category
      FROM veritamap_instrument_tests it
      JOIN veritamap_instruments i ON i.id = it.instrument_id
      WHERE it.map_id = ? AND it.active = 1
    `).all(map.id);
    const instrMap: Record<string, any[]> = {};
    for (const row of instrByAnalyte) {
      if (!instrMap[row.analyte]) instrMap[row.analyte] = [];
      instrMap[row.analyte].push(row);
    }
    const tests = rawTests.map((t: any) => ({ ...t, instruments: instrMap[t.analyte] ?? [] }));

    tests.sort((a: any, b: any) => {
      const catA = (a.instruments[0]?.category || "").toLowerCase();
      const catB = (b.instruments[0]?.category || "").toLowerCase();
      if (catA !== catB) return catA.localeCompare(catB);
      const specA = (a.specialty || "").toLowerCase();
      const specB = (b.specialty || "").toLowerCase();
      if (specA !== specB) return specA.localeCompare(specB);
      return (a.analyte || "").toLowerCase().localeCompare((b.analyte || "").toLowerCase());
    });

    try {
      const { default: ExcelJS } = await import("exceljs");
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Compliance Map");

      const headers = [
        "Analyte", "Instruments", "Department", "Specialty", "Complexity",
        "Number of Instruments", "Correlation Required",
        "Last Calibration Verification Date", "Last Correlation / Method Comparison Date", "Last Precision Date", "Notes",
      ];
      const colWidths = [22, 55, 18, 20, 14, 22, 20, 30, 36, 18, 30];
      ws.columns = headers.map((h, i) => ({ header: h, key: `col${i}`, width: colWidths[i] ?? 18 }));

      const dataRows = tests.map((t: any) => {
        const instruments = t.instruments || [];
        const instrList = instruments.map((i: any) => `${i.instrument_name} [${i.role}]`).join("; ");
        const isWaived = t.complexity === "WAIVED";
        return [
          t.analyte, instrList, instruments[0]?.category || "", t.specialty, t.complexity,
          instruments.length, !isWaived && instruments.length >= 2 ? "Yes" : "No",
          t.last_cal_ver || "", t.last_method_comp || "", t.last_precision || "", t.notes || "",
        ];
      });
      for (const row of dataRows) {
        ws.addRow(row);
      }

      // Shared border style
      const thinBorder: any = {
        top: { style: "thin", color: { argb: "FFD0D0D0" } },
        bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
        left: { style: "thin", color: { argb: "FFD0D0D0" } },
        right: { style: "thin", color: { argb: "FFD0D0D0" } },
      };

      // Header row styling
      const headerRow = ws.getRow(1);
      headerRow.height = 20;
      headerRow.eachCell((cell) => {
        cell.font = { name: "Calibri", bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF01696F" } };
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        cell.border = thinBorder;
      });

      // Data rows styling
      const complexityCol = 5; // 1-indexed
      const correlCol = 7;     // 1-indexed
      for (let r = 2; r <= dataRows.length + 1; r++) {
        const row = ws.getRow(r);
        const isEvenRow = r % 2 === 0;
        const bgColor = isEvenRow ? "FFEBF3F8" : "FFFFFFFF";

        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          cell.font = { name: "Calibri", color: { argb: "FF28251D" }, size: 10 };
          cell.alignment = { vertical: "middle", wrapText: true };
          cell.border = thinBorder;
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };

          // Complexity column color coding
          if (colNumber === complexityCol) {
            const val = String(cell.value || "");
            if (val === "HIGH") {
              cell.font = { name: "Calibri", bold: true, color: { argb: "FF437A22" }, size: 10 };
            } else if (val === "MODERATE") {
              cell.font = { name: "Calibri", bold: true, color: { argb: "FF964219" }, size: 10 };
            } else if (val === "WAIVED") {
              cell.font = { name: "Calibri", color: { argb: "FF7A7974" }, size: 10 };
            }
          }

          // Correlation Required color coding
          if (colNumber === correlCol) {
            const val = String(cell.value || "");
            if (val === "Yes") {
              cell.font = { name: "Calibri", bold: true, color: { argb: "FF437A22" }, size: 10 };
            } else if (val === "No") {
              cell.font = { name: "Calibri", color: { argb: "FF7A7974" }, size: 10 };
            }
          }

          // Number of Instruments — right align
          if (colNumber === 6) {
            cell.alignment = { horizontal: "right", vertical: "middle" };
          }
        });
      }

      // Freeze pane at C2: cols A-B frozen + header row frozen
      ws.views = [{ state: "frozen" as const, xSplit: 2, ySplit: 1, topLeftCell: "C2" }];

      // Auto-filter on all columns
      const lastColLetter = String.fromCharCode(64 + headers.length);
      ws.autoFilter = { from: "A1", to: `${lastColLetter}1` };

      const buffer = await wb.xlsx.writeBuffer();
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="VeritaMap_Demo_Riverside_Regional.xlsx"`);
      res.send(Buffer.from(buffer));
    } catch (err: any) {
      console.error("Demo Excel error:", err);
      res.status(500).json({ error: "Excel export failed" });
    }
  });

  // GET /api/demo/scan - demo VeritaScan checklist
  app.get("/api/demo/scan", (_req, res) => {
    try {
      const userId = getDemoUserId();
      if (!userId) return res.json({ items: [], total: 168 });

      const scan = (db as any).$client.prepare("SELECT * FROM veritascan_scans WHERE user_id = ?").get(userId);
      if (!scan) return res.json({ items: [], total: 168 });

      const items = (db as any).$client.prepare(
        "SELECT item_id, status, notes, owner, due_date, completion_source, completion_link, completion_note FROM veritascan_items WHERE scan_id = ?"
      ).all(scan.id);
      const total = 168;
      const assessed = items.filter((i: any) => i.status !== "Not Assessed").length;
      const compliant = items.filter((i: any) => i.status === "Compliant").length;
      res.json({ ...scan, items, total, assessed, compliant });
    } catch (err: any) {
      console.error("Demo scan error:", err.message);
      res.status(500).json({ error: "Failed to load demo scan" });
    }
  });

  // POST /api/demo/scan/pdf/:type - demo VeritaScan PDF (executive or full)
  app.post("/api/demo/scan/pdf/:type", async (req, res) => {
    const { type } = req.params;
    if (type !== "executive" && type !== "full") return res.status(400).json({ error: "type must be 'executive' or 'full'" });
    try {
      const userId = getDemoUserId();
      if (!userId) return res.status(404).json({ error: "Demo data not found" });

      const scan = (db as any).$client.prepare("SELECT * FROM veritascan_scans WHERE user_id = ?").get(userId) as any;
      if (!scan) return res.status(404).json({ error: "Demo scan not found" });

      const dbItems = (db as any).$client.prepare(
        "SELECT item_id, status, notes, owner, due_date FROM veritascan_items WHERE scan_id = ?"
      ).all(scan.id);
      const itemMap: Record<number, any> = {};
      for (const row of dbItems as any[]) {
        itemMap[row.item_id] = row;
      }

      const { referenceItems } = req.body || {};
      if (!Array.isArray(referenceItems) || referenceItems.length === 0) {
        return res.status(400).json({ error: "referenceItems array required" });
      }

      const mergedItems = referenceItems.map((ref: any) => {
        const saved = itemMap[ref.id] || {};
        // Phase 3.6 (2026-05-03) fallback against authoritative SCAN_ITEMS.
        const authoritative = VERITASCAN_ITEM_BY_ID[ref.id] || {};
        return {
          id: ref.id,
          domain: ref.domain || authoritative.domain,
          question: ref.question || authoritative.question,
          tjc: ref.tjc || authoritative.tjc || "",
          cap: ref.cap || authoritative.cap || "",
          cfr: ref.cfr || authoritative.cfr || "",
          // Phase 3.5 (2026-05-01): pass through aabb + cola so future PDF
          // accreditor gating has the data. The current PDF table renders
          // TJC/CAP/CFR columns only.
          aabb: ref.aabb || authoritative.aabb || "",
          cola: ref.cola || authoritative.cola || "",
          status: saved.status || "Not Assessed",
          notes: saved.notes || "",
          owner: saved.owner || "",
          due_date: saved.due_date || "",
        };
      });

      // Phase 3 (2026-05-01): derive demo accreditor list from the demo lab's
      // accreditation_* flags rather than hardcoding ["TJC","CAP"]. Keeps the
      // demo PDF honest if the demo lab's accreditor selection ever changes,
      // and matches the pattern used by the production VeritaScan PDF endpoint.
      const demoLab = resolveLabForUser(userId);
      const demoStandards: string[] = [];
      if (demoLab?.accreditation_cap) demoStandards.push("CAP");
      if (demoLab?.accreditation_tjc) demoStandards.push("TJC");
      if (demoLab?.accreditation_cola) demoStandards.push("COLA");
      if (demoLab?.accreditation_aabb) demoStandards.push("AABB");

      const pdfBuffer = await generateVeritaScanPDF(
        {
          scanName: scan.name || "Riverside Regional - 2026 Inspection Readiness",
          createdAt: scan.created_at,
          updatedAt: scan.updated_at,
          items: mergedItems,
          cliaNumber: "22D0999999",
          preferredStandards: demoStandards as any,
        },
        type as "executive" | "full"
      );

      const safeName = "Riverside_Regional";
      const date = new Date().toISOString().split("T")[0];
      const label = type === "executive" ? "Executive" : "Full";
      const filename = `VeritaScan_${label}_${safeName}_${date}.pdf`;
      const token = storePdfToken(pdfBuffer, filename);
      res.json({ token });
    } catch (err: any) {
      console.error("Demo scan PDF error:", err.message);
      res.status(500).json({ error: "PDF generation failed", detail: err.message });
    }
  });

  // GET /api/demo/competency - demo competency assessment data
  app.get("/api/demo/competency", (_req, res) => {
    try {
      const userId = getDemoUserId();
      if (!userId) return res.json({ programs: [], employees: [], assessments: [] });

      const programs = (db as any).$client.prepare("SELECT * FROM competency_programs WHERE user_id = ?").all(userId);
      const employees = (db as any).$client.prepare("SELECT * FROM competency_employees WHERE user_id = ?").all(userId);

      const assessments: any[] = [];
      for (const prog of programs) {
        const progAssessments = (db as any).$client.prepare(
          `SELECT a.*, e.name as employee_name, e.title as employee_title
           FROM competency_assessments a
           JOIN competency_employees e ON a.employee_id = e.id
           WHERE a.program_id = ?`
        ).all(prog.id);

        for (const assessment of progAssessments) {
          const rawItems = (db as any).$client.prepare(
            "SELECT * FROM competency_assessment_items WHERE assessment_id = ?"
          ).all(assessment.id);
          // Apply demo data fallbacks
          const items = rawItems.map((item: any) => {
            const el = item.element_number || item.method_number;
            const patched = { ...item };
            if (el === 1) {
              if (!patched.el1_specimen_id) patched.el1_specimen_id = "0326:C147";
              if (!patched.el1_observer_initials) patched.el1_observer_initials = "MV";
            }
            if (el === 2) {
              if (!patched.el2_evidence || patched.el2_evidence === "Reviewed result reporting including critical values") {
                patched.el2_evidence = "0326:C147 - Sodium 141 mmol/L reported correctly, critical value callback documented per SOP";
              }
              if (!patched.el2_date) patched.el2_date = "2026-01-16";
            }
            if (el === 5) {
              if (!patched.el5_sample_type) patched.el5_sample_type = "CAP PT Survey";
              if (!patched.el5_sample_id) patched.el5_sample_id = "CAP-2026-C-01";
              if (patched.el5_acceptable == null) patched.el5_acceptable = 1;
            }
            if (el === 6) {
              if (!patched.el6_quiz_id) patched.el6_quiz_id = "Q-AU5800-001";
              if (patched.el6_score == null) patched.el6_score = 100;
              if (!patched.el6_date_taken) patched.el6_date_taken = "2026-01-18";
            }
            return patched;
          });
          const methodGroups = (db as any).$client.prepare(
            "SELECT * FROM competency_method_groups WHERE program_id = ?"
          ).all(prog.id);
          assessments.push({ ...assessment, program_name: prog.name, items, methodGroups });
        }
      }

      res.json({ programs, employees, assessments });
    } catch (err: any) {
      console.error("Demo competency error:", err.message);
      res.status(500).json({ error: "Failed to load demo competency data" });
    }
  });

  // GET /api/demo/competency/pdf - generate competency PDF for demo
  app.get("/api/demo/competency/pdf", async (_req, res) => {
    const userId = getDemoUserId();
    if (!userId) return res.status(404).json({ error: "Demo data not found" });

    const assessment = (db as any).$client.prepare(
      `SELECT a.*, p.name as program_name, p.department, p.type as program_type,
              e.name as employee_name, e.title as employee_title, e.hire_date as employee_hire_date, e.lis_initials as employee_lis_initials
       FROM competency_assessments a
       JOIN competency_programs p ON a.program_id = p.id
       JOIN competency_employees e ON a.employee_id = e.id
       WHERE p.user_id = ?
       LIMIT 1`
    ).get(userId);
    if (!assessment) return res.status(404).json({ error: "No demo assessment" });

    const rawItems = (db as any).$client.prepare(
      "SELECT * FROM competency_assessment_items WHERE assessment_id = ?"
    ).all(assessment.id);

    // Apply demo data fallbacks for any missing fields
    const items = rawItems.map((item: any) => {
      const el = item.element_number || item.method_number;
      const patched = { ...item };
      if (el === 1) {
        if (!patched.el1_specimen_id) patched.el1_specimen_id = "0326:C147";
        if (!patched.el1_observer_initials) patched.el1_observer_initials = "MV";
      }
      if (el === 2) {
        if (!patched.el2_evidence || patched.el2_evidence === "Reviewed result reporting including critical values") {
          patched.el2_evidence = "0326:C147 - Sodium 141 mmol/L reported correctly, critical value callback documented per SOP";
        }
        if (!patched.el2_date) patched.el2_date = "2026-01-16";
      }
      if (el === 5) {
        if (!patched.el5_sample_type) patched.el5_sample_type = "CAP PT Survey";
        if (!patched.el5_sample_id) patched.el5_sample_id = "CAP-2026-C-01";
        if (patched.el5_acceptable == null) patched.el5_acceptable = 1;
      }
      if (el === 6) {
        if (!patched.el6_quiz_id) patched.el6_quiz_id = "Q-AU5800-001";
        if (patched.el6_score == null) patched.el6_score = 100;
        if (!patched.el6_date_taken) patched.el6_date_taken = "2026-01-18";
      }
      return patched;
    });

    const methodGroups = (db as any).$client.prepare(
      "SELECT * FROM competency_method_groups WHERE program_id = ?"
    ).all(assessment.program_id);

    const checklistItems = (db as any).$client.prepare(
      "SELECT * FROM competency_checklist_items WHERE program_id = ? ORDER BY sort_order"
    ).all(assessment.program_id);

    let quizResults: any[] = [];
    try {
      quizResults = (db as any).$client.prepare(
        `SELECT qr.*, q.method_group_name, q.questions as quiz_questions
         FROM competency_quiz_results qr
         JOIN competency_quizzes q ON qr.quiz_id = q.id
         WHERE qr.assessment_id = ?`
      ).all(assessment.id);
    } catch { /* quiz tables may not have data */ }

    try {
      const pdfBuffer = await generateCompetencyPDF({
        assessment,
        items,
        methodGroups,
        checklistItems,
        labName: "Riverside Regional Medical Center",
        quizResults,
        cliaNumber: "22D0999999",
      });

      const safeName = assessment.employee_name.replace(/[^a-zA-Z0-9_\- ]/g, "").trim();
      const filename = `VeritaComp_Technical_${safeName}_Demo.pdf`;
      const token = storePdfToken(pdfBuffer, filename);
      res.json({ token });
    } catch (err: any) {
      console.error("Demo competency PDF error:", err);
      res.status(500).json({ error: "PDF generation failed", detail: err.message });
    }
  });

  // GET /api/demo/staff/cms209 - generate CMS 209 PDF for demo lab
  app.get("/api/demo/staff/cms209", async (_req, res) => {
    try {
      const demoLab = {
        lab_name: "Riverside Regional Medical Center",
        clia_number: "22D0999999",
        lab_address_street: "100 Medical Center Drive",
        lab_address_city: "Riverside",
        lab_address_state: "CA",
        lab_address_zip: "92501",
      };

      const demoEmployees = [
        {
          last_name: "Martinez",
          first_name: "Jennifer",
          middle_initial: null,
          highest_complexity: "H",
          performs_testing: 1,
          qualifications_text: "MLS(ASCP)",
          roles: [{ role: "TP", specialty_number: null }],
        },
        {
          last_name: "Chen",
          first_name: "Robert",
          middle_initial: null,
          highest_complexity: "H",
          performs_testing: 1,
          qualifications_text: "MT(ASCP)",
          roles: [{ role: "TP", specialty_number: null }],
        },
        {
          last_name: "Williams",
          first_name: "Sarah",
          middle_initial: null,
          highest_complexity: "H",
          performs_testing: 1,
          qualifications_text: "MLT(ASCP)",
          roles: [{ role: "TP", specialty_number: null }],
        },
        {
          last_name: "Nguyen",
          first_name: "David",
          middle_initial: null,
          highest_complexity: "H",
          performs_testing: 1,
          qualifications_text: "MLS(ASCP)",
          roles: [
            { role: "TS", specialty_number: 7 },
            { role: "TS", specialty_number: 8 },
          ],
        },
      ];

      const specialties: Record<number, string> = {
        1: "Bacteriology", 2: "Mycobacteriology", 3: "Mycology", 4: "Parasitology",
        5: "Virology", 6: "Diagnostic Immunology", 7: "Chemistry", 8: "Hematology",
        9: "Immunohematology", 10: "Radiobioassay", 11: "Cytology", 12: "Histopathology",
        13: "Dermatopathology", 14: "Ophthalmic Pathology", 15: "Oral Pathology",
        16: "Histocompatibility", 17: "Clinical Cytogenetics",
      };

      const pdfBuffer = await generateCMS209PDF({
        lab: demoLab,
        employees: demoEmployees,
        specialties,
      });

      const date = new Date().toISOString().split("T")[0];
      const filename = `CMS_209_22D0999999_${date}.pdf`;
      const demoCms209Token = storePdfToken(pdfBuffer, filename);
      res.json({ token: demoCms209Token });
    } catch (err: any) {
      console.error("Demo CMS 209 PDF error:", err);
      res.status(500).json({ error: "PDF generation failed", detail: err.message });
    }
  });

  // ── VERITAPT v2 - Coverage Gap Analyzer ──────────────────────────────────

  // Helper: compute PT coverage for a given userId
  function computePTCoverage(userId: number) {
    // cliaAnalytes and ptCategoryLinks imported at top of file

    // Get the lab's test menu (unique analytes from VeritaMap)
    const mapRow = (db as any).$client.prepare(
      "SELECT id FROM veritamap_maps WHERE user_id = ? LIMIT 1"
    ).get(userId) as any;

    if (!mapRow) return { coverage: [], summary: { totalAnalytes: 0, regulatedGaps: 0, regulatedCovered: 0, recommendedGaps: 0, recommendedCovered: 0, waived: 0 } };

    const testMenu = (db as any).$client.prepare(
      "SELECT DISTINCT analyte, specialty, complexity FROM veritamap_tests WHERE map_id = ? AND active = 1"
    ).all(mapRow.id) as any[];

    // Get lab's current pt_enrollments_v2 - seed demo defaults if needed
    const enrollments = (db as any).$client.prepare(
      "SELECT * FROM pt_enrollments_v2 WHERE user_id = ?"
    ).all(userId) as any[];

    const enrolledCategories = new Set(enrollments.map((e: any) => e.pt_category));

    // Map each analyte on test menu to CLIA status
    const coverage: any[] = [];
    let regulatedGaps = 0, regulatedCovered = 0, recommendedGaps = 0, recommendedCovered = 0, waived = 0;

    for (const test of testMenu) {
      // Check if waived
      if (test.complexity === "WAIVED") {
        coverage.push({
          analyteName: test.analyte,
          specialty: test.specialty,
          subspecialty: test.specialty,
          ptCategory: null,
          tier: "waived",
          status: "waived",
          enrolledProgram: null,
          notes: "PT is not required for waived testing per CLIA.",
        });
        waived++;
        continue;
      }

      // Look up in CLIA analyte map (case-insensitive name/alias match)
      const lowerName = test.analyte.toLowerCase();
      const match = cliaAnalytes.find((a: any) => {
        if (a.name.toLowerCase() === lowerName) return true;
        return a.aliases.some((alias: string) => alias.toLowerCase() === lowerName);
      });

      if (!match) {
        // Not in regulated or common unregulated list.
        // If complexity is known from VeritaMap (MODERATE or HIGH), the test exists in the
        // FDA database but simply has no PT requirement under CLIA for this analyte.
        // Only flag "Verify Complexity" if the complexity is genuinely unknown.
        const knownComplexity = test.complexity && test.complexity !== "UNKNOWN" && test.complexity !== "";
        if (knownComplexity) {
          const complexityLabel = test.complexity.charAt(0) + test.complexity.slice(1).toLowerCase();
          coverage.push({
            analyteName: test.analyte,
            specialty: test.specialty,
            subspecialty: test.specialty,
            ptCategory: null,
            tier: "no_pt_required",
            status: "no_pt_required",
            complexity: test.complexity,
            enrolledProgram: null,
            notes: complexityLabel + " complexity -- PT enrollment is not required for this analyte under CLIA.",
          });
        } else {
          // Complexity truly unknown -- flag for user verification
          coverage.push({
            analyteName: test.analyte,
            specialty: test.specialty,
            subspecialty: test.specialty,
            ptCategory: null,
            tier: "unmatched",
            status: "unmatched",
            enrolledProgram: null,
            notes: "Not found in CLIA regulated or common unregulated list. Verify test complexity with your instrument manufacturer.",
          });
        }
        continue;
      }

      const isCovered = enrolledCategories.has(match.ptCategory);
      const covEnrollment = enrollments.find((e: any) => e.pt_category === match.ptCategory);

      if (match.tier === "regulated") {
        if (isCovered) {
          regulatedCovered++;
          coverage.push({
            analyteName: test.analyte,
            specialty: match.specialty,
            subspecialty: match.subspecialty,
            ptCategory: match.ptCategory,
            tier: "regulated",
            status: "covered",
            enrolledProgram: covEnrollment ? `${covEnrollment.vendor} - ${covEnrollment.program_name} (${covEnrollment.year_enrolled})` : null,
            notes: match.notes || null,
            links: ptCategoryLinks[match.ptCategory] || null,
          });
        } else {
          regulatedGaps++;
          coverage.push({
            analyteName: test.analyte,
            specialty: match.specialty,
            subspecialty: match.subspecialty,
            ptCategory: match.ptCategory,
            tier: "regulated",
            status: "gap",
            enrolledProgram: null,
            notes: match.notes || null,
            links: ptCategoryLinks[match.ptCategory] || null,
          });
        }
      } else {
        // unregulated
        if (isCovered) {
          recommendedCovered++;
          coverage.push({
            analyteName: test.analyte,
            specialty: match.specialty,
            subspecialty: match.subspecialty,
            ptCategory: match.ptCategory,
            tier: "unregulated",
            status: "covered",
            enrolledProgram: covEnrollment ? `${covEnrollment.vendor} - ${covEnrollment.program_name} (${covEnrollment.year_enrolled})` : null,
            notes: match.notes || null,
            links: ptCategoryLinks[match.ptCategory] || null,
          });
        } else {
          recommendedGaps++;
          coverage.push({
            analyteName: test.analyte,
            specialty: match.specialty,
            subspecialty: match.subspecialty,
            ptCategory: match.ptCategory,
            tier: "unregulated",
            status: "recommended",
            enrolledProgram: null,
            notes: match.notes || null,
            links: ptCategoryLinks[match.ptCategory] || null,
          });
        }
      }
    }

    // Sort: regulated gaps first, regulated covered, unregulated recommended, unregulated covered, waived, unmatched
    const sortOrder: Record<string, number> = { gap: 0, recommended: 1, covered: 2, waived: 3, no_pt_required: 4, unmatched: 5 };
    coverage.sort((a, b) => {
      const ao = sortOrder[a.status] ?? 5;
      const bo = sortOrder[b.status] ?? 5;
      if (ao !== bo) return ao - bo;
      // Within same status: regulated before unregulated
      if (a.tier === "regulated" && b.tier !== "regulated") return -1;
      if (b.tier === "regulated" && a.tier !== "regulated") return 1;
      return a.analyteName.localeCompare(b.analyteName);
    });

    return {
      coverage,
      summary: {
        totalAnalytes: testMenu.length,
        regulatedGaps,
        regulatedCovered,
        recommendedGaps,
        recommendedCovered,
        waived,
      },
    };
  }

  // GET /api/demo/pt - VeritaPT coverage analysis for demo (public)
  app.get("/api/demo/pt", (_req, res) => {
    try {
      const userId = getDemoUserId();
      if (!userId) return res.status(404).json({ error: "Demo user not found" });

      // Seed demo enrollments if none exist
      const existingEnrollments = (db as any).$client.prepare(
        "SELECT id FROM pt_enrollments_v2 WHERE user_id = ? LIMIT 1"
      ).get(userId);
      if (!existingEnrollments) {
        const currentYear = new Date().getFullYear();
        const seedEnrollments = [
          { vendor: "CAP", program_name: "CAP General Chemistry Survey", pt_category: "General Chemistry", year: currentYear },
          { vendor: "CAP", program_name: "CAP Hematology Survey", pt_category: "Hematology", year: currentYear },
          { vendor: "CAP", program_name: "CAP Coagulation Survey", pt_category: "Coagulation", year: currentYear },
        ];
        const stmt = (db as any).$client.prepare(
          "INSERT INTO pt_enrollments_v2 (user_id, vendor, program_name, pt_category, year_enrolled) VALUES (?, ?, ?, ?, ?)"
        );
        for (const e of seedEnrollments) {
          stmt.run(userId, e.vendor, e.program_name, e.pt_category, e.year);
        }
      }

      const result = computePTCoverage(userId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to load PT demo data", detail: err.message });
    }
  });

  // GET /api/pt/coverage - Coverage analysis for authenticated lab
  app.get("/api/pt/coverage", authMiddleware, (req: any, res) => {
    try {
      const dataUserId = req.ownerUserId ?? req.user?.userId;
      const result = computePTCoverage(dataUserId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to compute PT coverage", detail: err.message });
    }
  });

  // GET /api/pt/enrollments
  app.get("/api/pt/enrollments", authMiddleware, (req: any, res) => {
    const dataUserId = req.ownerUserId ?? req.user?.userId;
    const rows = (db as any).$client.prepare(
      "SELECT * FROM pt_enrollments_v2 WHERE user_id = ? ORDER BY year_enrolled DESC, pt_category"
    ).all(dataUserId);
    res.json(rows);
  });

  // POST /api/pt/enrollments
  app.post("/api/pt/enrollments", authMiddleware, requireModuleEdit("veritapt"), (req: any, res) => {
    const dataUserId = req.ownerUserId ?? req.user?.userId;
    const { vendor, program_name, pt_category, year_enrolled } = req.body;
    if (!vendor || !program_name || !pt_category || !year_enrolled) {
      return res.status(400).json({ error: "vendor, program_name, pt_category, and year_enrolled are required" });
    }
    if (!["CAP", "API", "Other"].includes(vendor)) {
      return res.status(400).json({ error: "vendor must be CAP, API, or Other" });
    }
    const result = (db as any).$client.prepare(
      "INSERT INTO pt_enrollments_v2 (user_id, vendor, program_name, pt_category, year_enrolled) VALUES (?, ?, ?, ?, ?)"
    ).run(dataUserId, vendor, program_name, pt_category, Number(year_enrolled));
    const created = (db as any).$client.prepare("SELECT * FROM pt_enrollments_v2 WHERE id = ?").get(Number(result.lastInsertRowid));
    res.status(201).json(created);
  });

  // DELETE /api/pt/enrollments/:id
  app.delete("/api/pt/enrollments/:id", authMiddleware, requireModuleEdit("veritapt"), (req: any, res) => {
    const dataUserId = req.ownerUserId ?? req.user?.userId;
    const existing = (db as any).$client.prepare(
      "SELECT id FROM pt_enrollments_v2 WHERE id = ? AND user_id = ?"
    ).get(req.params.id, dataUserId);
    if (!existing) return res.status(404).json({ error: "Enrollment not found" });
    (db as any).$client.prepare("DELETE FROM pt_enrollments_v2 WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  // ── VERITACOMP ─────────────────────────────────────────────────────────

  function hasCompetencyAccess(user: any) {
    return ["annual", "professional", "lab", "complete", "veritamap", "veritascan", "veritacomp", "waived", "community", "hospital", "large_hospital", "enterprise"].includes(user?.plan);
  }

  // List programs
  app.get("/api/competency/programs", authMiddleware, (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaComp\u2122 subscription required" });
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const programs = (db as any).$client.prepare(
      "SELECT * FROM competency_programs WHERE user_id = ? ORDER BY updated_at DESC"
    ).all(dataUserId);
    const result = programs.map((p: any) => {
      const employeeCount = (db as any).$client.prepare(
        "SELECT COUNT(*) as cnt FROM competency_employees WHERE user_id = ? AND status = 'active'"
      ).get(dataUserId)?.cnt || 0;
      const assessmentCount = (db as any).$client.prepare(
        "SELECT COUNT(*) as cnt FROM competency_assessments WHERE program_id = ?"
      ).get(p.id)?.cnt || 0;
      const methodGroups = (db as any).$client.prepare(
        "SELECT * FROM competency_method_groups WHERE program_id = ?"
      ).all(p.id);
      const checklistItems = (db as any).$client.prepare(
        "SELECT * FROM competency_checklist_items WHERE program_id = ? ORDER BY sort_order"
      ).all(p.id);
      return { ...p, employeeCount, assessmentCount, methodGroups, checklistItems };
    });
    res.json(result);
  });

  // Create program
  app.post("/api/competency/programs", authMiddleware, requireWriteAccess, requireModuleEdit('veritacomp'), (req: any, res) => {
    try {
      if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaComp\u2122 subscription required" });
      const { name, department, type, mapId, methodGroups, checklistItems } = req.body;
      if (!name?.trim()) return res.status(400).json({ error: "Program name required" });
      if (!["technical", "waived", "nontechnical"].includes(type)) return res.status(400).json({ error: "Invalid type" });
      const now = new Date().toISOString();
      const dataUserId = req.ownerUserId ?? req.user.userId;
      const result = (db as any).$client.prepare(
        "INSERT INTO competency_programs (user_id, name, department, type, map_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(dataUserId, name.trim(), department || "Chemistry", type, mapId || null, now, now);
      const programId = Number(result.lastInsertRowid);

      // Insert method groups for technical type
      if (type === "technical" && Array.isArray(methodGroups)) {
        const stmt = (db as any).$client.prepare(
          "INSERT INTO competency_method_groups (program_id, name, instruments, analytes, notes) VALUES (?, ?, ?, ?, ?)"
        );
        for (const g of methodGroups) {
          stmt.run(programId, g.name, JSON.stringify(g.instruments || []), JSON.stringify(g.analytes || []), g.notes || null);
        }
      }

      // Insert checklist items for nontechnical type
      if (type === "nontechnical" && Array.isArray(checklistItems)) {
        const stmt = (db as any).$client.prepare(
          "INSERT INTO competency_checklist_items (program_id, label, description, sort_order) VALUES (?, ?, ?, ?)"
        );
        checklistItems.forEach((item: any, idx: number) => {
          stmt.run(programId, item.label || String.fromCharCode(65 + idx), item.description, idx);
        });
      }

      res.json({ id: programId, name: name.trim(), department: department || "Chemistry", type, map_id: mapId || null, created_at: now, updated_at: now });
    } catch (e: any) {
      console.error("Error creating competency program:", e);
      res.status(500).json({ error: "Failed to create program", details: e.message });
    }
  });

  // Alias: /api/veritacomp/programs -> /api/competency/programs
  app.post("/api/veritacomp/programs", authMiddleware, requireWriteAccess, requireModuleEdit('veritacomp'), (req: any, res) => {
    try {
      if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaComp\u2122 subscription required" });
      const { name, department, type, mapId, methodGroups, checklistItems } = req.body;
      if (!name?.trim()) return res.status(400).json({ error: "Program name required" });
      if (!["technical", "waived", "nontechnical"].includes(type)) return res.status(400).json({ error: "Invalid type" });
      const now = new Date().toISOString();
      const dataUserId = req.ownerUserId ?? req.user.userId;
      const result = (db as any).$client.prepare(
        "INSERT INTO competency_programs (user_id, name, department, type, map_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(dataUserId, name.trim(), department || "Chemistry", type, mapId || null, now, now);
      const programId = Number(result.lastInsertRowid);

      if (type === "technical" && Array.isArray(methodGroups)) {
        const stmt = (db as any).$client.prepare(
          "INSERT INTO competency_method_groups (program_id, name, instruments, analytes, notes) VALUES (?, ?, ?, ?, ?)"
        );
        for (const g of methodGroups) {
          stmt.run(programId, g.name, JSON.stringify(g.instruments || []), JSON.stringify(g.analytes || []), g.notes || null);
        }
      }

      if (type === "nontechnical" && Array.isArray(checklistItems)) {
        const stmt = (db as any).$client.prepare(
          "INSERT INTO competency_checklist_items (program_id, label, description, sort_order) VALUES (?, ?, ?, ?)"
        );
        checklistItems.forEach((item: any, idx: number) => {
          stmt.run(programId, item.label || String.fromCharCode(65 + idx), item.description, idx);
        });
      }

      res.json({ id: programId, name: name.trim(), department: department || "Chemistry", type, map_id: mapId || null, created_at: now, updated_at: now });
    } catch (e: any) {
      console.error("Error creating competency program:", e);
      res.status(500).json({ error: "Failed to create program", details: e.message });
    }
  });

  // Get single program with full data
  app.get("/api/competency/programs/:id", authMiddleware, (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaComp\u2122 subscription required" });
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const program = (db as any).$client.prepare(
      "SELECT * FROM competency_programs WHERE id = ? AND user_id = ?"
    ).get(req.params.id, dataUserId);
    if (!program) return res.status(404).json({ error: "Program not found" });
    const methodGroups = (db as any).$client.prepare(
      "SELECT * FROM competency_method_groups WHERE program_id = ?"
    ).all(program.id);
    const checklistItems = (db as any).$client.prepare(
      "SELECT * FROM competency_checklist_items WHERE program_id = ? ORDER BY sort_order"
    ).all(program.id);
    const employees = (db as any).$client.prepare(
      "SELECT * FROM competency_employees WHERE user_id = ? ORDER BY name"
    ).all(req.user.userId);
    const assessments = (db as any).$client.prepare(
      `SELECT a.*, e.name as employee_name, e.title as employee_title, e.hire_date as employee_hire_date, e.lis_initials as employee_lis_initials
       FROM competency_assessments a
       JOIN competency_employees e ON a.employee_id = e.id
       WHERE a.program_id = ?
       ORDER BY a.created_at DESC`
    ).all(program.id);
    // Attach items to each assessment
    const assessmentsWithItems = assessments.map((a: any) => {
      const items = (db as any).$client.prepare(
        "SELECT * FROM competency_assessment_items WHERE assessment_id = ?"
      ).all(a.id);
      return { ...a, items };
    });
    res.json({ ...program, methodGroups, checklistItems, employees, assessments: assessmentsWithItems });
  });

  // Delete program
  app.delete("/api/competency/programs/:id", authMiddleware, requireWriteAccess, requireModuleEdit('veritacomp'), (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaComp\u2122 subscription required" });
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const program = (db as any).$client.prepare("SELECT id FROM competency_programs WHERE id = ? AND user_id = ?").get(req.params.id, dataUserId);
    if (!program) return res.status(404).json({ error: "Program not found" });
    // Cascade delete
    const assessments = (db as any).$client.prepare("SELECT id FROM competency_assessments WHERE program_id = ?").all(req.params.id);
    for (const a of assessments) {
      (db as any).$client.prepare("DELETE FROM competency_assessment_items WHERE assessment_id = ?").run(a.id);
    }
    (db as any).$client.prepare("DELETE FROM competency_assessments WHERE program_id = ?").run(req.params.id);
    (db as any).$client.prepare("DELETE FROM competency_method_groups WHERE program_id = ?").run(req.params.id);
    (db as any).$client.prepare("DELETE FROM competency_checklist_items WHERE program_id = ?").run(req.params.id);
    (db as any).$client.prepare("DELETE FROM competency_programs WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  });

  // Update program settings (method groups, checklist items, name)
  app.put("/api/competency/programs/:id", authMiddleware, requireWriteAccess, requireModuleEdit('veritacomp'), (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaComp\u2122 subscription required" });
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const program = (db as any).$client.prepare("SELECT * FROM competency_programs WHERE id = ? AND user_id = ?").get(req.params.id, dataUserId);
    if (!program) return res.status(404).json({ error: "Program not found" });
    const { name, department, methodGroups, checklistItems } = req.body;
    const now = new Date().toISOString();
    if (name) (db as any).$client.prepare("UPDATE competency_programs SET name = ?, updated_at = ? WHERE id = ?").run(name.trim(), now, req.params.id);
    if (department) (db as any).$client.prepare("UPDATE competency_programs SET department = ?, updated_at = ? WHERE id = ?").run(department, now, req.params.id);
    // Replace method groups
    if (Array.isArray(methodGroups)) {
      (db as any).$client.prepare("DELETE FROM competency_method_groups WHERE program_id = ?").run(req.params.id);
      const stmt = (db as any).$client.prepare(
        "INSERT INTO competency_method_groups (program_id, name, instruments, analytes, notes) VALUES (?, ?, ?, ?, ?)"
      );
      for (const g of methodGroups) {
        stmt.run(req.params.id, g.name, JSON.stringify(g.instruments || []), JSON.stringify(g.analytes || []), g.notes || null);
      }
    }
    // Replace checklist items
    if (Array.isArray(checklistItems)) {
      (db as any).$client.prepare("DELETE FROM competency_checklist_items WHERE program_id = ?").run(req.params.id);
      const stmt = (db as any).$client.prepare(
        "INSERT INTO competency_checklist_items (program_id, label, description, sort_order) VALUES (?, ?, ?, ?)"
      );
      checklistItems.forEach((item: any, idx: number) => {
        stmt.run(req.params.id, item.label || String.fromCharCode(65 + idx), item.description, idx);
      });
    }
    (db as any).$client.prepare("UPDATE competency_programs SET updated_at = ? WHERE id = ?").run(now, req.params.id);
    res.json({ ok: true });
  });

  // ── EMPLOYEES ─────────────────────────────────────────────────────────────

  app.get("/api/competency/employees", authMiddleware, (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaComp\u2122 subscription required" });
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const employees = (db as any).$client.prepare(
      "SELECT * FROM competency_employees WHERE user_id = ? ORDER BY name"
    ).all(dataUserId);
    res.json(employees);
  });

  app.post("/api/competency/employees", authMiddleware, requireWriteAccess, requireModuleEdit('veritacomp'), (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaComp\u2122 subscription required" });
    const { name, title, hireDate, lisInitials } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "Employee name required" });
    const now = new Date().toISOString();
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const result = (db as any).$client.prepare(
      "INSERT INTO competency_employees (user_id, name, title, hire_date, lis_initials, status, created_at) VALUES (?, ?, ?, ?, ?, 'active', ?)"
    ).run(dataUserId, name.trim(), title || "", hireDate || null, lisInitials || null, now);
    res.json({ id: Number(result.lastInsertRowid), user_id: dataUserId, name: name.trim(), title: title || "", hire_date: hireDate || null, lis_initials: lisInitials || null, status: "active", created_at: now });
  });

  app.put("/api/competency/employees/:id", authMiddleware, requireWriteAccess, requireModuleEdit('veritacomp'), (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaComp\u2122 subscription required" });
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const emp = (db as any).$client.prepare("SELECT id FROM competency_employees WHERE id = ? AND user_id = ?").get(req.params.id, dataUserId);
    if (!emp) return res.status(404).json({ error: "Employee not found" });
    const { name, title, hireDate, lisInitials, status } = req.body;
    const sets: string[] = [];
    const vals: any[] = [];
    if (name !== undefined) { sets.push("name = ?"); vals.push(name.trim()); }
    if (title !== undefined) { sets.push("title = ?"); vals.push(title); }
    if (hireDate !== undefined) { sets.push("hire_date = ?"); vals.push(hireDate); }
    if (lisInitials !== undefined) { sets.push("lis_initials = ?"); vals.push(lisInitials); }
    if (status !== undefined) { sets.push("status = ?"); vals.push(status); }
    if (sets.length) {
      vals.push(req.params.id);
      (db as any).$client.prepare(`UPDATE competency_employees SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
    }
    res.json({ ok: true });
  });

  app.delete("/api/competency/employees/:id", authMiddleware, requireWriteAccess, requireModuleEdit('veritacomp'), (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaComp\u2122 subscription required" });
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const emp = (db as any).$client.prepare("SELECT id FROM competency_employees WHERE id = ? AND user_id = ?").get(req.params.id, dataUserId);
    if (!emp) return res.status(404).json({ error: "Employee not found" });
    (db as any).$client.prepare("UPDATE competency_employees SET status = 'inactive' WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  });

  // ── ASSESSMENTS ───────────────────────────────────────────────────────────

  app.post("/api/competency/assessments", authMiddleware, requireWriteAccess, requireModuleEdit('veritacomp'), (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaComp\u2122 subscription required" });
    const { programId, employeeId, assessmentType, assessmentDate, evaluatorName, evaluatorTitle, evaluatorInitials, competencyType, status, remediationPlan, employeeAcknowledged, supervisorAcknowledged, items } = req.body;
    // Verify program and employee belong to user
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const program = (db as any).$client.prepare("SELECT id FROM competency_programs WHERE id = ? AND user_id = ?").get(programId, dataUserId);
    if (!program) return res.status(404).json({ error: "Program not found" });
    const emp = (db as any).$client.prepare("SELECT id FROM competency_employees WHERE id = ? AND user_id = ?").get(employeeId, dataUserId);
    if (!emp) return res.status(404).json({ error: "Employee not found" });
    const now = new Date().toISOString();
    const result = (db as any).$client.prepare(
      `INSERT INTO competency_assessments (program_id, employee_id, assessment_type, assessment_date, evaluator_name, evaluator_title, evaluator_initials, competency_type, status, remediation_plan, employee_acknowledged, supervisor_acknowledged, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(programId, employeeId, assessmentType || "initial", assessmentDate || now.split("T")[0], evaluatorName || null, evaluatorTitle || null, evaluatorInitials || null, competencyType || "technical", status || "pass", remediationPlan || null, employeeAcknowledged ? 1 : 0, supervisorAcknowledged ? 1 : 0, now);
    const assessmentId = Number(result.lastInsertRowid);

    // Insert assessment items (with new element-specific columns)
    if (Array.isArray(items)) {
      const stmt = (db as any).$client.prepare(
        `INSERT INTO competency_assessment_items (
          assessment_id, method_number, method_group_id, item_label, item_description,
          evidence, date_met, employee_initials, supervisor_initials, passed, specimen_info,
          element_number, method_group_name,
          el1_specimen_id, el1_observer_initials, el1_na, el1_na_justification,
          el2_evidence, el2_date, el2_na, el2_na_justification,
          el3_qc_date, el3_na, el3_na_justification,
          el4_date_observed, el4_observer_initials, el4_na, el4_na_justification,
          el5_sample_type, el5_sample_id, el5_acceptable, el5_na, el5_na_justification,
          el6_quiz_id, el6_score, el6_date_taken, el6_na, el6_na_justification,
          waived_instrument, waived_test, waived_method_number, waived_evidence, waived_date, waived_initials,
          nt_item_label, nt_item_description, nt_date_met, nt_employee_initials, nt_supervisor_initials
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const item of items) {
        stmt.run(
          assessmentId,
          item.methodNumber ?? null, item.methodGroupId ?? null,
          item.itemLabel ?? null, item.itemDescription ?? null,
          item.evidence ?? null, item.dateMet ?? null,
          item.employeeInitials ?? null, item.supervisorInitials ?? null,
          item.passed ? 1 : 0, item.specimenInfo ?? null,
          item.elementNumber ?? null, item.methodGroupName ?? null,
          item.el1SpecimenId ?? null, item.el1ObserverInitials ?? null,
          item.el1Na ? 1 : 0, item.el1NaJustification ?? null,
          item.el2Evidence ?? null, item.el2Date ?? null,
          item.el2Na ? 1 : 0, item.el2NaJustification ?? null,
          item.el3QcDate ?? null,
          item.el3Na ? 1 : 0, item.el3NaJustification ?? null,
          item.el4DateObserved ?? null, item.el4ObserverInitials ?? null,
          item.el4Na ? 1 : 0, item.el4NaJustification ?? null,
          item.el5SampleType ?? null, item.el5SampleId ?? null,
          item.el5Acceptable != null ? (item.el5Acceptable ? 1 : 0) : null,
          item.el5Na ? 1 : 0, item.el5NaJustification ?? null,
          item.el6QuizId ?? null, item.el6Score ?? null, item.el6DateTaken ?? null,
          item.el6Na ? 1 : 0, item.el6NaJustification ?? null,
          item.waivedInstrument ?? null, item.waivedTest ?? null,
          item.waivedMethodNumber ?? null, item.waivedEvidence ?? null,
          item.waivedDate ?? null, item.waivedInitials ?? null,
          item.ntItemLabel ?? null, item.ntItemDescription ?? null,
          item.ntDateMet ?? null, item.ntEmployeeInitials ?? null, item.ntSupervisorInitials ?? null
        );
      }
    }

    // Update program updated_at
    (db as any).$client.prepare("UPDATE competency_programs SET updated_at = ? WHERE id = ?").run(now, programId);

    // VeritaScan integration: auto-complete competency items
    if (status === "pass") {
      autoCompleteCompetencyScanItems(dataUserId, competencyType || "technical");
    }

    res.json({ id: assessmentId, program_id: programId, employee_id: employeeId, status: status || "pass", created_at: now });
  });

  // Update assessment
  app.put("/api/competency/assessments/:id", authMiddleware, requireWriteAccess, requireModuleEdit('veritacomp'), (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaComp\u2122 subscription required" });
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const assessment = (db as any).$client.prepare(
      `SELECT a.id, p.user_id FROM competency_assessments a
       JOIN competency_programs p ON a.program_id = p.id
       WHERE a.id = ?`
    ).get(req.params.id);
    if (!assessment || assessment.user_id !== dataUserId) return res.status(404).json({ error: "Assessment not found" });
    const { status, evaluatorName, evaluatorTitle, evaluatorInitials, remediationPlan, employeeAcknowledged, supervisorAcknowledged, items } = req.body;
    const sets: string[] = [];
    const vals: any[] = [];
    if (status !== undefined) { sets.push("status = ?"); vals.push(status); }
    if (evaluatorName !== undefined) { sets.push("evaluator_name = ?"); vals.push(evaluatorName); }
    if (evaluatorTitle !== undefined) { sets.push("evaluator_title = ?"); vals.push(evaluatorTitle); }
    if (evaluatorInitials !== undefined) { sets.push("evaluator_initials = ?"); vals.push(evaluatorInitials); }
    if (remediationPlan !== undefined) { sets.push("remediation_plan = ?"); vals.push(remediationPlan); }
    if (employeeAcknowledged !== undefined) { sets.push("employee_acknowledged = ?"); vals.push(employeeAcknowledged ? 1 : 0); }
    if (supervisorAcknowledged !== undefined) { sets.push("supervisor_acknowledged = ?"); vals.push(supervisorAcknowledged ? 1 : 0); }
    if (sets.length) {
      vals.push(req.params.id);
      (db as any).$client.prepare(`UPDATE competency_assessments SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
    }
    // Replace items if provided
    if (Array.isArray(items)) {
      (db as any).$client.prepare("DELETE FROM competency_assessment_items WHERE assessment_id = ?").run(req.params.id);
      const stmt = (db as any).$client.prepare(
        `INSERT INTO competency_assessment_items (
          assessment_id, method_number, method_group_id, item_label, item_description,
          evidence, date_met, employee_initials, supervisor_initials, passed, specimen_info,
          element_number, method_group_name,
          el1_specimen_id, el1_observer_initials, el1_na, el1_na_justification,
          el2_evidence, el2_date, el2_na, el2_na_justification,
          el3_qc_date, el3_na, el3_na_justification,
          el4_date_observed, el4_observer_initials, el4_na, el4_na_justification,
          el5_sample_type, el5_sample_id, el5_acceptable, el5_na, el5_na_justification,
          el6_quiz_id, el6_score, el6_date_taken, el6_na, el6_na_justification,
          waived_instrument, waived_test, waived_method_number, waived_evidence, waived_date, waived_initials,
          nt_item_label, nt_item_description, nt_date_met, nt_employee_initials, nt_supervisor_initials
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const item of items) {
        stmt.run(
          req.params.id,
          item.methodNumber ?? null, item.methodGroupId ?? null,
          item.itemLabel ?? null, item.itemDescription ?? null,
          item.evidence ?? null, item.dateMet ?? null,
          item.employeeInitials ?? null, item.supervisorInitials ?? null,
          item.passed ? 1 : 0, item.specimenInfo ?? null,
          item.elementNumber ?? null, item.methodGroupName ?? null,
          item.el1SpecimenId ?? null, item.el1ObserverInitials ?? null,
          item.el1Na ? 1 : 0, item.el1NaJustification ?? null,
          item.el2Evidence ?? null, item.el2Date ?? null,
          item.el2Na ? 1 : 0, item.el2NaJustification ?? null,
          item.el3QcDate ?? null,
          item.el3Na ? 1 : 0, item.el3NaJustification ?? null,
          item.el4DateObserved ?? null, item.el4ObserverInitials ?? null,
          item.el4Na ? 1 : 0, item.el4NaJustification ?? null,
          item.el5SampleType ?? null, item.el5SampleId ?? null,
          item.el5Acceptable != null ? (item.el5Acceptable ? 1 : 0) : null,
          item.el5Na ? 1 : 0, item.el5NaJustification ?? null,
          item.el6QuizId ?? null, item.el6Score ?? null, item.el6DateTaken ?? null,
          item.el6Na ? 1 : 0, item.el6NaJustification ?? null,
          item.waivedInstrument ?? null, item.waivedTest ?? null,
          item.waivedMethodNumber ?? null, item.waivedEvidence ?? null,
          item.waivedDate ?? null, item.waivedInitials ?? null,
          item.ntItemLabel ?? null, item.ntItemDescription ?? null,
          item.ntDateMet ?? null, item.ntEmployeeInitials ?? null, item.ntSupervisorInitials ?? null
        );
      }
    }
    res.json({ ok: true });
  });

  // Delete assessment
  app.delete("/api/competency/assessments/:id", authMiddleware, requireWriteAccess, requireModuleEdit('veritacomp'), (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaComp\u2122 subscription required" });
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const assessment = (db as any).$client.prepare(
      `SELECT a.id, p.user_id FROM competency_assessments a
       JOIN competency_programs p ON a.program_id = p.id
       WHERE a.id = ?`
    ).get(req.params.id);
    if (!assessment || assessment.user_id !== dataUserId) return res.status(404).json({ error: "Assessment not found" });
    const delAssessment = (db as any).$client.prepare("SELECT * FROM competency_assessments WHERE id = ?").get(req.params.id) as any;
    const delAssessItems = (db as any).$client.prepare("SELECT * FROM competency_assessment_items WHERE assessment_id = ?").all(req.params.id);
    logAudit({ userId: req.userId, ownerUserId: req.ownerUserId ?? req.userId, module: "veritacomp", action: "delete", entityType: "assessment", entityId: req.params.id, entityLabel: delAssessment ? `${delAssessment.employee_name} - ${delAssessment.program_name}` : undefined, before: { assessment: delAssessment, items: delAssessItems }, ipAddress: req.ip });
    (db as any).$client.prepare("DELETE FROM competency_assessment_items WHERE assessment_id = ?").run(req.params.id);
    (db as any).$client.prepare("DELETE FROM competency_assessments WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  });

  // ── VERITACOMP ALIASED ROUTES ──────────────────────────────────────────

  // GET /api/veritacomp/assessments/:id
  app.get("/api/veritacomp/assessments/:id", authMiddleware, (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaComp\u2122 subscription required" });
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const assessment = (db as any).$client.prepare(
      `SELECT a.*, p.name as program_name, p.department, p.type as program_type,
              e.name as employee_name, e.title as employee_title, e.hire_date as employee_hire_date, e.lis_initials as employee_lis_initials
       FROM competency_assessments a
       JOIN competency_programs p ON a.program_id = p.id
       JOIN competency_employees e ON a.employee_id = e.id
       WHERE a.id = ? AND p.user_id = ?`
    ).get(req.params.id, dataUserId);
    if (!assessment) return res.status(404).json({ error: "Assessment not found" });
    const items = (db as any).$client.prepare("SELECT * FROM competency_assessment_items WHERE assessment_id = ?").all(assessment.id);
    const methodGroups = (db as any).$client.prepare("SELECT * FROM competency_method_groups WHERE program_id = ?").all(assessment.program_id);
    res.json({ ...assessment, items, methodGroups });
  });

  // GET /api/veritacomp/programs/:id/assessments
  app.get("/api/veritacomp/programs/:id/assessments", authMiddleware, (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaComp\u2122 subscription required" });
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const program = (db as any).$client.prepare("SELECT id FROM competency_programs WHERE id = ? AND user_id = ?").get(req.params.id, dataUserId);
    if (!program) return res.status(404).json({ error: "Program not found" });
    const assessments = (db as any).$client.prepare(
      `SELECT a.*, e.name as employee_name, e.title as employee_title, e.hire_date as employee_hire_date
       FROM competency_assessments a
       JOIN competency_employees e ON a.employee_id = e.id
       WHERE a.program_id = ?
       ORDER BY a.created_at DESC`
    ).all(req.params.id);
    res.json(assessments);
  });

  // ── QUIZ ENDPOINTS ──────────────────────────────────────────────────────

  // GET /api/veritacomp/programs/:id/quizzes
  app.get("/api/veritacomp/programs/:id/quizzes", authMiddleware, (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaComp\u2122 subscription required" });
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const program = (db as any).$client.prepare("SELECT id FROM competency_programs WHERE id = ? AND user_id = ?").get(req.params.id, dataUserId);
    if (!program) return res.status(404).json({ error: "Program not found" });
    // Get user quizzes for this program + system quizzes (user_id = 0)
    const quizzes = (db as any).$client.prepare(
      "SELECT id, user_id, program_id, method_group_id, method_group_name, created_at FROM competency_quizzes WHERE program_id = ? OR user_id = 0 OR user_id = ?"
    ).all(req.params.id, dataUserId);
    res.json(quizzes);
  });

  // POST /api/veritacomp/programs/:id/quizzes
  app.post("/api/veritacomp/programs/:id/quizzes", authMiddleware, requireWriteAccess, requireModuleEdit('veritacomp'), (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaComp\u2122 subscription required" });
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const program = (db as any).$client.prepare("SELECT id FROM competency_programs WHERE id = ? AND user_id = ?").get(req.params.id, dataUserId);
    if (!program) return res.status(404).json({ error: "Program not found" });
    const { methodGroupId, methodGroupName, questions } = req.body;
    if (!questions || !Array.isArray(questions)) return res.status(400).json({ error: "questions array required" });
    const now = new Date().toISOString();
    const result = (db as any).$client.prepare(
      "INSERT INTO competency_quizzes (user_id, program_id, method_group_id, method_group_name, questions, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(dataUserId, parseInt(req.params.id), methodGroupId || null, methodGroupName || null, JSON.stringify(questions), now);
    res.json({ id: Number(result.lastInsertRowid), program_id: parseInt(req.params.id), method_group_id: methodGroupId, method_group_name: methodGroupName, created_at: now });
  });

  // GET /api/veritacomp/quizzes/:id (without revealing correct answers)
  app.get("/api/veritacomp/quizzes/:id", authMiddleware, (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaComp\u2122 subscription required" });
    const quiz = (db as any).$client.prepare("SELECT * FROM competency_quizzes WHERE id = ?").get(req.params.id) as any;
    if (!quiz) return res.status(404).json({ error: "Quiz not found" });
    // Strip correct_answer and explanation from questions
    const questions = JSON.parse(quiz.questions || "[]").map((q: any) => ({
      id: q.id,
      question: q.question,
      type: q.type,
      options: q.options,
    }));
    res.json({ ...quiz, questions });
  });

  // POST /api/veritacomp/quiz-results - submit quiz, auto-score
  app.post("/api/veritacomp/quiz-results", authMiddleware, requireWriteAccess, requireModuleEdit('veritacomp'), (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaComp\u2122 subscription required" });
    const { quizId, assessmentId, employeeId, answers } = req.body;
    if (!quizId || !employeeId || !Array.isArray(answers)) return res.status(400).json({ error: "quizId, employeeId, and answers array required" });
    const quiz = (db as any).$client.prepare("SELECT * FROM competency_quizzes WHERE id = ?").get(quizId) as any;
    if (!quiz) return res.status(404).json({ error: "Quiz not found" });
    const questions = JSON.parse(quiz.questions || "[]");
    // Score
    let correct = 0;
    const gradedAnswers = answers.map((a: any) => {
      const q = questions.find((qq: any) => qq.id === a.question_id);
      const isCorrect = q && a.selected_answer === q.correct_answer;
      if (isCorrect) correct++;
      return { question_id: a.question_id, selected_answer: a.selected_answer, correct: !!isCorrect };
    });
    const score = questions.length > 0 ? Math.round((correct / questions.length) * 100) : 0;
    const passed = score === 100;
    const now = new Date().toISOString();
    const dateTaken = now.split("T")[0];
    const result = (db as any).$client.prepare(
      "INSERT INTO competency_quiz_results (assessment_id, quiz_id, employee_id, answers, score, passed, date_taken, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(assessmentId || null, quizId, employeeId, JSON.stringify(gradedAnswers), score, passed ? 1 : 0, dateTaken, now);
    // Return full result including correct answers + explanations for review
    const fullQuestions = questions.map((q: any) => {
      const ga = gradedAnswers.find((a: any) => a.question_id === q.id);
      return { ...q, selected_answer: ga?.selected_answer, was_correct: ga?.correct };
    });
    res.json({
      id: Number(result.lastInsertRowid),
      quiz_id: quizId,
      employee_id: employeeId,
      score,
      passed,
      date_taken: dateTaken,
      answers: gradedAnswers,
      questions: fullQuestions,
    });
  });

  // GET /api/veritacomp/assessments/:id/quiz-results
  app.get("/api/veritacomp/assessments/:id/quiz-results", authMiddleware, (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaComp\u2122 subscription required" });
    const results = (db as any).$client.prepare(
      `SELECT qr.*, q.method_group_name, q.questions as quiz_questions
       FROM competency_quiz_results qr
       JOIN competency_quizzes q ON qr.quiz_id = q.id
       WHERE qr.assessment_id = ?
       ORDER BY qr.created_at DESC`
    ).all(req.params.id);
    res.json(results);
  });

  // GET /api/veritacomp/assessments/:id/pdf
  app.get("/api/veritacomp/assessments/:id/pdf", authMiddleware, async (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaComp\u2122 subscription required" });
    const assessment = (db as any).$client.prepare(
      `SELECT a.*, p.name as program_name, p.department, p.type as program_type,
              e.name as employee_name, e.title as employee_title, e.hire_date as employee_hire_date, e.lis_initials as employee_lis_initials
       FROM competency_assessments a
       JOIN competency_programs p ON a.program_id = p.id
       JOIN competency_employees e ON a.employee_id = e.id
       WHERE a.id = ? AND p.user_id = ?`
    ).get(req.params.id, req.ownerUserId ?? req.user.userId);
    if (!assessment) return res.status(404).json({ error: "Assessment not found" });
    const items = (db as any).$client.prepare("SELECT * FROM competency_assessment_items WHERE assessment_id = ?").all(assessment.id);
    const methodGroups = (db as any).$client.prepare("SELECT * FROM competency_method_groups WHERE program_id = ?").all(assessment.program_id);
    const checklistItems = (db as any).$client.prepare("SELECT * FROM competency_checklist_items WHERE program_id = ? ORDER BY sort_order").all(assessment.program_id);
    const quizResults = (db as any).$client.prepare(
      `SELECT qr.*, q.method_group_name, q.questions as quiz_questions
       FROM competency_quiz_results qr
       JOIN competency_quizzes q ON qr.quiz_id = q.id
       WHERE qr.assessment_id = ?`
    ).all(assessment.id);
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const compLab = resolveLabForUser(dataUserId);
    const compCliaNumber = compLab?.clia_number || undefined;
    const compLabName = compLab?.lab_name || undefined;
    // Fallback to user record if no lab row yet
    let labName = compLabName || "Clinical Laboratory";
    let cliaForComp = compCliaNumber;
    if (!compLab) {
      const compUserRow = (db as any).$client.prepare("SELECT clia_number, clia_lab_name FROM users WHERE id = ?").get(dataUserId) as any;
      labName = compUserRow?.clia_lab_name || "Clinical Laboratory";
      cliaForComp = compUserRow?.clia_number || undefined;
    }
    try {
      const pdfBuffer = await generateCompetencyPDF({ assessment, items, methodGroups, checklistItems, labName, quizResults, cliaNumber: cliaForComp });
      const safeName = assessment.employee_name.replace(/[^a-zA-Z0-9_\- ]/g, "").trim();
      const date = new Date().toISOString().split("T")[0];
      const typeLabel = assessment.program_type === "technical" ? "Technical" : assessment.program_type === "waived" ? "Waived" : "NonTechnical";
      const filename = `VeritaComp_${typeLabel}_${safeName}_${date}.pdf`;
      const veritacompToken = storePdfToken(pdfBuffer, filename);
      if (compLab) markLabReportingLocks(compLab.id);
      res.json({ token: veritacompToken });
    } catch (err: any) {
      console.error("Competency PDF generation error:", err);
      res.status(500).json({ error: "PDF generation failed", detail: err.message });
    }
  });

  // VeritaMap integration — get instruments from a map for method group suggestions
  app.get("/api/competency/map-instruments/:mapId", authMiddleware, (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaComp\u2122 subscription required" });
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const map = (db as any).$client.prepare("SELECT id FROM veritamap_maps WHERE id = ? AND user_id = ?").get(req.params.mapId, dataUserId);
    if (!map) return res.status(404).json({ error: "Map not found" });
    const instruments = (db as any).$client.prepare(
      "SELECT id, instrument_name, role, category FROM veritamap_instruments WHERE map_id = ?"
    ).all(req.params.mapId);
    const instrumentsWithTests = instruments.map((inst: any) => {
      const tests = (db as any).$client.prepare(
        "SELECT analyte, specialty, complexity FROM veritamap_instrument_tests WHERE instrument_id = ? AND active = 1"
      ).all(inst.id);
      return { ...inst, tests };
    });
    res.json(instrumentsWithTests);
  });

  // PDF generation for competency assessments
  app.post("/api/competency/pdf/:assessmentId", authMiddleware, async (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaComp\u2122 subscription required" });
    const assessment = (db as any).$client.prepare(
      `SELECT a.*, p.name as program_name, p.department, p.type as program_type,
              e.name as employee_name, e.title as employee_title, e.hire_date as employee_hire_date, e.lis_initials as employee_lis_initials
       FROM competency_assessments a
       JOIN competency_programs p ON a.program_id = p.id
       JOIN competency_employees e ON a.employee_id = e.id
       WHERE a.id = ? AND p.user_id = ?`
    ).get(req.params.assessmentId, req.ownerUserId ?? req.user.userId);
    if (!assessment) return res.status(404).json({ error: "Assessment not found" });

    const items = (db as any).$client.prepare(
      "SELECT * FROM competency_assessment_items WHERE assessment_id = ?"
    ).all(assessment.id);

    const methodGroups = (db as any).$client.prepare(
      "SELECT * FROM competency_method_groups WHERE program_id = ?"
    ).all(assessment.program_id);

    const checklistItems = (db as any).$client.prepare(
      "SELECT * FROM competency_checklist_items WHERE program_id = ? ORDER BY sort_order"
    ).all(assessment.program_id);

    const quizResults = (db as any).$client.prepare(
      `SELECT qr.*, q.method_group_name, q.questions as quiz_questions
       FROM competency_quiz_results qr
       JOIN competency_quizzes q ON qr.quiz_id = q.id
       WHERE qr.assessment_id = ?`
    ).all(assessment.id);

    // Get user info for lab name
    const dataUserId2 = req.ownerUserId ?? req.user.userId;
    const labUser = storage.getUserById(dataUserId2);
    const labName = labUser?.name || "Clinical Laboratory";
    const compUserRow2 = (db as any).$client.prepare("SELECT clia_number FROM users WHERE id = ?").get(dataUserId2) as any;

    try {
      const pdfBuffer = await generateCompetencyPDF({
        assessment,
        items,
        methodGroups,
        checklistItems,
        labName,
        quizResults,
        cliaNumber: compUserRow2?.clia_number || undefined,
      });

      const safeName = assessment.employee_name.replace(/[^a-zA-Z0-9_\- ]/g, "").trim();
      const date = new Date().toISOString().split("T")[0];
      const typeLabel = assessment.program_type === "technical" ? "Technical" : assessment.program_type === "waived" ? "Waived" : "NonTechnical";
      const filename = `VeritaStaff_${typeLabel}_${safeName}_${date}.pdf`;

      const veritastaffToken = storePdfToken(pdfBuffer, filename);
      res.json({ token: veritastaffToken });
    } catch (err: any) {
      console.error("Competency PDF generation error:", err);
      res.status(500).json({ error: "PDF generation failed", detail: err.message });
    }
  });

  // VeritaScan integration for competency
  function autoCompleteCompetencyScanItems(userId: number, competencyType: string) {
    const scans = (db as any).$client.prepare(
      "SELECT id FROM veritascan_scans WHERE user_id = ?"
    ).all(userId) as { id: number }[];
    if (scans.length === 0) return;

    const now = new Date().toISOString();
    // Domain IX (Personnel & Competency) items: 54-72
    // Map competency type to specific items
    const itemIds: number[] = [];
    if (competencyType === "technical") {
      itemIds.push(60, 61, 62, 63); // 6 CLIA methods, semiannual, annual, documentation
    } else if (competencyType === "waived") {
      itemIds.push(64, 65); // waived testing competency
    } else if (competencyType === "nontechnical") {
      itemIds.push(66, 67); // nontechnical competency
    }
    if (itemIds.length === 0) return;

    const completionNote = `Auto-completed by VeritaComp\u2122: ${competencyType} assessment on ${now.split("T")[0]}`;
    const upsertStmt = (db as any).$client.prepare(`
      INSERT INTO veritascan_items (scan_id, item_id, status, notes, completion_source, completion_link, completion_note, updated_at)
      VALUES (?, ?, 'Compliant', ?, 'veritacomp_auto', '/veritacomp-app', ?, ?)
      ON CONFLICT(scan_id, item_id) DO UPDATE SET
        status = 'Compliant',
        completion_source = 'veritacomp_auto',
        completion_link = '/veritacomp-app',
        completion_note = excluded.completion_note,
        updated_at = excluded.updated_at
      WHERE status != 'Compliant' OR completion_source != 'veritacomp_auto'
    `);

    const bulkUpdate = (db as any).$client.transaction(() => {
      for (const scan of scans) {
        for (const itemId of itemIds) {
          upsertStmt.run(scan.id, itemId, completionNote, completionNote, now);
        }
      }
    });
    bulkUpdate();

    for (const scan of scans) {
      (db as any).$client.prepare("UPDATE veritascan_scans SET updated_at = ? WHERE id = ?").run(now, scan.id);
    }
  }

  // CUMSUM PDF export
  app.post("/api/veritacheck/cumsum/trackers/:id/pdf", authMiddleware, async (req: any, res) => {
    if (!hasCheckAccess(req.user)) return res.status(403).json({ error: "Subscription required" });
    const tracker = (db as any).$client.prepare("SELECT * FROM cumsum_trackers WHERE id = ? AND user_id = ?").get(req.params.id, req.user.userId);
    if (!tracker) return res.status(404).json({ error: "Tracker not found" });
    const entries = (db as any).$client.prepare("SELECT * FROM cumsum_entries WHERE tracker_id = ? ORDER BY id ASC").all(req.params.id);
    const { currentSpecimens } = req.body || {};
    const cumsumLab = resolveLabForUser(req.userId);
    let cumsumClia: string | undefined;
    let cumsumLabName: string | undefined;
    if (cumsumLab) {
      cumsumClia = cumsumLab.clia_number || undefined;
      cumsumLabName = cumsumLab.lab_name || undefined;
    } else {
      const cumsumUserRow = (db as any).$client.prepare("SELECT clia_number, clia_lab_name FROM users WHERE id = ?").get(req.userId) as any;
      cumsumClia = cumsumUserRow?.clia_number || undefined;
      cumsumLabName = cumsumUserRow?.clia_lab_name || undefined;
    }
    try {
      const pdfBuffer = await generateCumsumPDF(tracker, entries, currentSpecimens, cumsumClia, cumsumLabName);
      const safeName = tracker.instrument_name.replace(/[^a-zA-Z0-9_\- ]/g, "").trim();
      const filename = `VeritaCheck_CUMSUM_${safeName}_${new Date().toISOString().split("T")[0]}.pdf`;
      const cumsumToken = storePdfToken(pdfBuffer, filename);
      if (cumsumLab) markLabReportingLocks(cumsumLab.id);
      res.json({ token: cumsumToken });
    } catch (e: any) {
      console.error("CUMSUM PDF error:", e);
      res.status(500).json({ error: "PDF generation failed" });
    }
  });

  // ── VERITASTAFF ──────────────────────────────────────────────────────────

  function hasStaffAccess(user: any) {
    return ["annual", "professional", "lab", "complete", "veritamap", "veritascan", "veritacomp", "waived", "community", "hospital", "large_hospital", "enterprise"].includes(user?.plan);
  }

  // CMS specialty list (for validation and labels)
  const CMS_SPECIALTIES: Record<number, string> = {
    1: "Bacteriology", 2: "Mycobacteriology", 3: "Mycology", 4: "Parasitology",
    5: "Virology", 6: "Diagnostic Immunology", 7: "Chemistry", 8: "Hematology",
    9: "Immunohematology", 10: "Radiobioassay", 11: "Cytology", 12: "Histopathology",
    13: "Dermatopathology", 14: "Ophthalmic Pathology", 15: "Oral Pathology",
    16: "Histocompatibility", 17: "Clinical Cytogenetics",
  };

  // VeritaMap department to CMS specialty mapping
  const VERITAMAP_DEPT_TO_CMS: Record<string, number[]> = {
    "Chemistry": [7], "Hematology": [8], "Blood Bank": [9], "Coagulation": [7],
    "Microbiology": [1], "Urinalysis": [7], "Molecular": [1, 6],
    "Immunology / Protein": [6], "Blood Gas": [7], "Point of Care": [7],
    "Histology / Pathology": [12], "Cytology": [11],
  };

  // Get or create staff lab
  app.get("/api/staff/lab", authMiddleware, (req: any, res) => {
    if (!hasStaffAccess(req.user)) return res.status(403).json({ error: "VeritaStaff\u2122 subscription required" });
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const lab = (db as any).$client.prepare("SELECT * FROM staff_labs WHERE user_id = ?").get(dataUserId);
    res.json(lab || null);
  });

  app.post("/api/staff/lab", authMiddleware, requireWriteAccess, requireModuleEdit('veritastaff'), (req: any, res) => {
    if (!hasStaffAccess(req.user)) return res.status(403).json({ error: "VeritaStaff\u2122 subscription required" });
    const { labName, cliaNumber, street, city, state, zip, phone, certificateType, accreditationBody, accreditationBodyOther, includesNys, complexity } = req.body;
    if (!labName?.trim() || !cliaNumber?.trim()) return res.status(400).json({ error: "Lab name and CLIA number required" });
    const now = new Date().toISOString();
    const dataUserId = req.ownerUserId ?? req.user.userId;

    const existing = (db as any).$client.prepare("SELECT id FROM staff_labs WHERE user_id = ?").get(dataUserId);
    if (existing) {
      (db as any).$client.prepare(
        "UPDATE staff_labs SET lab_name=?, clia_number=?, lab_address_street=?, lab_address_city=?, lab_address_state=?, lab_address_zip=?, lab_phone=?, certificate_type=?, accreditation_body=?, accreditation_body_other=?, includes_nys=?, complexity=?, updated_at=? WHERE id=?"
      ).run(labName.trim(), cliaNumber.trim(), street || '', city || '', state || '', zip || '', phone || '', certificateType || 'compliance', accreditationBody || 'CLIA_ONLY', accreditationBodyOther || '', includesNys ? 1 : 0, complexity || 'high', now, existing.id);
      const updated = (db as any).$client.prepare("SELECT * FROM staff_labs WHERE id = ?").get(existing.id);
      return res.json(updated);
    }

    const result = (db as any).$client.prepare(
      "INSERT INTO staff_labs (user_id, lab_name, clia_number, lab_address_street, lab_address_city, lab_address_state, lab_address_zip, lab_phone, certificate_type, accreditation_body, accreditation_body_other, includes_nys, complexity, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
    ).run(dataUserId, labName.trim(), cliaNumber.trim(), street || '', city || '', state || '', zip || '', phone || '', certificateType || 'compliance', accreditationBody || 'CLIA_ONLY', accreditationBodyOther || '', includesNys ? 1 : 0, complexity || 'high', now, now);
    const lab = (db as any).$client.prepare("SELECT * FROM staff_labs WHERE id = ?").get(result.lastInsertRowid);
    res.json(lab);
  });

  // Get VeritaMap department suggestions
  app.get("/api/staff/veritamap-suggestions", authMiddleware, (req: any, res) => {
    if (!hasStaffAccess(req.user)) return res.status(403).json({ error: "VeritaStaff\u2122 subscription required" });
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const maps = (db as any).$client.prepare("SELECT id, name FROM veritamap_maps WHERE user_id = ?").all(dataUserId) as any[];
    const suggestions: { department: string; specialties: { number: number; name: string }[] }[] = [];
    const seenDepts = new Set<string>();

    for (const map of maps) {
      const instruments = (db as any).$client.prepare("SELECT id, category FROM veritamap_instruments WHERE map_id = ?").all(map.id) as any[];
      for (const inst of instruments) {
        const dept = inst.category;
        if (seenDepts.has(dept)) continue;
        seenDepts.add(dept);
        const cmsNums = VERITAMAP_DEPT_TO_CMS[dept];
        if (cmsNums) {
          suggestions.push({
            department: dept,
            specialties: cmsNums.map(n => ({ number: n, name: CMS_SPECIALTIES[n] })),
          });
        }
      }
    }
    res.json(suggestions);
  });

  // List employees for a lab
  app.get("/api/staff/employees", authMiddleware, (req: any, res) => {
    if (!hasStaffAccess(req.user)) return res.status(403).json({ error: "VeritaStaff\u2122 subscription required" });
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const lab = (db as any).$client.prepare("SELECT id FROM staff_labs WHERE user_id = ?").get(dataUserId) as any;
    if (!lab) return res.json([]);

    const employees = (db as any).$client.prepare(
      "SELECT * FROM staff_employees WHERE lab_id = ? AND status = 'active' ORDER BY last_name, first_name"
    ).all(lab.id) as any[];

    const result = employees.map((emp: any) => {
      const roles = (db as any).$client.prepare("SELECT * FROM staff_roles WHERE employee_id = ?").all(emp.id);
      const schedule = (db as any).$client.prepare("SELECT * FROM staff_competency_schedules WHERE employee_id = ?").get(emp.id);
      return { ...emp, roles, competencySchedule: schedule || null };
    });
    res.json(result);
  });

  // Get single employee
  app.get("/api/staff/employees/:id", authMiddleware, (req: any, res) => {
    if (!hasStaffAccess(req.user)) return res.status(403).json({ error: "VeritaStaff\u2122 subscription required" });
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const lab = (db as any).$client.prepare("SELECT id FROM staff_labs WHERE user_id = ?").get(dataUserId) as any;
    if (!lab) return res.status(404).json({ error: "Lab not found" });

    const emp = (db as any).$client.prepare("SELECT * FROM staff_employees WHERE id = ? AND lab_id = ?").get(req.params.id, lab.id) as any;
    if (!emp) return res.status(404).json({ error: "Employee not found" });

    const roles = (db as any).$client.prepare("SELECT * FROM staff_roles WHERE employee_id = ?").all(emp.id);
    const schedule = (db as any).$client.prepare("SELECT * FROM staff_competency_schedules WHERE employee_id = ?").get(emp.id);
    res.json({ ...emp, roles, competencySchedule: schedule || null });
  });

  // Create employee
  app.post("/api/staff/employees", authMiddleware, requireWriteAccess, requireModuleEdit('veritastaff'), (req: any, res) => {
    if (!hasStaffAccess(req.user)) return res.status(403).json({ error: "VeritaStaff\u2122 subscription required" });
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const lab = (db as any).$client.prepare("SELECT * FROM staff_labs WHERE user_id = ?").get(dataUserId) as any;
    if (!lab) return res.status(400).json({ error: "Set up your lab first" });

    const { lastName, firstName, middleInitial, title, hireDate, qualificationsText, highestComplexity, performsTesting, roles } = req.body;
    if (!lastName?.trim() || !firstName?.trim()) return res.status(400).json({ error: "Name required" });

    const now = new Date().toISOString();
    const result = (db as any).$client.prepare(
      "INSERT INTO staff_employees (lab_id, user_id, last_name, first_name, middle_initial, title, hire_date, qualifications_text, highest_complexity, performs_testing, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"
    ).run(lab.id, dataUserId, lastName.trim(), firstName.trim(), middleInitial || null, title || null, hireDate || null, qualificationsText || null, highestComplexity || 'H', performsTesting ? 1 : 0, 'active', now, now);
    const empId = result.lastInsertRowid;

    // Insert roles
    if (roles && Array.isArray(roles)) {
      const roleStmt = (db as any).$client.prepare("INSERT INTO staff_roles (employee_id, lab_id, role, specialty_number) VALUES (?,?,?,?)");
      for (const r of roles) {
        roleStmt.run(empId, lab.id, r.role, r.specialtyNumber || null);
      }
    }

    // Create competency schedule if performs testing
    if (performsTesting) {
      const accreditor = lab.accreditation_body;
      const includesTJCorCAP = ["TJC", "CAP"].includes(accreditor);
      const includesNYS = lab.includes_nys === 1;
      const hire = hireDate ? new Date(hireDate) : new Date();

      let sixMonthDue: string | null = null;
      let nysSixMonthDue: string | null = null;

      if (includesTJCorCAP && !includesNYS) {
        // 6-month due from initial completion (set later), leave null for now
        sixMonthDue = null;
      } else {
        // CLIA only or NYS: 6 months from hire
        const sixFromHire = new Date(hire);
        sixFromHire.setMonth(sixFromHire.getMonth() + 6);
        sixMonthDue = sixFromHire.toISOString().split('T')[0];
      }

      if (includesNYS) {
        const nysSix = new Date(hire);
        nysSix.setMonth(nysSix.getMonth() + 6);
        nysSixMonthDue = nysSix.toISOString().split('T')[0];
      }

      if (includesTJCorCAP && includesNYS) {
        // TJC/CAP + NYS: 6 months from hire satisfies both
        const sixFromHire = new Date(hire);
        sixFromHire.setMonth(sixFromHire.getMonth() + 6);
        sixMonthDue = sixFromHire.toISOString().split('T')[0];
      }

      (db as any).$client.prepare(
        "INSERT INTO staff_competency_schedules (employee_id, lab_id, six_month_due_at, nys_six_month_due_at) VALUES (?,?,?,?)"
      ).run(empId, lab.id, sixMonthDue, nysSixMonthDue);
    }

    // Return the created employee with roles
    const emp = (db as any).$client.prepare("SELECT * FROM staff_employees WHERE id = ?").get(empId);
    const empRoles = (db as any).$client.prepare("SELECT * FROM staff_roles WHERE employee_id = ?").all(empId);
    const schedule = (db as any).$client.prepare("SELECT * FROM staff_competency_schedules WHERE employee_id = ?").get(empId);
    res.json({ ...emp, roles: empRoles, competencySchedule: schedule || null });
  });

  // Update employee
  app.put("/api/staff/employees/:id", authMiddleware, requireWriteAccess, requireModuleEdit('veritastaff'), (req: any, res) => {
    if (!hasStaffAccess(req.user)) return res.status(403).json({ error: "VeritaStaff\u2122 subscription required" });
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const lab = (db as any).$client.prepare("SELECT * FROM staff_labs WHERE user_id = ?").get(dataUserId) as any;
    if (!lab) return res.status(400).json({ error: "Lab not found" });

    const emp = (db as any).$client.prepare("SELECT * FROM staff_employees WHERE id = ? AND lab_id = ?").get(req.params.id, lab.id) as any;
    if (!emp) return res.status(404).json({ error: "Employee not found" });

    const { lastName, firstName, middleInitial, title, hireDate, qualificationsText, highestComplexity, performsTesting, roles } = req.body;
    const now = new Date().toISOString();

    (db as any).$client.prepare(
      "UPDATE staff_employees SET last_name=?, first_name=?, middle_initial=?, title=?, hire_date=?, qualifications_text=?, highest_complexity=?, performs_testing=?, updated_at=? WHERE id=?"
    ).run(
      lastName?.trim() || emp.last_name, firstName?.trim() || emp.first_name,
      middleInitial !== undefined ? middleInitial : emp.middle_initial,
      title !== undefined ? title : emp.title,
      hireDate !== undefined ? hireDate : emp.hire_date,
      qualificationsText !== undefined ? qualificationsText : emp.qualifications_text,
      highestComplexity || emp.highest_complexity,
      performsTesting !== undefined ? (performsTesting ? 1 : 0) : emp.performs_testing,
      now, req.params.id
    );

    // Replace roles
    if (roles && Array.isArray(roles)) {
      (db as any).$client.prepare("DELETE FROM staff_roles WHERE employee_id = ?").run(req.params.id);
      const roleStmt = (db as any).$client.prepare("INSERT INTO staff_roles (employee_id, lab_id, role, specialty_number) VALUES (?,?,?,?)");
      for (const r of roles) {
        roleStmt.run(req.params.id, lab.id, r.role, r.specialtyNumber || null);
      }
    }

    const updated = (db as any).$client.prepare("SELECT * FROM staff_employees WHERE id = ?").get(req.params.id);
    const updRoles = (db as any).$client.prepare("SELECT * FROM staff_roles WHERE employee_id = ?").all(req.params.id);
    const schedule = (db as any).$client.prepare("SELECT * FROM staff_competency_schedules WHERE employee_id = ?").get(req.params.id);
    res.json({ ...updated, roles: updRoles, competencySchedule: schedule || null });
  });

  // Delete employee (hard delete)
  app.delete("/api/staff/employees/:id", authMiddleware, requireWriteAccess, requireModuleEdit('veritastaff'), (req: any, res) => {
    if (!hasStaffAccess(req.user)) return res.status(403).json({ error: "VeritaStaff\u2122 subscription required" });
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const lab = (db as any).$client.prepare("SELECT id FROM staff_labs WHERE user_id = ?").get(dataUserId) as any;
    if (!lab) return res.status(400).json({ error: "Lab not found" });
    const emp = (db as any).$client.prepare("SELECT id FROM staff_employees WHERE id = ? AND lab_id = ?").get(req.params.id, lab.id);
    if (!emp) return res.status(404).json({ error: "Employee not found" });
    const delEmployee = (db as any).$client.prepare("SELECT * FROM staff_employees WHERE id = ?").get(req.params.id) as any;
    const delRoles = (db as any).$client.prepare("SELECT * FROM staff_roles WHERE employee_id = ?").all(req.params.id);
    logAudit({ userId: req.userId, ownerUserId: req.ownerUserId ?? req.userId, module: "veritastaff", action: "delete", entityType: "employee", entityId: req.params.id, entityLabel: delEmployee ? `${delEmployee.first_name} ${delEmployee.last_name}` : undefined, before: { employee: delEmployee, roles: delRoles }, ipAddress: req.ip });
    (db as any).$client.prepare("DELETE FROM staff_competency_schedules WHERE employee_id = ?").run(req.params.id);
    (db as any).$client.prepare("DELETE FROM staff_roles WHERE employee_id = ?").run(req.params.id);
    (db as any).$client.prepare("DELETE FROM staff_employees WHERE id = ?").run(req.params.id);
    res.json({ ok: true, deleted: req.params.id });
  });

  // Update competency schedule
  app.put("/api/staff/competency/:employeeId", authMiddleware, requireWriteAccess, requireModuleEdit('veritastaff'), (req: any, res) => {
    if (!hasStaffAccess(req.user)) return res.status(403).json({ error: "VeritaStaff\u2122 subscription required" });
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const lab = (db as any).$client.prepare("SELECT * FROM staff_labs WHERE user_id = ?").get(dataUserId) as any;
    if (!lab) return res.status(400).json({ error: "Lab not found" });

    const emp = (db as any).$client.prepare("SELECT * FROM staff_employees WHERE id = ? AND lab_id = ?").get(req.params.employeeId, lab.id) as any;
    if (!emp) return res.status(404).json({ error: "Employee not found" });

    const { initialCompletedAt, initialSignedBy, sixMonthCompletedAt, sixMonthSignedBy, firstAnnualCompletedAt, firstAnnualSignedBy, lastAnnualCompletedAt, lastAnnualSignedBy, notes } = req.body;

    const accreditor = lab.accreditation_body;
    const includesTJCorCAP = ["TJC", "CAP"].includes(accreditor);

    // Recalculate due dates based on completions
    let sixMonthDue: string | null = null;
    let firstAnnualDue: string | null = null;
    let annualDue: string | null = null;

    if (includesTJCorCAP && initialCompletedAt) {
      // 6-month due = 6 months from initial completion
      const d = new Date(initialCompletedAt);
      d.setMonth(d.getMonth() + 6);
      sixMonthDue = d.toISOString().split('T')[0];
    } else if (emp.hire_date) {
      const d = new Date(emp.hire_date);
      d.setMonth(d.getMonth() + 6);
      sixMonthDue = d.toISOString().split('T')[0];
    }

    const actualSixMonth = sixMonthCompletedAt;
    if (actualSixMonth) {
      if (includesTJCorCAP) {
        // 1st annual = 6 months after 6-month completion
        const d = new Date(actualSixMonth);
        d.setMonth(d.getMonth() + 6);
        firstAnnualDue = d.toISOString().split('T')[0];
      } else {
        // CLIA only: annual = 12 months after 6-month completion
        const d = new Date(actualSixMonth);
        d.setMonth(d.getMonth() + 12);
        annualDue = d.toISOString().split('T')[0];
      }
    }

    if (firstAnnualCompletedAt) {
      const d = new Date(firstAnnualCompletedAt);
      d.setMonth(d.getMonth() + 12);
      annualDue = d.toISOString().split('T')[0];
    }

    if (lastAnnualCompletedAt) {
      const d = new Date(lastAnnualCompletedAt);
      d.setMonth(d.getMonth() + 12);
      annualDue = d.toISOString().split('T')[0];
    }

    // NYS six-month due
    let nysSixMonthDue: string | null = null;
    if (lab.includes_nys === 1 && emp.hire_date) {
      const d = new Date(emp.hire_date);
      d.setMonth(d.getMonth() + 6);
      nysSixMonthDue = d.toISOString().split('T')[0];
    }

    const existing = (db as any).$client.prepare("SELECT id FROM staff_competency_schedules WHERE employee_id = ?").get(req.params.employeeId) as any;
    if (existing) {
      (db as any).$client.prepare(
        `UPDATE staff_competency_schedules SET initial_completed_at=?, initial_signed_by=?, six_month_due_at=?, six_month_completed_at=?, six_month_signed_by=?, first_annual_due_at=?, first_annual_completed_at=?, first_annual_signed_by=?, annual_due_at=?, last_annual_completed_at=?, last_annual_signed_by=?, nys_six_month_due_at=?, notes=? WHERE employee_id=?`
      ).run(
        initialCompletedAt || null, initialSignedBy || null,
        sixMonthDue, actualSixMonth || null, sixMonthSignedBy || null,
        firstAnnualDue, firstAnnualCompletedAt || null, firstAnnualSignedBy || null,
        annualDue, lastAnnualCompletedAt || null, lastAnnualSignedBy || null,
        nysSixMonthDue, notes || null, req.params.employeeId
      );
    } else {
      (db as any).$client.prepare(
        "INSERT INTO staff_competency_schedules (employee_id, lab_id, initial_completed_at, initial_signed_by, six_month_due_at, six_month_completed_at, six_month_signed_by, first_annual_due_at, first_annual_completed_at, first_annual_signed_by, annual_due_at, last_annual_completed_at, last_annual_signed_by, nys_six_month_due_at, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
      ).run(
        req.params.employeeId, lab.id,
        initialCompletedAt || null, initialSignedBy || null,
        sixMonthDue, actualSixMonth || null, sixMonthSignedBy || null,
        firstAnnualDue, firstAnnualCompletedAt || null, firstAnnualSignedBy || null,
        annualDue, lastAnnualCompletedAt || null, lastAnnualSignedBy || null,
        nysSixMonthDue, notes || null
      );
    }

    const schedule = (db as any).$client.prepare("SELECT * FROM staff_competency_schedules WHERE employee_id = ?").get(req.params.employeeId);
    res.json(schedule);
  });

  // Generate CMS 209 PDF
  app.post("/api/staff/cms209", authMiddleware, async (req: any, res) => {
    if (!hasStaffAccess(req.user)) return res.status(403).json({ error: "VeritaStaff\u2122 subscription required" });
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const lab = (db as any).$client.prepare("SELECT * FROM staff_labs WHERE user_id = ?").get(dataUserId) as any;
    if (!lab) return res.status(400).json({ error: "Lab not set up" });

    const employees = (db as any).$client.prepare(
      "SELECT * FROM staff_employees WHERE lab_id = ? AND status = 'active' ORDER BY last_name, first_name"
    ).all(lab.id) as any[];

    const employeesWithRoles = employees.map((emp: any) => {
      const roles = (db as any).$client.prepare("SELECT * FROM staff_roles WHERE employee_id = ?").all(emp.id);
      return { ...emp, roles };
    });

    try {
      const pdfBuffer = await generateCMS209PDF({
        lab,
        employees: employeesWithRoles,
        specialties: CMS_SPECIALTIES,
      });
      const date = new Date().toISOString().split("T")[0];
      const filename = `CMS_209_${lab.clia_number}_${date}.pdf`;
      const cms209Token = storePdfToken(pdfBuffer, filename);
      res.json({ token: cms209Token });
    } catch (err: any) {
      console.error("CMS 209 PDF generation error:", err);
      res.status(500).json({ error: "PDF generation failed", detail: err.message });
    }
  });

  // Get CMS specialties reference
  app.get("/api/staff/specialties", (_req: any, res) => {
    res.json(CMS_SPECIALTIES);
  });

  // ── CLIA LOOKUP ───────────────────────────────────────────────────────────

  app.post("/api/clia/lookup", async (req, res) => {
    const { clia_number } = req.body;
    if (!clia_number || typeof clia_number !== "string" || clia_number.trim().length < 5) {
      return res.status(400).json({ error: "Valid CLIA number required" });
    }
    const cliaNum = clia_number.trim().toUpperCase();

    let labData: any = null;

    // Try CMS Data API first
    try {
      const query = encodeURIComponent(`SELECT * FROM 4pq5-ikyk WHERE provider_number = '${cliaNum}' LIMIT 1`);
      const cmsUrl = `https://data.cms.gov/provider-data/api/1/datastore/sql?query=[${query}]`;
      const cmsRes = await fetch(cmsUrl, { signal: AbortSignal.timeout(10000) });
      if (cmsRes.ok) {
        const cmsData = await cmsRes.json();
        const rows = Array.isArray(cmsData) ? cmsData : (cmsData?.results || []);
        if (rows.length > 0) {
          const row = rows[0];
          labData = {
            facility_name: row.facility_name || row.prvdr_ctgry_desc || row.name || "",
            address: [row.street_address || row.st_adr, row.city, row.state, row.zip_code || row.zip].filter(Boolean).join(", "),
            city: row.city || "",
            state: row.state || "",
            zip: row.zip_code || row.zip || "",
            lab_director: [row.first_name || row.drctrs_first_nm, row.last_name || row.drctrs_last_nm].filter(Boolean).join(" "),
            certificate_type: row.certificate_type || row.crtfct_type_cd || "",
            specialty_count: 0,
            specialties: [],
            valid_through: row.expiration_date || row.exprtn_dt || null,
          };
          // Count specialties from CMS data columns
          const specCols = Object.keys(row).filter(k => /specialty|spclty/i.test(k) && row[k]);
          labData.specialty_count = specCols.length || 1;
          labData.specialties = specCols.map((k: string) => row[k]);
        }
      }
    } catch (err: any) {
      console.log("[CLIA] CMS Data API failed, trying QCOR:", err.message);
    }

    // Fallback: try QCOR API
    if (!labData) {
      try {
        const qcorUrl = `https://qcor.cms.gov/api/public/clia/lab?clia_id=${cliaNum}`;
        const qcorRes = await fetch(qcorUrl, { signal: AbortSignal.timeout(10000) });
        if (qcorRes.ok) {
          const qcorData = await qcorRes.json();
          if (qcorData && (qcorData.facility_name || qcorData.name)) {
            labData = {
              facility_name: qcorData.facility_name || qcorData.name || "",
              address: [qcorData.address, qcorData.city, qcorData.state, qcorData.zip].filter(Boolean).join(", "),
              city: qcorData.city || "",
              state: qcorData.state || "",
              zip: qcorData.zip || "",
              lab_director: qcorData.lab_director || qcorData.director || "",
              certificate_type: qcorData.certificate_type || "",
              specialty_count: qcorData.specialties?.length || qcorData.specialty_count || 1,
              specialties: qcorData.specialties || [],
              valid_through: qcorData.expiration_date || null,
            };
          }
        }
      } catch (err: any) {
        console.log("[CLIA] QCOR API also failed:", err.message);
      }
    }

    if (!labData) {
      return res.status(404).json({ error: "CLIA number not found. Please verify and try again." });
    }

    // Determine tier from certificate type and specialty count
    const certType = (labData.certificate_type || "").toLowerCase();
    let tier: string;
    let base_price: number;

    if (certType.includes("waiv")) {
      tier = "waived";
      base_price = 499;
    } else if (labData.specialty_count >= 16) {
      tier = "large_hospital";
      base_price = 2999;
    } else if (labData.specialty_count >= 9) {
      tier = "hospital";
      base_price = 1999;
    } else {
      tier = "community";
      base_price = 999;
    }

    res.json({
      clia_number: cliaNum,
      facility_name: labData.facility_name,
      address: labData.address,
      city: labData.city,
      state: labData.state,
      zip: labData.zip,
      lab_director: labData.lab_director,
      certificate_type: labData.certificate_type,
      specialty_count: labData.specialty_count,
      specialties: labData.specialties,
      valid_through: labData.valid_through,
      tier,
      base_price,
    });
  });

  app.post("/api/clia/confirm", authMiddleware, (req: any, res) => {
    const { clia_number, facility_name, address, lab_director, specialty_count, certificate_type, tier } = req.body;
    if (!clia_number) return res.status(400).json({ error: "CLIA number required" });

    const now = new Date().toISOString();
    (db as any).$client.prepare(`
      UPDATE users SET
        clia_number = ?, clia_lab_name = ?, clia_address = ?, clia_director = ?,
        clia_specialty_count = ?, clia_certificate_type = ?, clia_tier = ?, clia_verified_at = ?
      WHERE id = ?
    `).run(clia_number, facility_name || null, address || null, lab_director || null,
      specialty_count || null, certificate_type || null, tier || null, now, req.userId);

    // Auto-create VeritaLab CLIA certificate if one does not already exist
    const existingCert = (db as any).$client.prepare(
      `SELECT id FROM lab_certificates WHERE user_id = ? AND cert_type = 'clia'`
    ).get(req.userId);

    if (!existingCert) {
      (db as any).$client.prepare(`
        INSERT INTO lab_certificates
        (user_id, cert_type, cert_name, cert_number, issuing_body, lab_director, is_auto_populated, notes, created_at, updated_at)
        VALUES (?, 'clia', 'CLIA Certificate', ?, 'Centers for Medicare and Medicaid Services (CMS)', ?, 1, ?, ?, ?)
      `).run(
        req.userId,
        clia_number,
        lab_director || '',
        'Auto-populated from CLIA verification. Enter your expiration date to activate renewal reminders.',
        now,
        now
      );
    }

    res.json({ ok: true, tier });
  });

  // ── NAMED SEAT MANAGEMENT ────────────────────────────────────────────────

  // List seats for current account owner
  app.get("/api/account/seats", authMiddleware, (req: any, res) => {
    const seats = (db as any).$client.prepare(
      "SELECT * FROM user_seats WHERE owner_user_id = ? ORDER BY id"
    ).all(req.userId);
    const userRow = (db as any).$client.prepare("SELECT seat_count, plan FROM users WHERE id = ?").get(req.userId) as any;
    const dbSeats = userRow?.seat_count || 1;
    const planMax = (PLAN_LIMITS as any)[userRow?.plan]?.maxAnalysts || 1;
    const effectiveSeats = Math.max(dbSeats, planMax);
    res.json({ seats, seat_count: effectiveSeats });
  });

  // Add a seat (invite)
  app.post("/api/account/seats", authMiddleware, async (req: any, res) => {
    const { email } = req.body;
    if (!email || !email.includes("@")) return res.status(400).json({ error: "Valid email required" });

    const userRow = (db as any).$client.prepare("SELECT seat_count, plan FROM users WHERE id = ?").get(req.userId) as any;
    const userPlan = userRow?.plan || "free";
    // Use PLAN_SEATS for new tier plans, fall back to old PLAN_LIMITS for legacy plans
    const planSeatLimit = PLAN_SEATS[userPlan] ?? (PLAN_LIMITS as any)[userPlan]?.maxAnalysts ?? 1;
    const dbSeats = userRow?.seat_count || 0;
    const maxSeats = Math.max(dbSeats, planSeatLimit);
    const currentSeats = (db as any).$client.prepare(
      "SELECT COUNT(*) as cnt FROM user_seats WHERE owner_user_id = ? AND status != 'deactivated'"
    ).get(req.userId) as any;

    // Owner consumes one of the seats. Block when adding a new invitee
    // would push total occupants (existing invitees + owner + 1 new)
    // beyond the plan limit. Example: Enterprise (25) allows up to 24
    // invitees because 24 invitees + 1 owner = 25 total.
    const currentInvitees = currentSeats?.cnt || 0;
    const seatsAfterInvite = currentInvitees + 1 /* owner */ + 1 /* new invitee */;
    if (seatsAfterInvite > maxSeats) {
      const nextTier = userPlan === "clinic" ? { label: "Community", price: 999, seats: 5, plan: "community" }
        : userPlan === "community" ? { label: "Hospital", price: 1999, seats: 15, plan: "hospital" }
        : userPlan === "hospital" ? { label: "Enterprise", price: 2999, seats: 25, plan: "enterprise" }
        : null;
      return res.status(402).json({
        error: "seat_limit_reached",
        limit: maxSeats,
        current: currentInvitees + 1,  // includes owner
        plan: userPlan,
        nextTier,
      });
    }

    const now = new Date().toISOString();
    const existingActive = (db as any).$client.prepare(
      "SELECT id FROM user_seats WHERE owner_user_id = ? AND seat_email = ? AND status != 'deactivated'"
    ).get(req.userId, email.toLowerCase());
    if (existingActive) return res.status(409).json({ error: "This email already has a seat assigned" });

    // Check if invited user already has an account
    const existingUser = storage.getUserByEmail(email.toLowerCase());
    const seatUserId = existingUser ? existingUser.id : null;
    const newStatus = seatUserId ? "active" : "pending";

    // Server-side default for invites that arrive without permissions (old
    // client tab, scripted invite). The new client requires the owner to
    // pick a mode and sends { mode: 'edit_all'|'view_all'|'custom', ... }.
    // For old-shape requests we accept whatever they send. If nothing is
    // sent, fall back to view_all (least-privilege). The shared resolver
    // handles either shape on read, so this default is safe with both old
    // and new clients.
    const DEFAULT_PERMISSIONS_JSON = JSON.stringify({ mode: 'view_all' });
    const permJson = JSON.stringify(req.body.permissions || JSON.parse(DEFAULT_PERMISSIONS_JSON));

    // Generate invite token for the invitation link
    const inviteToken = crypto.randomUUID();

    // Reactivate a previously deactivated seat if one exists
    const deactivated = (db as any).$client.prepare(
      "SELECT id FROM user_seats WHERE owner_user_id = ? AND seat_email = ? AND status = 'deactivated'"
    ).get(req.userId, email.toLowerCase()) as any;
    if (deactivated) {
      (db as any).$client.prepare(
        "UPDATE user_seats SET seat_user_id = ?, status = ?, invited_at = ?, accepted_at = ?, permissions = ?, invite_token = ? WHERE id = ?"
      ).run(seatUserId, newStatus, now, seatUserId ? now : null, permJson, inviteToken, deactivated.id);
    } else {
      (db as any).$client.prepare(
        "INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, status, permissions, invite_token) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(req.userId, email.toLowerCase(), seatUserId, now, newStatus, permJson, inviteToken);
    }

    // If the seat user already exists and is active, inherit the owner's lab_id
    if (seatUserId && newStatus === "active") {
      const ownerLabRow = (db as any).$client.prepare("SELECT lab_id FROM users WHERE id = ?").get(req.userId) as any;
      if (ownerLabRow?.lab_id) {
        (db as any).$client.prepare("UPDATE users SET lab_id = ? WHERE id = ?").run(ownerLabRow.lab_id, seatUserId);
      }
    }

    // Send invite email via Resend
    const owner = storage.getUserById(req.userId);
    const ownerRow = (db as any).$client.prepare("SELECT clia_lab_name, hospital_name FROM users WHERE id = ?").get(req.userId) as any;
    const labName = ownerRow?.clia_lab_name || ownerRow?.hospital_name || owner?.name || "your lab";
    const inviterName = owner?.name || "Your lab administrator";
    let emailSent = false;
    if (!process.env.RESEND_API_KEY) {
      console.error("[seats] RESEND_API_KEY is not set; seat invite email skipped (seat row was still created)");
    } else {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "VeritaAssure\u2122 <noreply@veritaslabservices.com>",
          to: email.toLowerCase(),
          subject: `You've been invited to join ${labName} on VeritaAssure\u2122`,
          html: `
            <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
              <h2 style="color:#01696F">VeritaAssure\u2122</h2>
              <p style="font-size:15px;color:#1B2B2B;line-height:1.6">${inviterName} has invited you to join <strong>${labName}</strong> on VeritaAssure\u2122 as a team member.</p>
              <p style="font-size:14px;color:#374151;line-height:1.6">Click the link below to create your account and get started:</p>
              <a href="${FRONTEND_URL}/join?token=${inviteToken}" style="display:inline-block;background:#01696F;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;margin:16px 0">Accept Invitation</a>
              <p style="font-size:13px;color:#6B7280;margin-top:16px">This invitation will expire in 7 days.</p>
              <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
              <p style="color:#999;font-size:12px">VeritaAssure\u2122 | Veritas Lab Services, LLC<br/>veritaslabservices.com</p>
            </div>
          `,
        }),
      });
      emailSent = true;
    } catch (emailErr) {
      console.error("[seats] Invite email failed:", emailErr);
    }
    }

    res.json({ ok: true, status: seatUserId ? "active" : "pending", emailSent });
  });

  // Look up a seat invitation by token (no auth required - user is not yet logged in)
  app.get("/api/seats/invite/:token", (req, res) => {
    const { token } = req.params;
    if (!token) return res.json({ valid: false, reason: "not_found" });

    const seat = (db as any).$client.prepare(
      "SELECT s.*, u.name as owner_name, u.clia_lab_name, u.hospital_name FROM user_seats s JOIN users u ON s.owner_user_id = u.id WHERE s.invite_token = ?"
    ).get(token) as any;

    if (!seat) return res.json({ valid: false, reason: "not_found" });
    if (seat.status === "active") return res.json({ valid: false, reason: "already_accepted" });
    if (seat.status === "deactivated") return res.json({ valid: false, reason: "not_found" });

    // Check 7-day expiration
    const invitedAt = new Date(seat.invited_at);
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    if (Date.now() - invitedAt.getTime() > sevenDaysMs) {
      return res.json({ valid: false, reason: "expired" });
    }

    const labName = seat.clia_lab_name || seat.hospital_name || seat.owner_name || "your lab";
    res.json({
      valid: true,
      labName,
      inviterName: seat.owner_name || "Your lab administrator",
      seatEmail: seat.seat_email,
    });
  });

  // Update seat permissions
  app.patch("/api/account/seats/:seatId/permissions", authMiddleware, (req: any, res) => {
    const seatId = parseInt(req.params.seatId);
    const { permissions } = req.body;

    // Verify this seat belongs to the requesting user (owner check)
    const seat = (db as any).$client.prepare(
      "SELECT * FROM user_seats WHERE id = ? AND owner_user_id = ?"
    ).get(seatId, req.userId) as any;

    if (!seat) return res.status(404).json({ error: "Seat not found" });

    const permJson = JSON.stringify(permissions || {});
    (db as any).$client.prepare(
      "UPDATE user_seats SET permissions = ? WHERE id = ?"
    ).run(permJson, seatId);

    res.json({ ok: true, seatId, permissions });
  });

  // Deactivate a seat
  app.delete("/api/account/seats/:seatId", authMiddleware, (req: any, res) => {
    const seat = (db as any).$client.prepare(
      "SELECT id FROM user_seats WHERE id = ? AND owner_user_id = ?"
    ).get(req.params.seatId, req.userId);
    if (!seat) return res.status(404).json({ error: "Seat not found" });

    (db as any).$client.prepare("UPDATE user_seats SET status = 'deactivated' WHERE id = ?").run(req.params.seatId);
    res.json({ ok: true });
  });

  // ── SESSION MANAGEMENT ───────────────────────────────────────────────────

  app.post("/api/auth/force-logout", authMiddleware, (req: any, res) => {
    // Deactivate all sessions for this user
    (db as any).$client.prepare(
      "UPDATE user_sessions SET is_active = 0 WHERE user_id = ?"
    ).run(req.userId);

    // Create new session
    const sessionToken = crypto.randomUUID();
    const now = new Date().toISOString();
    const deviceInfo = req.headers["user-agent"] || "Unknown";
    (db as any).$client.prepare(
      "INSERT INTO user_sessions (user_id, session_token, device_info, created_at, last_active, is_active) VALUES (?, ?, ?, ?, ?, 1)"
    ).run(req.userId, sessionToken, deviceInfo, now, now);

    res.json({ ok: true, session_token: sessionToken });
  });

  // Force logout a specific seat's sessions (for account owner)
  app.post("/api/account/seats/:seatId/force-logout", authMiddleware, (req: any, res) => {
    const seat = (db as any).$client.prepare(
      "SELECT seat_user_id FROM user_seats WHERE id = ? AND owner_user_id = ?"
    ).get(req.params.seatId, req.userId) as any;
    if (!seat || !seat.seat_user_id) return res.status(404).json({ error: "Seat not found or user not registered" });

    (db as any).$client.prepare(
      "UPDATE user_sessions SET is_active = 0 WHERE user_id = ?"
    ).run(seat.seat_user_id);

    res.json({ ok: true });
  });

  // Get activity summary for a specific seat user
  app.get("/api/account/seats/:seatId/activity", authMiddleware, (req: any, res) => {
    const seatId = parseInt(req.params.seatId);

    // Verify the requesting user owns this seat
    const seat = (db as any).$client.prepare(
      "SELECT seat_user_id FROM user_seats WHERE id = ? AND owner_user_id = ?"
    ).get(seatId, req.userId) as any;
    if (!seat) return res.status(404).json({ error: "Seat not found" });
    if (!seat.seat_user_id) return res.status(400).json({ error: "Seat user has not registered yet" });

    const seatUserId = seat.seat_user_id;

    // Last login (most recent last_active from user_sessions)
    const lastSession = (db as any).$client.prepare(
      "SELECT last_active FROM user_sessions WHERE user_id = ? ORDER BY last_active DESC LIMIT 1"
    ).get(seatUserId) as any;

    // Total session count
    const sessionRow = (db as any).$client.prepare(
      "SELECT COUNT(*) as cnt FROM user_sessions WHERE user_id = ?"
    ).get(seatUserId) as any;

    // Study count
    const studyRow = (db as any).$client.prepare(
      "SELECT COUNT(*) as cnt FROM studies WHERE user_id = ?"
    ).get(seatUserId) as any;

    // Last 10 audit log entries
    const recentActions = (db as any).$client.prepare(
      "SELECT module, action, entity_type, entity_label, created_at FROM audit_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 10"
    ).all(seatUserId) as any[];

    res.json({
      lastLogin: lastSession?.last_active || null,
      sessionCount: sessionRow?.cnt || 0,
      studyCount: studyRow?.cnt || 0,
      recentActions: recentActions.map((a: any) => ({
        module: a.module,
        action: a.action,
        entityType: a.entity_type,
        entityLabel: a.entity_label,
        createdAt: a.created_at,
      })),
    });
  });

  // Logout (mark session inactive)
  app.post("/api/auth/logout", authMiddleware, (req: any, res) => {
    const { session_token } = req.body || {};
    if (session_token) {
      (db as any).$client.prepare(
        "UPDATE user_sessions SET is_active = 0 WHERE session_token = ?"
      ).run(session_token);
    }
    res.json({ ok: true });
  });

  // ── VERITALAB ──────────────────────────────────────────────────────────

  function hasLabCertAccess(user: any) {
    return ["annual", "professional", "lab", "complete", "veritamap", "veritascan", "veritacomp", "waived", "community", "hospital", "large_hospital", "enterprise"].includes(user?.plan);
  }

  function scheduleReminders(certId: number, userId: number, expirationDate: string) {
    // Delete existing reminders for this certificate
    (db as any).$client.prepare("DELETE FROM lab_certificate_reminders WHERE certificate_id = ?").run(certId);

    if (!expirationDate) return;

    const exp = new Date(expirationDate);
    if (isNaN(exp.getTime())) return;

    const reminders: { type: string; months?: number; days?: number }[] = [
      { type: "9month", months: 9 },
      { type: "6month", months: 6 },
      { type: "3month", months: 3 },
      { type: "30day", days: 30 },
      { type: "expired" },
    ];

    const stmt = (db as any).$client.prepare(
      "INSERT INTO lab_certificate_reminders (certificate_id, user_id, reminder_type, scheduled_date, is_sent) VALUES (?, ?, ?, ?, 0)"
    );

    for (const r of reminders) {
      let scheduledDate: Date;
      if (r.type === "expired") {
        scheduledDate = new Date(exp);
      } else if (r.months) {
        scheduledDate = new Date(exp);
        scheduledDate.setMonth(scheduledDate.getMonth() - r.months);
      } else if (r.days) {
        scheduledDate = new Date(exp);
        scheduledDate.setDate(scheduledDate.getDate() - r.days);
      } else {
        continue;
      }
      stmt.run(certId, userId, r.type, scheduledDate.toISOString().split("T")[0]);
    }
  }

  // GET /api/veritalab/certificates - list all certificates for user
  app.get("/api/veritalab/certificates", authMiddleware, (req: any, res) => {
    if (!hasLabCertAccess(req.user)) return res.status(403).json({ error: "VeritaLab\u2122 subscription required" });

    // Auto-populate CLIA certificate if user has clia_number but no CLIA cert yet
    const userRow = (db as any).$client.prepare("SELECT * FROM users WHERE id = ?").get(req.userId) as any;
    if (userRow?.clia_number) {
      const existingClia = (db as any).$client.prepare(
        "SELECT id FROM lab_certificates WHERE user_id = ? AND cert_type = 'clia' AND is_active = 1"
      ).get(req.userId);
      if (!existingClia) {
        const now = new Date().toISOString();
        (db as any).$client.prepare(
          "INSERT INTO lab_certificates (user_id, cert_type, cert_name, cert_number, issuing_body, lab_director, is_auto_populated, notes, created_at, updated_at) VALUES (?, 'clia', 'CLIA Certificate', ?, 'Centers for Medicare and Medicaid Services (CMS)', ?, 1, 'Auto-populated from CLIA verification. Enter your expiration date to activate renewal reminders.', ?, ?)"
        ).run(req.userId, userRow.clia_number, userRow.clia_director || null, now, now);
      }
    }

    const certs = (db as any).$client.prepare(
      "SELECT * FROM lab_certificates WHERE user_id = ? AND is_active = 1 ORDER BY created_at DESC"
    ).all(req.userId) as any[];

    // Attach document count for each certificate
    const result = certs.map((cert: any) => {
      const docCount = (db as any).$client.prepare(
        "SELECT COUNT(*) as cnt FROM lab_certificate_documents WHERE certificate_id = ? AND user_id = ?"
      ).get(cert.id, req.userId) as any;
      return { ...cert, document_count: docCount?.cnt || 0 };
    });

    res.json(result);
  });

  // POST /api/veritalab/certificates - create a new certificate
  app.post("/api/veritalab/certificates", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasLabCertAccess(req.user)) return res.status(403).json({ error: "VeritaLab\u2122 subscription required" });
    const { cert_type, cert_name, cert_number, issuing_body, issued_date, expiration_date, lab_director, notes } = req.body;
    if (!cert_name?.trim()) return res.status(400).json({ error: "Certificate name required" });

    const now = new Date().toISOString();
    const result = (db as any).$client.prepare(
      "INSERT INTO lab_certificates (user_id, cert_type, cert_name, cert_number, issuing_body, issued_date, expiration_date, lab_director, notes, is_auto_populated, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)"
    ).run(req.userId, cert_type || "other", cert_name.trim(), cert_number || null, issuing_body || null, issued_date || null, expiration_date || null, lab_director || null, notes || null, now, now);

    const certId = Number(result.lastInsertRowid);
    if (expiration_date) {
      scheduleReminders(certId, req.userId, expiration_date);
    }

    const cert = (db as any).$client.prepare("SELECT * FROM lab_certificates WHERE id = ?").get(certId);
    res.status(201).json(cert);
  });

  // PUT /api/veritalab/certificates/:id - update a certificate
  app.put("/api/veritalab/certificates/:id", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasLabCertAccess(req.user)) return res.status(403).json({ error: "VeritaLab\u2122 subscription required" });

    const existing = (db as any).$client.prepare(
      "SELECT * FROM lab_certificates WHERE id = ? AND user_id = ? AND is_active = 1"
    ).get(req.params.id, req.userId) as any;
    if (!existing) return res.status(404).json({ error: "Certificate not found" });

    const { cert_type, cert_name, cert_number, issuing_body, issued_date, expiration_date, lab_director, notes } = req.body;
    const now = new Date().toISOString();

    (db as any).$client.prepare(
      "UPDATE lab_certificates SET cert_type=?, cert_name=?, cert_number=?, issuing_body=?, issued_date=?, expiration_date=?, lab_director=?, notes=?, updated_at=? WHERE id=?"
    ).run(
      cert_type ?? existing.cert_type,
      cert_name?.trim() ?? existing.cert_name,
      cert_number ?? existing.cert_number,
      issuing_body ?? existing.issuing_body,
      issued_date ?? existing.issued_date,
      expiration_date ?? existing.expiration_date,
      lab_director ?? existing.lab_director,
      notes ?? existing.notes,
      now,
      req.params.id
    );

    // Reschedule reminders if expiration_date changed
    const newExp = expiration_date ?? existing.expiration_date;
    if (newExp) {
      scheduleReminders(Number(req.params.id), req.userId, newExp);
    }

    const cert = (db as any).$client.prepare("SELECT * FROM lab_certificates WHERE id = ?").get(req.params.id);
    res.json(cert);
  });

  // DELETE /api/veritalab/certificates/:id - soft delete
  app.delete("/api/veritalab/certificates/:id", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasLabCertAccess(req.user)) return res.status(403).json({ error: "VeritaLab\u2122 subscription required" });
    const existing = (db as any).$client.prepare(
      "SELECT id FROM lab_certificates WHERE id = ? AND user_id = ? AND is_active = 1"
    ).get(req.params.id, req.userId);
    if (!existing) return res.status(404).json({ error: "Certificate not found" });

    const delCertRow = (db as any).$client.prepare("SELECT * FROM lab_certificates WHERE id = ?").get(req.params.id) as any;
    logAudit({ userId: req.userId, ownerUserId: req.ownerUserId ?? req.userId, module: "veritalab", action: "delete", entityType: "certificate", entityId: req.params.id, entityLabel: delCertRow?.cert_type ?? delCertRow?.name, before: delCertRow, ipAddress: req.ip });
    const now = new Date().toISOString();
    (db as any).$client.prepare("UPDATE lab_certificates SET is_active = 0, updated_at = ? WHERE id = ?").run(now, req.params.id);
    // Remove pending reminders
    (db as any).$client.prepare("DELETE FROM lab_certificate_reminders WHERE certificate_id = ? AND is_sent = 0").run(req.params.id);
    res.json({ success: true });
  });

  // POST /api/veritalab/certificates/:id/documents - upload document
  const multer = require("multer");
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } }); // 20MB max

  app.post("/api/veritalab/certificates/:id/documents", authMiddleware, requireWriteAccess, upload.single("file"), (req: any, res: any) => {
    if (!hasLabCertAccess(req.user)) return res.status(403).json({ error: "VeritaLab\u2122 subscription required" });
    const cert = (db as any).$client.prepare(
      "SELECT id FROM lab_certificates WHERE id = ? AND user_id = ? AND is_active = 1"
    ).get(req.params.id, req.userId);
    if (!cert) return res.status(404).json({ error: "Certificate not found" });

    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const now = new Date().toISOString();
    const filename = `${Date.now()}_${req.file.originalname}`;
    const result = (db as any).$client.prepare(
      "INSERT INTO lab_certificate_documents (certificate_id, user_id, filename, original_filename, file_size, mime_type, file_data, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(req.params.id, req.userId, filename, req.file.originalname, req.file.size, req.file.mimetype, req.file.buffer, now);

    res.status(201).json({
      id: Number(result.lastInsertRowid),
      certificate_id: Number(req.params.id),
      filename,
      original_filename: req.file.originalname,
      file_size: req.file.size,
      mime_type: req.file.mimetype,
      uploaded_at: now,
    });
  });

  // GET /api/veritalab/certificates/:id/documents - list documents
  app.get("/api/veritalab/certificates/:id/documents", authMiddleware, (req: any, res) => {
    if (!hasLabCertAccess(req.user)) return res.status(403).json({ error: "VeritaLab\u2122 subscription required" });
    const cert = (db as any).$client.prepare(
      "SELECT id FROM lab_certificates WHERE id = ? AND user_id = ? AND is_active = 1"
    ).get(req.params.id, req.userId);
    if (!cert) return res.status(404).json({ error: "Certificate not found" });

    const docs = (db as any).$client.prepare(
      "SELECT id, certificate_id, filename, original_filename, file_size, mime_type, uploaded_at FROM lab_certificate_documents WHERE certificate_id = ? AND user_id = ? ORDER BY uploaded_at DESC"
    ).all(req.params.id, req.userId);
    res.json(docs);
  });

  // GET /api/veritalab/certificates/:id/documents/:docId - download document
  app.get("/api/veritalab/certificates/:id/documents/:docId", authMiddleware, (req: any, res) => {
    if (!hasLabCertAccess(req.user)) return res.status(403).json({ error: "VeritaLab\u2122 subscription required" });
    const doc = (db as any).$client.prepare(
      "SELECT * FROM lab_certificate_documents WHERE id = ? AND certificate_id = ? AND user_id = ?"
    ).get(req.params.docId, req.params.id, req.userId) as any;
    if (!doc) return res.status(404).json({ error: "Document not found" });

    res.setHeader("Content-Type", doc.mime_type || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${doc.original_filename}"`);
    res.setHeader("Content-Length", doc.file_size);
    res.send(doc.file_data);
  });

  // DELETE /api/veritalab/certificates/:id/documents/:docId - delete document
  app.delete("/api/veritalab/certificates/:id/documents/:docId", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasLabCertAccess(req.user)) return res.status(403).json({ error: "VeritaLab\u2122 subscription required" });
    const doc = (db as any).$client.prepare(
      "SELECT id FROM lab_certificate_documents WHERE id = ? AND certificate_id = ? AND user_id = ?"
    ).get(req.params.docId, req.params.id, req.userId);
    if (!doc) return res.status(404).json({ error: "Document not found" });

    (db as any).$client.prepare("DELETE FROM lab_certificate_documents WHERE id = ?").run(req.params.docId);
    res.json({ success: true });
  });

  // POST /api/veritalab/check-reminders - check and send due reminders
  app.post("/api/veritalab/check-reminders", (req: any, res) => {
    const adminSecret = req.headers["x-admin-secret"];
    if (adminSecret !== ADMIN_SECRET) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const today = new Date().toISOString().split("T")[0];
    const dueReminders = (db as any).$client.prepare(
      "SELECT r.*, c.cert_name, c.cert_number, c.expiration_date FROM lab_certificate_reminders r JOIN lab_certificates c ON c.id = r.certificate_id WHERE r.scheduled_date <= ? AND r.is_sent = 0 AND c.is_active = 1"
    ).all(today) as any[];

    let sent = 0;
    let errors = 0;

    const reminderLabels: Record<string, string> = {
      "9month": "9-Month Reminder",
      "6month": "6-Month Reminder",
      "3month": "3-Month Reminder",
      "30day": "30-Day Reminder",
      "expired": "Expiration Notice",
    };

    for (const reminder of dueReminders) {
      const user = (db as any).$client.prepare("SELECT email, clia_lab_name FROM users WHERE id = ?").get(reminder.user_id) as any;
      if (!user?.email) continue;

      const label = reminderLabels[reminder.reminder_type] || reminder.reminder_type;
      const expDate = reminder.expiration_date ? new Date(reminder.expiration_date).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" }) : "Unknown";
      const subject = `${label} - ${reminder.cert_name} expires ${expDate}`;

      const htmlBody = `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
          <h2 style="color:#01696F;margin-bottom:16px">Your ${reminder.cert_name} is expiring soon.</h2>
          <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
            <tr><td style="padding:6px 0;color:#666">Certificate:</td><td style="padding:6px 0;font-weight:600">${reminder.cert_name}</td></tr>
            <tr><td style="padding:6px 0;color:#666">Number:</td><td style="padding:6px 0">${reminder.cert_number || "N/A"}</td></tr>
            <tr><td style="padding:6px 0;color:#666">Expiration:</td><td style="padding:6px 0;font-weight:600;color:#c53030">${expDate}</td></tr>
            <tr><td style="padding:6px 0;color:#666">Lab:</td><td style="padding:6px 0">${user.clia_lab_name || "Your laboratory"}</td></tr>
          </table>
          <p style="margin-bottom:20px">Log in to VeritaAssure\u2122 to view your certificate details and upload renewal documentation.</p>
          <a href="https://www.veritaslabservices.com/veritalab-app" style="display:inline-block;background:#01696F;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">Open VeritaLab\u2122</a>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
          <p style="color:#999;font-size:12px">VeritaAssure\u2122 | Veritas Lab Services, LLC</p>
        </div>
      `;

      try {
        if (resend) {
          resend.emails.send({
            from: "VeritaAssure\u2122 <info@veritaslabservices.com>",
            to: user.email,
            subject,
            html: htmlBody,
          });
        }
        (db as any).$client.prepare(
          "UPDATE lab_certificate_reminders SET is_sent = 1, sent_at = ? WHERE id = ?"
        ).run(new Date().toISOString(), reminder.id);
        sent++;
      } catch (err) {
        console.error("[VeritaLab] Reminder email failed:", err);
        errors++;
      }
    }

    res.json({ processed: dueReminders.length, sent, errors });
  });

  // POST /api/veritalab/certificates/excel - export certificates to Excel
  app.post("/api/veritalab/certificates/excel", authMiddleware, async (req: any, res) => {
    if (!hasLabCertAccess(req.user)) return res.status(403).json({ error: "VeritaLab\u2122 subscription required" });

    const certs = (db as any).$client.prepare(
      "SELECT * FROM lab_certificates WHERE user_id = ? AND is_active = 1 ORDER BY expiration_date ASC"
    ).all(req.userId) as any[];

    try {
      const { default: ExcelJS } = await import("exceljs");
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Certificates");

      const headers = [
        "Certificate Name", "Type", "Number", "Issuing Body", "Issued Date",
        "Expiration Date", "Days Until Expiration", "Status", "Lab Director",
        "Documents Count", "Notes",
      ];

      const colWidths = [28, 18, 20, 35, 16, 16, 22, 16, 22, 18, 30];
      ws.columns = headers.map((h, i) => ({ header: h, key: `col${i}`, width: colWidths[i] ?? 18 }));

      const today = new Date();
      const rows = certs.map((c: any) => {
        const docCount = (db as any).$client.prepare(
          "SELECT COUNT(*) as cnt FROM lab_certificate_documents WHERE certificate_id = ?"
        ).get(c.id) as any;

        let daysUntil = "";
        let status = "No expiration date";
        if (c.expiration_date) {
          const exp = new Date(c.expiration_date);
          const diffMs = exp.getTime() - today.getTime();
          const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
          daysUntil = String(diffDays);
          if (diffDays < 0) status = "Expired";
          else if (diffDays <= 30) status = "Expires Soon";
          else if (diffDays <= 90) status = "Expiring";
          else status = "Current";
        }

        const typeLabels: Record<string, string> = {
          clia: "CLIA", cap: "CAP", tjc: "TJC", state_license: "State License",
          lab_director_license: "Lab Director License", other: "Other",
        };

        return [
          c.cert_name, typeLabels[c.cert_type] || c.cert_type, c.cert_number || "",
          c.issuing_body || "", c.issued_date || "", c.expiration_date || "",
          daysUntil, status, c.lab_director || "", docCount?.cnt || 0, c.notes || "",
        ];
      });

      for (const row of rows) {
        ws.addRow(row);
      }

      // Shared border style
      const thinBorder: any = {
        top: { style: "thin", color: { argb: "FFD0D0D0" } },
        bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
        left: { style: "thin", color: { argb: "FFD0D0D0" } },
        right: { style: "thin", color: { argb: "FFD0D0D0" } },
      };

      // Header row styling
      const headerRow = ws.getRow(1);
      headerRow.height = 20;
      headerRow.eachCell((cell) => {
        cell.font = { name: "Calibri", bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF01696F" } };
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        cell.border = thinBorder;
      });

      // Data rows
      const statusCol = 8; // 1-indexed
      for (let r = 2; r <= rows.length + 1; r++) {
        const row = ws.getRow(r);
        const isEvenRow = r % 2 === 0;
        const bgColor = isEvenRow ? "FFEBF3F8" : "FFFFFFFF";

        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          cell.font = { name: "Calibri", color: { argb: "FF28251D" }, size: 10 };
          cell.alignment = { vertical: "middle", wrapText: true };
          cell.border = thinBorder;
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };

          if (colNumber === statusCol) {
            const val = String(cell.value || "");
            if (/Expired/i.test(val)) {
              cell.font = { name: "Calibri", bold: true, color: { argb: "FFA12C7B" }, size: 10 };
            } else if (/Expires Soon|Expiring/i.test(val)) {
              cell.font = { name: "Calibri", bold: true, color: { argb: "FF964219" }, size: 10 };
            } else if (/Current/i.test(val)) {
              cell.font = { name: "Calibri", bold: true, color: { argb: "FF437A22" }, size: 10 };
            }
          }
        });
      }

      // Freeze pane at B2
      ws.views = [{ state: "frozen" as const, xSplit: 1, ySplit: 1, topLeftCell: "B2" }];

      // Auto-filter
      const lastColLetter = String.fromCharCode(64 + headers.length);
      ws.autoFilter = { from: "A1", to: `${lastColLetter}1` };

      const buffer = await wb.xlsx.writeBuffer();
      const date = new Date().toISOString().split("T")[0];
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="VeritaLab_Certificates_${date}.xlsx"`);
      res.send(Buffer.from(buffer));
    } catch (err: any) {
      console.error("[VeritaLab] Excel export error:", err);
      res.status(500).json({ error: "Excel export failed" });
    }
  });

  // ── ONBOARDING STATUS ──────────────────────────────────────────────────
  app.get("/api/onboarding/status", authMiddleware, (req: any, res) => {
    try {
      const userId = req.userId;
      const userRow = (db as any).$client.prepare(
        "SELECT clia_number, onboarding_seen FROM users WHERE id = ?"
      ).get(userId) as any;

      const cliaEntered = !!(userRow?.clia_number && userRow.clia_number.trim() !== '');
      const onboardingSeen = !!(userRow?.onboarding_seen);

      const mapCount = ((db as any).$client.prepare(
        "SELECT COUNT(*) as cnt FROM veritamap_maps WHERE user_id = ?"
      ).get(userId) as any)?.cnt || 0;

      const studyCount = ((db as any).$client.prepare(
        "SELECT COUNT(*) as cnt FROM studies WHERE user_id = ?"
      ).get(userId) as any)?.cnt || 0;

      const scanCount = ((db as any).$client.prepare(
        "SELECT COUNT(*) as cnt FROM veritascan_scans WHERE user_id = ?"
      ).get(userId) as any)?.cnt || 0;

      const compCount = ((db as any).$client.prepare(
        "SELECT COUNT(*) as cnt FROM competency_programs WHERE user_id = ?"
      ).get(userId) as any)?.cnt || 0;

      const staffCount = ((db as any).$client.prepare(
        "SELECT COUNT(*) as cnt FROM staff_employees WHERE user_id = ?"
      ).get(userId) as any)?.cnt || 0;

      const certCount = ((db as any).$client.prepare(
        "SELECT COUNT(*) as cnt FROM lab_certificates WHERE user_id = ?"
      ).get(userId) as any)?.cnt || 0;

      const steps: Record<string, boolean> = {
        clia_entered: cliaEntered,
        map_created: mapCount > 0,
        study_created: studyCount > 0,
        scan_started: scanCount > 0,
        comp_created: compCount > 0,
        staff_added: staffCount > 0,
        cert_entered: certCount > 0,
      };

      const completedCount = Object.values(steps).filter(Boolean).length;

      res.json({
        onboarding_seen: onboardingSeen,
        steps,
        completed_count: completedCount,
        total_count: 7,
      });
    } catch (err: any) {
      console.error("[onboarding] status error:", err);
      res.status(500).json({ error: "Failed to fetch onboarding status" });
    }
  });

  app.post("/api/onboarding/seen", authMiddleware, (req: any, res) => {
    try {
      (db as any).$client.prepare(
        "UPDATE users SET onboarding_seen = 1 WHERE id = ?"
      ).run(req.userId);
      res.json({ success: true });
    } catch (err: any) {
      console.error("[onboarding] seen error:", err);
      res.status(500).json({ error: "Failed to update onboarding status" });
    }
  });

  // ── VERITAPT - Proficiency Testing Tracker ─────────────────────────────
  function hasPTAccess(user: any) {
    return ["annual", "professional", "lab", "complete"].includes(user?.plan);
  }

  // List enrollments for user
  app.get("/api/veritapt/enrollments", authMiddleware, (req: any, res) => {
    if (!hasPTAccess(req.user)) return res.status(403).json({ error: "VeritaPT™ subscription required" });
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const rows = (db as any).$client.prepare(
      "SELECT * FROM pt_enrollments WHERE user_id = ? ORDER BY enrollment_year DESC, analyte"
    ).all(dataUserId);
    res.json(rows);
  });

  // Create enrollment
  app.post("/api/veritapt/enrollments", authMiddleware, requireWriteAccess, requireModuleEdit('veritapt'), (req: any, res) => {
    if (!hasPTAccess(req.user)) return res.status(403).json({ error: "VeritaPT™ subscription required" });
    const { analyte, specialty, pt_provider, program_code, enrollment_year, enrollment_date, status } = req.body;
    if (!analyte?.trim() || !specialty?.trim() || !pt_provider?.trim() || !enrollment_year || !enrollment_date) {
      return res.status(400).json({ error: "Analyte, specialty, PT provider, enrollment year, and enrollment date are required" });
    }
    const now = new Date().toISOString();
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const result = (db as any).$client.prepare(
      "INSERT INTO pt_enrollments (user_id, analyte, specialty, pt_provider, program_code, enrollment_year, enrollment_date, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(dataUserId, analyte.trim(), specialty.trim(), pt_provider.trim(), program_code || null, enrollment_year, enrollment_date, status || 'active', now, now);
    const created = (db as any).$client.prepare("SELECT * FROM pt_enrollments WHERE id = ?").get(Number(result.lastInsertRowid));
    res.json(created);
  });

  // Update enrollment
  app.put("/api/veritapt/enrollments/:id", authMiddleware, requireWriteAccess, requireModuleEdit('veritapt'), (req: any, res) => {
    if (!hasPTAccess(req.user)) return res.status(403).json({ error: "VeritaPT™ subscription required" });
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const existing = (db as any).$client.prepare("SELECT * FROM pt_enrollments WHERE id = ? AND user_id = ?").get(req.params.id, dataUserId);
    if (!existing) return res.status(404).json({ error: "Enrollment not found" });
    const { analyte, specialty, pt_provider, program_code, enrollment_year, enrollment_date, status } = req.body;
    const now = new Date().toISOString();
    (db as any).$client.prepare(
      "UPDATE pt_enrollments SET analyte = ?, specialty = ?, pt_provider = ?, program_code = ?, enrollment_year = ?, enrollment_date = ?, status = ?, updated_at = ? WHERE id = ?"
    ).run(
      analyte ?? existing.analyte, specialty ?? existing.specialty, pt_provider ?? existing.pt_provider,
      program_code !== undefined ? program_code : existing.program_code,
      enrollment_year ?? existing.enrollment_year, enrollment_date ?? existing.enrollment_date,
      status ?? existing.status, now, req.params.id
    );
    const updated = (db as any).$client.prepare("SELECT * FROM pt_enrollments WHERE id = ?").get(req.params.id);
    res.json(updated);
  });

  // Delete enrollment (cascade: events + their corrective actions)
  app.delete("/api/veritapt/enrollments/:id", authMiddleware, requireWriteAccess, requireModuleEdit('veritapt'), (req: any, res) => {
    if (!hasPTAccess(req.user)) return res.status(403).json({ error: "VeritaPT™ subscription required" });
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const existing = (db as any).$client.prepare("SELECT id FROM pt_enrollments WHERE id = ? AND user_id = ?").get(req.params.id, dataUserId);
    if (!existing) return res.status(404).json({ error: "Enrollment not found" });
    // Get event IDs for cascade delete
    const events = (db as any).$client.prepare("SELECT id FROM pt_events WHERE enrollment_id = ?").all(req.params.id) as any[];
    for (const ev of events) {
      (db as any).$client.prepare("DELETE FROM pt_corrective_actions WHERE event_id = ?").run(ev.id);
    }
    (db as any).$client.prepare("DELETE FROM pt_events WHERE enrollment_id = ?").run(req.params.id);
    (db as any).$client.prepare("DELETE FROM pt_enrollments WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  });

  // List events for user (optional enrollmentId filter)
  app.get("/api/veritapt/events", authMiddleware, (req: any, res) => {
    if (!hasPTAccess(req.user)) return res.status(403).json({ error: "VeritaPT™ subscription required" });
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const enrollmentId = req.query.enrollmentId;
    let rows;
    if (enrollmentId) {
      rows = (db as any).$client.prepare(
        "SELECT * FROM pt_events WHERE user_id = ? AND enrollment_id = ? ORDER BY event_date DESC"
      ).all(dataUserId, enrollmentId);
    } else {
      rows = (db as any).$client.prepare(
        "SELECT * FROM pt_events WHERE user_id = ? ORDER BY event_date DESC"
      ).all(dataUserId);
    }
    res.json(rows);
  });

  // Create event (auto-calculate SDI if peer_mean and peer_sd provided)
  app.post("/api/veritapt/events", authMiddleware, requireWriteAccess, requireModuleEdit('veritapt'), (req: any, res) => {
    if (!hasPTAccess(req.user)) return res.status(403).json({ error: "VeritaPT™ subscription required" });
    const { enrollment_id, event_id, event_name, event_date, analyte, your_result, your_method, peer_mean, peer_sd, peer_n, acceptable_low, acceptable_high, pass_fail, notes } = req.body;
    if (!enrollment_id || !event_date || !analyte?.trim()) {
      return res.status(400).json({ error: "Enrollment, event date, and analyte are required" });
    }
    // Auto-calculate SDI
    let sdi = null;
    if (your_result != null && peer_mean != null && peer_sd != null && peer_sd !== 0) {
      sdi = Math.round(((your_result - peer_mean) / peer_sd) * 100) / 100;
    }
    const now = new Date().toISOString();
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const result = (db as any).$client.prepare(
      "INSERT INTO pt_events (enrollment_id, user_id, event_id, event_name, event_date, analyte, your_result, your_method, peer_mean, peer_sd, peer_n, acceptable_low, acceptable_high, sdi, pass_fail, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(enrollment_id, dataUserId, event_id || null, event_name || null, event_date, analyte.trim(), your_result ?? null, your_method || null, peer_mean ?? null, peer_sd ?? null, peer_n ?? null, acceptable_low ?? null, acceptable_high ?? null, sdi, pass_fail || 'pending', notes || null, now, now);
    const created = (db as any).$client.prepare("SELECT * FROM pt_events WHERE id = ?").get(Number(result.lastInsertRowid));
    res.json(created);
  });

  // Update event (recalculate SDI if needed)
  app.put("/api/veritapt/events/:id", authMiddleware, requireWriteAccess, requireModuleEdit('veritapt'), (req: any, res) => {
    if (!hasPTAccess(req.user)) return res.status(403).json({ error: "VeritaPT™ subscription required" });
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const existing = (db as any).$client.prepare("SELECT * FROM pt_events WHERE id = ? AND user_id = ?").get(req.params.id, dataUserId);
    if (!existing) return res.status(404).json({ error: "Event not found" });
    const { enrollment_id, event_id, event_name, event_date, analyte, your_result, your_method, peer_mean, peer_sd, peer_n, acceptable_low, acceptable_high, pass_fail, notes } = req.body;
    const finalResult = your_result !== undefined ? your_result : existing.your_result;
    const finalPeerMean = peer_mean !== undefined ? peer_mean : existing.peer_mean;
    const finalPeerSd = peer_sd !== undefined ? peer_sd : existing.peer_sd;
    let sdi = existing.sdi;
    if (finalResult != null && finalPeerMean != null && finalPeerSd != null && finalPeerSd !== 0) {
      sdi = Math.round(((finalResult - finalPeerMean) / finalPeerSd) * 100) / 100;
    }
    const now = new Date().toISOString();
    (db as any).$client.prepare(
      "UPDATE pt_events SET enrollment_id = ?, event_id = ?, event_name = ?, event_date = ?, analyte = ?, your_result = ?, your_method = ?, peer_mean = ?, peer_sd = ?, peer_n = ?, acceptable_low = ?, acceptable_high = ?, sdi = ?, pass_fail = ?, notes = ?, updated_at = ? WHERE id = ?"
    ).run(
      enrollment_id ?? existing.enrollment_id, event_id !== undefined ? event_id : existing.event_id,
      event_name !== undefined ? event_name : existing.event_name, event_date ?? existing.event_date,
      analyte ?? existing.analyte, finalResult, your_method !== undefined ? your_method : existing.your_method,
      finalPeerMean, finalPeerSd, peer_n !== undefined ? peer_n : existing.peer_n,
      acceptable_low !== undefined ? acceptable_low : existing.acceptable_low,
      acceptable_high !== undefined ? acceptable_high : existing.acceptable_high,
      sdi, pass_fail ?? existing.pass_fail, notes !== undefined ? notes : existing.notes, now, req.params.id
    );
    const updated = (db as any).$client.prepare("SELECT * FROM pt_events WHERE id = ?").get(req.params.id);
    res.json(updated);
  });

  // Delete event (cascade: corrective actions)
  app.delete("/api/veritapt/events/:id", authMiddleware, requireWriteAccess, requireModuleEdit('veritapt'), (req: any, res) => {
    if (!hasPTAccess(req.user)) return res.status(403).json({ error: "VeritaPT™ subscription required" });
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const existing = (db as any).$client.prepare("SELECT id FROM pt_events WHERE id = ? AND user_id = ?").get(req.params.id, dataUserId);
    if (!existing) return res.status(404).json({ error: "Event not found" });
    (db as any).$client.prepare("DELETE FROM pt_corrective_actions WHERE event_id = ?").run(req.params.id);
    (db as any).$client.prepare("DELETE FROM pt_events WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  });

  // List corrective actions for user
  app.get("/api/veritapt/corrective-actions", authMiddleware, (req: any, res) => {
    if (!hasPTAccess(req.user)) return res.status(403).json({ error: "VeritaPT™ subscription required" });
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const rows = (db as any).$client.prepare(
      "SELECT * FROM pt_corrective_actions WHERE user_id = ? ORDER BY date_initiated DESC"
    ).all(dataUserId);
    res.json(rows);
  });

  // Get corrective action for specific event
  app.get("/api/veritapt/corrective-actions/event/:eventId", authMiddleware, (req: any, res) => {
    if (!hasPTAccess(req.user)) return res.status(403).json({ error: "VeritaPT™ subscription required" });
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const row = (db as any).$client.prepare(
      "SELECT * FROM pt_corrective_actions WHERE event_id = ? AND user_id = ?"
    ).get(req.params.eventId, dataUserId);
    res.json(row || null);
  });

  // Create corrective action
  app.post("/api/veritapt/corrective-actions", authMiddleware, requireWriteAccess, requireModuleEdit('veritapt'), (req: any, res) => {
    if (!hasPTAccess(req.user)) return res.status(403).json({ error: "VeritaPT™ subscription required" });
    const { event_id, root_cause, corrective_action, preventive_action, responsible_person, date_initiated, date_completed, status, verified_by, verified_date } = req.body;
    if (!event_id || !corrective_action?.trim() || !date_initiated) {
      return res.status(400).json({ error: "Event ID, corrective action, and date initiated are required" });
    }
    const now = new Date().toISOString();
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const result = (db as any).$client.prepare(
      "INSERT INTO pt_corrective_actions (event_id, user_id, root_cause, corrective_action, preventive_action, responsible_person, date_initiated, date_completed, status, verified_by, verified_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(event_id, dataUserId, root_cause || null, corrective_action.trim(), preventive_action || null, responsible_person || null, date_initiated, date_completed || null, status || 'open', verified_by || null, verified_date || null, now, now);
    const created = (db as any).$client.prepare("SELECT * FROM pt_corrective_actions WHERE id = ?").get(Number(result.lastInsertRowid));
    res.json(created);
  });

  // Update corrective action
  app.put("/api/veritapt/corrective-actions/:id", authMiddleware, requireWriteAccess, requireModuleEdit('veritapt'), (req: any, res) => {
    if (!hasPTAccess(req.user)) return res.status(403).json({ error: "VeritaPT™ subscription required" });
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const existing = (db as any).$client.prepare("SELECT * FROM pt_corrective_actions WHERE id = ? AND user_id = ?").get(req.params.id, dataUserId);
    if (!existing) return res.status(404).json({ error: "Corrective action not found" });
    const { root_cause, corrective_action, preventive_action, responsible_person, date_initiated, date_completed, status, verified_by, verified_date } = req.body;
    const now = new Date().toISOString();
    (db as any).$client.prepare(
      "UPDATE pt_corrective_actions SET root_cause = ?, corrective_action = ?, preventive_action = ?, responsible_person = ?, date_initiated = ?, date_completed = ?, status = ?, verified_by = ?, verified_date = ?, updated_at = ? WHERE id = ?"
    ).run(
      root_cause !== undefined ? root_cause : existing.root_cause,
      corrective_action ?? existing.corrective_action,
      preventive_action !== undefined ? preventive_action : existing.preventive_action,
      responsible_person !== undefined ? responsible_person : existing.responsible_person,
      date_initiated ?? existing.date_initiated,
      date_completed !== undefined ? date_completed : existing.date_completed,
      status ?? existing.status,
      verified_by !== undefined ? verified_by : existing.verified_by,
      verified_date !== undefined ? verified_date : existing.verified_date,
      now, req.params.id
    );
    const updated = (db as any).$client.prepare("SELECT * FROM pt_corrective_actions WHERE id = ?").get(req.params.id);
    res.json(updated);
  });

  // Summary stats
  app.get("/api/veritapt/summary", authMiddleware, (req: any, res) => {
    if (!hasPTAccess(req.user)) return res.status(403).json({ error: "VeritaPT™ subscription required" });
    const dataUserId = req.ownerUserId ?? req.user.userId;
    const totalEnrollments = ((db as any).$client.prepare(
      "SELECT COUNT(*) as cnt FROM pt_enrollments WHERE user_id = ? AND status = 'active'"
    ).get(dataUserId) as any).cnt;

    const currentYear = new Date().getFullYear().toString();
    const eventsThisYear = ((db as any).$client.prepare(
      "SELECT COUNT(*) as cnt FROM pt_events WHERE user_id = ? AND strftime('%Y', event_date) = ?"
    ).get(dataUserId, currentYear) as any).cnt;

    const passCount = ((db as any).$client.prepare(
      "SELECT COUNT(*) as cnt FROM pt_events WHERE user_id = ? AND pass_fail = 'pass'"
    ).get(dataUserId) as any).cnt;
    const failCount = ((db as any).$client.prepare(
      "SELECT COUNT(*) as cnt FROM pt_events WHERE user_id = ? AND pass_fail = 'fail'"
    ).get(dataUserId) as any).cnt;
    const gradedTotal = passCount + failCount;
    const passRate = gradedTotal > 0 ? Math.round((passCount / gradedTotal) * 1000) / 10 : 0;

    const openCorrectiveActions = ((db as any).$client.prepare(
      "SELECT COUNT(*) as cnt FROM pt_corrective_actions WHERE user_id = ? AND status = 'open'"
    ).get(dataUserId) as any).cnt;

    res.json({ totalEnrollments, eventsThisYear, passRate, openCorrectiveActions });
  });

  // PDF placeholder
  app.post("/api/veritapt/pdf", authMiddleware, async (req: any, res) => {
    if (!hasPTAccess(req.user)) return res.status(403).json({ error: "VeritaPT™ subscription required" });
    try {
      const userId = req.ownerUserId ?? req.user.userId;
      const ptLab = resolveLabForUser(userId);
      let ptLabName = "";
      let ptCliaNum = "";
      if (ptLab) {
        ptLabName = ptLab.lab_name || "";
        ptCliaNum = ptLab.clia_number || "";
      } else {
        const userRow = (db as any).$client.prepare("SELECT clia_number, clia_lab_name FROM users WHERE id = ?").get(userId) as any;
        ptLabName = userRow?.clia_lab_name || "";
        ptCliaNum = userRow?.clia_number || "";
      }
      const enrollments = (db as any).$client.prepare("SELECT * FROM pt_enrollments WHERE user_id = ? AND status = 'active' ORDER BY enrollment_year DESC, analyte").all(userId);
      const events = (db as any).$client.prepare("SELECT * FROM pt_events WHERE user_id = ? ORDER BY event_date DESC").all(userId);
      const cas = (db as any).$client.prepare("SELECT ca.*, e.analyte, e.event_date FROM pt_corrective_actions ca JOIN pt_events e ON e.id = ca.event_id WHERE ca.user_id = ? ORDER BY ca.date_initiated DESC").all(userId);
      const currentYear = new Date().getFullYear().toString();
      const eventsThisYear = events.filter((e: any) => e.event_date?.startsWith(currentYear)).length;
      const gradedEvents = events.filter((e: any) => e.pass_fail === 'pass' || e.pass_fail === 'fail');
      const passRate = gradedEvents.length > 0 ? (gradedEvents.filter((e: any) => e.pass_fail === 'pass').length / gradedEvents.length) * 100 : 0;
      const openCAs = cas.filter((c: any) => c.status === 'open').length;
      const pdfBuffer = await generateVeritaPTPDF({
        labName: ptLabName,
        cliaNumber: ptCliaNum,
        generatedAt: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
        summary: { totalEnrollments: enrollments.length, eventsThisYear, passRate, openCorrectiveActions: openCAs },
        enrollments,
        events,
        correctiveActions: cas,
      });
      const date = new Date().toISOString().split("T")[0];
      const filename = `VeritaPT_Report_${date}.pdf`;
      const ptPdfToken = storePdfToken(pdfBuffer, filename);
      if (ptLab) markLabReportingLocks(ptLab.id);
      res.json({ token: ptPdfToken });
    } catch (err: any) {
      console.error("VeritaPT PDF error:", err);
      res.status(500).json({ error: "PDF generation failed", detail: err.message });
    }
  });

  // ── PT Program Recommendations ─────────────────────────────────────────
  app.get("/api/veritapt/recommendations", authMiddleware, (req: any, res) => {
    try {
      const userId = req.ownerUserId ?? req.user.userId;

      // 1. Get the user's most recent VeritaMap
      const map = (db as any).$client.prepare(
        "SELECT id, name FROM veritamap_maps WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1"
      ).get(userId) as any;

      // Fetch preferred PT vendor
      const prefRow = (db as any).$client.prepare("SELECT preferred_pt_vendor FROM users WHERE id = ?").get(userId) as any;
      const preferredVendor = prefRow?.preferred_pt_vendor || 'none';

      if (!map) {
        return res.json({
          hasMap: false,
          mapName: null,
          preferredVendor,
          waived: [],
          nonWaived: [],
          gaps: [],
          alreadyCovered: [],
          recommendations: [],
        });
      }

      // 2. Get all active analytes from the map
      const tests = (db as any).$client.prepare(
        "SELECT analyte, specialty, complexity FROM veritamap_instrument_tests WHERE map_id = ? AND active = 1"
      ).all(map.id) as { analyte: string; specialty: string; complexity: string }[];

      // 3. Separate waived vs non-waived
      const waived: { analyte: string; specialty: string }[] = [];
      const nonWaived: { analyte: string; specialty: string; complexity: string }[] = [];
      const seen = new Set<string>();
      for (const t of tests) {
        const key = t.analyte.toLowerCase().trim();
        if (seen.has(key)) continue;
        seen.add(key);
        if (t.complexity.toLowerCase() === "waived") {
          waived.push({ analyte: t.analyte, specialty: t.specialty });
        } else {
          nonWaived.push({ analyte: t.analyte, specialty: t.specialty, complexity: t.complexity });
        }
      }

      // 4. Analyte normalization map
      const normMap: Record<string, string> = {
        "glucose": "Glucose",
        "na": "Sodium", "sodium": "Sodium",
        "k": "Potassium", "potassium": "Potassium",
        "cl": "Chloride", "chloride": "Chloride",
        "co2": "CO2", "bicarbonate": "CO2", "hco3": "CO2",
        "bun": "BUN", "urea nitrogen": "BUN",
        "creatinine": "Creatinine", "creat": "Creatinine",
        "calcium": "Calcium", "ca": "Calcium",
        "total protein": "Total Protein", "tp": "Total Protein",
        "albumin": "Albumin", "alb": "Albumin",
        "total bilirubin": "Total Bilirubin", "tbili": "Total Bilirubin", "t bili": "Total Bilirubin",
        "direct bilirubin": "Direct Bilirubin", "dbili": "Direct Bilirubin", "d bili": "Direct Bilirubin",
        "alt": "ALT", "sgpt": "ALT",
        "ast": "AST", "sgot": "AST",
        "alkaline phosphatase": "Alkaline Phosphatase", "alk phos": "Alkaline Phosphatase", "alp": "Alkaline Phosphatase",
        "ldh": "LDH", "lactate dehydrogenase": "LDH",
        "ggt": "GGT", "gamma gt": "GGT",
        "uric acid": "Uric Acid",
        "phosphorus": "Phosphorus", "phos": "Phosphorus", "phosphate": "Phosphorus",
        "magnesium": "Magnesium", "mg": "Magnesium",
        "iron": "Iron", "fe": "Iron",
        "cholesterol": "Cholesterol", "chol": "Cholesterol",
        "triglycerides": "Triglycerides", "trig": "Triglycerides", "tg": "Triglycerides",
        "hdl": "HDL Cholesterol", "hdl cholesterol": "HDL Cholesterol", "hdl-c": "HDL Cholesterol",
        "ldl": "LDL Cholesterol", "ldl cholesterol": "LDL Cholesterol", "ldl-c": "LDL Cholesterol",
        "tsh": "TSH", "thyroid stimulating hormone": "TSH",
        "free t4": "Free T4", "ft4": "Free T4", "thyroxine free": "Free T4",
        "free t3": "Free T3", "ft3": "Free T3", "triiodothyronine free": "Free T3",
        "hemoglobin a1c": "Hemoglobin A1c", "hba1c": "Hemoglobin A1c", "a1c": "Hemoglobin A1c",
        "glycated hemoglobin": "Hemoglobin A1c", "glycohemoglobin": "Hemoglobin A1c",
        "wbc": "WBC", "white blood cell": "WBC", "leukocyte count": "WBC",
        "rbc": "RBC", "red blood cell": "RBC", "erythrocyte count": "RBC",
        "hemoglobin": "Hemoglobin", "hgb": "Hemoglobin", "hb": "Hemoglobin",
        "hematocrit": "Hematocrit", "hct": "Hematocrit", "packed cell volume": "Hematocrit", "pcv": "Hematocrit",
        "mcv": "MCV", "mch": "MCH", "mchc": "MCHC", "rdw": "RDW",
        "platelet count": "Platelet Count", "plt": "Platelet Count", "thrombocyte count": "Platelet Count",
        "pt": "PT", "prothrombin time": "PT",
        "inr": "INR", "international normalized ratio": "INR",
        "aptt": "APTT", "ptt": "APTT", "activated partial thromboplastin time": "APTT",
        "partial thromboplastin time": "APTT",
        "fibrinogen": "Fibrinogen",
        "troponin i": "Troponin I", "ctni": "Troponin I",
        "troponin t": "Troponin T", "ctnt": "Troponin T", "troponin": "Troponin T",
        "bnp": "BNP", "brain natriuretic peptide": "BNP",
        "crp": "CRP", "c-reactive protein": "CRP", "c reactive protein": "CRP",
        "esr": "ESR", "sed rate": "ESR", "erythrocyte sedimentation rate": "ESR",
        "psa": "PSA", "prostate specific antigen": "PSA",
        "urinalysis": "Urinalysis", "ua": "Urinalysis", "u/a": "Urinalysis",
        "ph": "pH",
        "pco2": "pCO2", "partial pressure co2": "pCO2",
        "po2": "pO2", "partial pressure o2": "pO2",
        "ionized calcium": "Ionized Calcium", "ica": "Ionized Calcium", "ca ionized": "Ionized Calcium",
        "lactate": "Lactate", "lactic acid": "Lactate",
        "rf": "RF", "rheumatoid factor": "RF",
        "ana": "ANA", "antinuclear antibody": "ANA", "antinuclear antibodies": "ANA",
        "ferritin": "Ferritin",
        "tibc": "TIBC", "total iron binding capacity": "TIBC",
      };

      const normalizeAnalyte = (name: string): string => {
        const key = name.toLowerCase().trim().replace(/\s+/g, ' ');
        return normMap[key] || name;
      };

      // 5. Build canonical analyte sets
      const nonWaivedCanonical = nonWaived.map(t => normalizeAnalyte(t.analyte));
      const uniqueNonWaived = Array.from(new Set(nonWaivedCanonical));

      // 6. Get active PT enrollments to determine already-covered analytes
      const enrollments = (db as any).$client.prepare(
        "SELECT analyte FROM pt_enrollments WHERE user_id = ? AND status = 'active'"
      ).all(userId) as { analyte: string }[];
      const enrolledSet = new Set(enrollments.map(e => normalizeAnalyte(e.analyte)));

      const alreadyCovered: string[] = [];
      const gaps: string[] = [];
      for (const analyte of uniqueNonWaived) {
        if (enrolledSet.has(analyte)) {
          alreadyCovered.push(analyte);
        } else {
          gaps.push(analyte);
        }
      }

      // 7. PT catalog
      const CAP_URL = "https://www.cap.org/laboratory-improvement/proficiency-testing/proficiency-testing-programs";
      const API_URL = "https://www.apipt.org";

      const catalog: { provider: "CAP" | "API"; catalogNumber: string; programName: string; url: string; analytes: string[] }[] = [
        { provider: "CAP", catalogNumber: "CAP-GEN-110", programName: "General Chemistry", url: CAP_URL, analytes: ["Glucose","Sodium","Potassium","Chloride","CO2","BUN","Creatinine","Calcium","Total Protein","Albumin","Total Bilirubin","ALT","AST","Alkaline Phosphatase","LDH","GGT","Uric Acid","Phosphorus","Magnesium","Iron","Cholesterol","Triglycerides","HDL Cholesterol","LDL Cholesterol"] },
        { provider: "CAP", catalogNumber: "CAP-GEN-120", programName: "Glucose", url: CAP_URL, analytes: ["Glucose"] },
        { provider: "CAP", catalogNumber: "CAP-HEM-210", programName: "Hematology", url: CAP_URL, analytes: ["WBC","RBC","Hemoglobin","Hematocrit","MCV","MCH","MCHC","Platelet Count","Differential Count"] },
        { provider: "CAP", catalogNumber: "CAP-COA-310", programName: "Coagulation", url: CAP_URL, analytes: ["PT","INR","APTT","Fibrinogen","Thrombin Time"] },
        { provider: "CAP", catalogNumber: "CAP-IMM-410", programName: "Immunology", url: CAP_URL, analytes: ["ANA","RF","CRP","ASO","Anti-dsDNA","Anti-SSA","Anti-SSB","Anti-Sm","Anti-Scl-70","Anti-Jo-1"] },
        { provider: "CAP", catalogNumber: "CAP-TDM-510", programName: "Therapeutic Drug Monitoring", url: CAP_URL, analytes: ["Digoxin","Phenytoin","Phenobarbital","Carbamazepine","Valproic Acid","Theophylline","Lithium","Cyclosporine","Tacrolimus","Sirolimus","Vancomycin","Gentamicin","Tobramycin","Amikacin","Methotrexate"] },
        { provider: "CAP", catalogNumber: "CAP-GLY-120", programName: "HbA1c", url: CAP_URL, analytes: ["Hemoglobin A1c"] },
        { provider: "CAP", catalogNumber: "CAP-LPD-150", programName: "Lipids", url: CAP_URL, analytes: ["Cholesterol","Triglycerides","HDL Cholesterol","LDL Cholesterol"] },
        { provider: "CAP", catalogNumber: "CAP-URN-610", programName: "Urinalysis", url: CAP_URL, analytes: ["Urinalysis","Urine Dipstick","Urine Microscopy","Urine Color","Urine Clarity","Urine pH","Urine Specific Gravity","Urine Protein","Urine Glucose","Urine Ketones","Urine Blood","Urine Bilirubin","Urine Urobilinogen","Urine Nitrite","Urine Leukocyte Esterase"] },
        { provider: "CAP", catalogNumber: "CAP-BLG-710", programName: "Blood Gas", url: CAP_URL, analytes: ["pH","pCO2","pO2","HCO3","Base Excess","O2 Saturation","Ionized Calcium","Sodium","Potassium","Chloride","Glucose","Lactate","Hematocrit"] },
        { provider: "API", catalogNumber: "API-CHEM-C01", programName: "Chemistry Survey", url: API_URL, analytes: ["Glucose","BUN","Creatinine","Sodium","Potassium","Chloride","CO2","Calcium","Total Protein","Albumin","Total Bilirubin","Direct Bilirubin","ALT","AST","Alkaline Phosphatase","GGT","LDH","Uric Acid","Phosphorus","Magnesium","Iron","TIBC","Ferritin"] },
        { provider: "API", catalogNumber: "API-CHEM-C02", programName: "Lipid Panel", url: API_URL, analytes: ["Cholesterol","Triglycerides","HDL Cholesterol","LDL Cholesterol","VLDL Cholesterol"] },
        { provider: "API", catalogNumber: "API-CHEM-C03", programName: "Glucose Monitoring", url: API_URL, analytes: ["Glucose","Hemoglobin A1c","Fructosamine"] },
        { provider: "API", catalogNumber: "API-CHEM-C04", programName: "Thyroid", url: API_URL, analytes: ["TSH","Free T4","Free T3","Total T4","Total T3","Thyroglobulin","Anti-TPO","Anti-Tg"] },
        { provider: "API", catalogNumber: "API-CHEM-C05", programName: "Cardiac Markers", url: API_URL, analytes: ["Troponin I","Troponin T","CK-MB","BNP","NT-proBNP","Myoglobin","CK"] },
        { provider: "API", catalogNumber: "API-CHEM-C06", programName: "Tumor Markers", url: API_URL, analytes: ["PSA","CEA","AFP","CA 125","CA 19-9","CA 15-3","Beta-hCG"] },
        { provider: "API", catalogNumber: "API-CHEM-C07", programName: "Renal", url: API_URL, analytes: ["Creatinine","BUN","Cystatin C","eGFR","Uric Acid","Phosphorus","Calcium","Magnesium"] },
        { provider: "API", catalogNumber: "API-CHEM-C08", programName: "Hepatic", url: API_URL, analytes: ["ALT","AST","Alkaline Phosphatase","GGT","Total Bilirubin","Direct Bilirubin","Albumin","Total Protein","Prothrombin Time","INR"] },
        { provider: "API", catalogNumber: "API-CHEM-C09", programName: "Electrolytes", url: API_URL, analytes: ["Sodium","Potassium","Chloride","CO2","Bicarbonate","Anion Gap"] },
        { provider: "API", catalogNumber: "API-HEMA-H01", programName: "Complete Blood Count", url: API_URL, analytes: ["WBC","RBC","Hemoglobin","Hematocrit","MCV","MCH","MCHC","RDW","Platelet Count","MPV"] },
        { provider: "API", catalogNumber: "API-HEMA-H02", programName: "Differential", url: API_URL, analytes: ["Neutrophils","Lymphocytes","Monocytes","Eosinophils","Basophils","Bands","Metamyelocytes"] },
        { provider: "API", catalogNumber: "API-HEMA-H03", programName: "Reticulocyte", url: API_URL, analytes: ["Reticulocyte Count","Reticulocyte Hemoglobin","IRF"] },
        { provider: "API", catalogNumber: "API-COAG-K01", programName: "Basic Coagulation", url: API_URL, analytes: ["PT","INR","APTT","Thrombin Time","Fibrinogen"] },
        { provider: "API", catalogNumber: "API-COAG-K02", programName: "Special Coagulation", url: API_URL, analytes: ["Anti-Xa","Lupus Anticoagulant","DRVVT","Mixing Studies","Factor Assays","Protein C","Protein S","Antithrombin"] },
        { provider: "API", catalogNumber: "API-IMMU-I01", programName: "Immunology", url: API_URL, analytes: ["CRP","ESR","RF","ANA","Anti-dsDNA","Complement C3","Complement C4","IgG","IgA","IgM","IgE"] },
      ];

      // 8. Score programs by gap coverage
      const gapSet = new Set(gaps);
      const recommendations = catalog
        .map(prog => {
          const covered = prog.analytes.filter(a => gapSet.has(a));
          return {
            provider: prog.provider,
            catalogNumber: prog.catalogNumber,
            programName: prog.programName,
            url: prog.url,
            gapAnalytesCovered: covered,
            coverageCount: covered.length,
          };
        })
        .filter(r => r.coverageCount > 0)
        .sort((a, b) => b.coverageCount - a.coverageCount);

      // Sort preferred vendor's programs first
      if (preferredVendor !== 'none') {
        recommendations.sort((a, b) => {
          const aPreferred = a.provider.toLowerCase() === preferredVendor ? 1 : 0;
          const bPreferred = b.provider.toLowerCase() === preferredVendor ? 1 : 0;
          if (bPreferred !== aPreferred) return bPreferred - aPreferred;
          return b.coverageCount - a.coverageCount;
        });
      }

      res.json({
        hasMap: true,
        mapName: map.name,
        preferredVendor,
        waived,
        nonWaived,
        gaps,
        alreadyCovered,
        recommendations,
      });
    } catch (err: any) {
      console.error("Recommendations error:", err);
      res.status(500).json({ error: "Failed to compute recommendations", detail: err.message });
    }
  });

  // ── ACCOUNT SETTINGS ────────────────────────────────────────────────────
  // Reads lab identity from labs table (via user.lab_id), includes seat/owner
  // role context and lock state for the UI.
  app.get("/api/account/settings", authMiddleware, (req: any, res) => {
    try {
      const userRow = (db as any).$client.prepare(
        "SELECT lab_id, preferred_pt_vendor FROM users WHERE id = ?"
      ).get(req.userId) as any;

      const lab = resolveLabForUser(req.userId);
      const isSeat = !!req.isSeatUser;

      // Derive preferred_standards array from accreditation flags on labs row
      // (kept for backward compatibility with older clients).
      const preferredStandards: string[] = [];
      if (lab) {
        if (lab.accreditation_cap) preferredStandards.push("CAP");
        if (lab.accreditation_tjc) preferredStandards.push("TJC");
        if (lab.accreditation_cola) preferredStandards.push("COLA");
        if (lab.accreditation_aabb) preferredStandards.push("AABB");
      }

      // Phase 1 (2026-05-01): single accreditation_choice radio. Six options:
      // TJC, CAP, AABB, COLA, CAP+AABB (reciprocal), CLIA only.
      // Derived from the four accreditation flags. Any impossible legacy
      // combination (e.g. CAP+TJC from the old up-to-2 design) collapses to
      // CLIA so the user is forced to re-pick.
      const accCount = (lab?.accreditation_cap ? 1 : 0) + (lab?.accreditation_tjc ? 1 : 0)
        + (lab?.accreditation_cola ? 1 : 0) + (lab?.accreditation_aabb ? 1 : 0);
      let accreditationChoice = "CLIA";
      if (accCount === 0) {
        accreditationChoice = "CLIA";
      } else if (accCount === 1 && lab?.accreditation_tjc) {
        accreditationChoice = "TJC";
      } else if (accCount === 1 && lab?.accreditation_cap) {
        accreditationChoice = "CAP";
      } else if (accCount === 1 && lab?.accreditation_aabb) {
        accreditationChoice = "AABB";
      } else if (accCount === 1 && lab?.accreditation_cola) {
        accreditationChoice = "COLA";
      } else if (accCount === 2 && lab?.accreditation_cap && lab?.accreditation_aabb) {
        accreditationChoice = "CAP+AABB";
      } else {
        // Impossible combination from legacy up-to-2 design.
        // Log and present as CLIA so the user re-picks.
        console.warn(`[account/settings] Lab ${lab?.id} has impossible accreditation combination`,
          { cap: lab?.accreditation_cap, tjc: lab?.accreditation_tjc,
            cola: lab?.accreditation_cola, aabb: lab?.accreditation_aabb });
        accreditationChoice = "CLIA";
      }

      // If seat user, look up owner display name
      let ownerName: string | null = null;
      if (isSeat && req.ownerUserId) {
        const ownerRow = (db as any).$client.prepare("SELECT name FROM users WHERE id = ?").get(req.ownerUserId) as any;
        ownerName = ownerRow?.name || null;
      }

      res.json({
        clia_number: lab?.clia_number || '',
        clia_lab_name: lab?.lab_name || '',
        preferred_standards: preferredStandards,
        accreditation_choice: accreditationChoice,
        preferred_pt_vendor: userRow?.preferred_pt_vendor || 'none',
        // Lab role context for UI
        is_seat: isSeat,
        owner_name: ownerName,
        clia_locked: lab?.clia_locked === 1,
        lab_name_locked: lab?.lab_name_locked === 1,
        lab_id: lab?.id || null,
      });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to fetch account settings" });
    }
  });

  app.put("/api/account/settings", authMiddleware, (req: any, res) => {
    try {
      const isSeat = !!req.isSeatUser;

      // Seat users cannot write lab fields at all
      if (isSeat) {
        const ownerRow = (db as any).$client.prepare("SELECT name FROM users WHERE id = ?").get(req.ownerUserId) as any;
        const ownerDisplayName = ownerRow?.name || "the lab owner";
        return res.status(403).json({ error: `Lab settings are managed by the lab owner (${ownerDisplayName}).` });
      }

      const { clia_number, clia_lab_name, preferred_standards, accreditation_choice, preferredPtVendor } = req.body;

      // Resolve or create lab row for this owner
      let lab = resolveLabForUser(req.userId);
      if (!lab) {
        // Owner doesn't have a lab yet -- create one
        const now = new Date().toISOString();
        const result = (db as any).$client.prepare(
          "INSERT INTO labs (clia_number, lab_name, owner_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
        ).run(clia_number || null, clia_lab_name || null, req.userId, now, now);
        const newLabId = Number(result.lastInsertRowid);
        (db as any).$client.prepare("UPDATE users SET lab_id = ? WHERE id = ?").run(newLabId, req.userId);
        // Also link existing seat users to this new lab
        const seatUsers = (db as any).$client.prepare(
          "SELECT seat_user_id FROM user_seats WHERE owner_user_id = ? AND status = 'active' AND seat_user_id IS NOT NULL"
        ).all(req.userId) as any[];
        for (const s of seatUsers) {
          (db as any).$client.prepare("UPDATE users SET lab_id = ? WHERE id = ?").run(newLabId, s.seat_user_id);
        }
        lab = (db as any).$client.prepare("SELECT * FROM labs WHERE id = ?").get(newLabId);
      }

      if (!lab) {
        return res.status(500).json({ error: "Failed to resolve lab record" });
      }

      // Check lock state for CLIA and lab name
      if (lab.clia_locked && clia_number !== undefined && (clia_number || null) !== (lab.clia_number || null)) {
        return res.status(403).json({ error: "CLIA number is locked once reports have been generated. Contact support to change." });
      }
      if (lab.lab_name_locked && clia_lab_name !== undefined && (clia_lab_name || null) !== (lab.lab_name || null)) {
        return res.status(403).json({ error: "Lab name is locked once reports have been generated. Contact support to change." });
      }

      // Phase 1 (2026-05-01): single accreditation_choice radio replaces the
      // up-to-2 array. Six options: TJC, CAP, AABB, COLA, CAP+AABB, CLIA.
      // Old clients that still send preferred_standards (array) keep working
      // via fallback below.
      const VALID_CHOICES = ["TJC", "CAP", "AABB", "COLA", "CAP+AABB", "CLIA"];
      const VALID_BODIES = ["CAP", "TJC", "COLA", "AABB"];
      let accCap = lab.accreditation_cap, accTjc = lab.accreditation_tjc;
      let accCola = lab.accreditation_cola, accAabb = lab.accreditation_aabb;

      if (typeof accreditation_choice === "string" && VALID_CHOICES.includes(accreditation_choice)) {
        // New shape: single radio choice
        accCap = 0; accTjc = 0; accCola = 0; accAabb = 0;
        switch (accreditation_choice) {
          case "TJC":      accTjc = 1; break;
          case "CAP":      accCap = 1; break;
          case "AABB":     accAabb = 1; break;
          case "COLA":     accCola = 1; break;
          case "CAP+AABB": accCap = 1; accAabb = 1; break;
          case "CLIA":     /* all flags zero */ break;
        }
      } else if (Array.isArray(preferred_standards)) {
        // Legacy shape: array of up to 2 bodies. Only valid combination is
        // CAP+AABB. Any other multi-selection collapses to CLIA so the user
        // re-picks intentionally.
        const filtered = preferred_standards.filter((s: string) => VALID_BODIES.includes(s));
        const set = new Set(filtered);
        if (set.size === 0) {
          accCap = 0; accTjc = 0; accCola = 0; accAabb = 0;
        } else if (set.size === 1) {
          accCap  = set.has("CAP")  ? 1 : 0;
          accTjc  = set.has("TJC")  ? 1 : 0;
          accCola = set.has("COLA") ? 1 : 0;
          accAabb = set.has("AABB") ? 1 : 0;
        } else if (set.size === 2 && set.has("CAP") && set.has("AABB")) {
          accCap = 1; accAabb = 1; accTjc = 0; accCola = 0;
        } else {
          // Invalid multi-selection from legacy clients: collapse to CLIA.
          accCap = 0; accTjc = 0; accCola = 0; accAabb = 0;
        }
      }

      // Audit log: track each changed field
      const fieldsToAudit: [string, any, any][] = [];
      if ((clia_number || null) !== (lab.clia_number || null)) fieldsToAudit.push(["clia_number", lab.clia_number, clia_number || null]);
      if ((clia_lab_name || null) !== (lab.lab_name || null)) fieldsToAudit.push(["lab_name", lab.lab_name, clia_lab_name || null]);
      if (accCap !== lab.accreditation_cap) fieldsToAudit.push(["accreditation_cap", String(lab.accreditation_cap), String(accCap)]);
      if (accTjc !== lab.accreditation_tjc) fieldsToAudit.push(["accreditation_tjc", String(lab.accreditation_tjc), String(accTjc)]);
      if (accCola !== lab.accreditation_cola) fieldsToAudit.push(["accreditation_cola", String(lab.accreditation_cola), String(accCola)]);
      if (accAabb !== lab.accreditation_aabb) fieldsToAudit.push(["accreditation_aabb", String(lab.accreditation_aabb), String(accAabb)]);

      for (const [field, oldVal, newVal] of fieldsToAudit) {
        writeLabAuditEntry(lab.id, req.userId, field, oldVal, newVal);
      }

      // Update labs row
      const now = new Date().toISOString();
      (db as any).$client.prepare(
        `UPDATE labs SET clia_number = ?, lab_name = ?, accreditation_cap = ?, accreditation_tjc = ?,
         accreditation_cola = ?, accreditation_aabb = ?, updated_at = ? WHERE id = ?`
      ).run(
        clia_number || null, clia_lab_name || null,
        accCap, accTjc, accCola, accAabb, now, lab.id
      );

      // Also keep user-level columns in sync for backward compatibility with
      // other code paths that still read from user record (PDF generation, etc.)
      const standardsJson = JSON.stringify(
        [accCap && "CAP", accTjc && "TJC", accCola && "COLA", accAabb && "AABB"].filter(Boolean)
      );

      // Validate preferred PT vendor
      const VALID_PT_VENDORS = ["cap", "api", "none"];
      const ptVendor = VALID_PT_VENDORS.includes(preferredPtVendor) ? preferredPtVendor : "none";
      (db as any).$client.prepare(
        "UPDATE users SET clia_number = ?, clia_lab_name = ?, preferred_standards = ?, preferred_pt_vendor = ? WHERE id = ?"
      ).run(clia_number || null, clia_lab_name || null, standardsJson, ptVendor, req.userId);

      res.json({ success: true });
    } catch (err: any) {
      console.error("[account/settings PUT] Error:", err.message);
      res.status(500).json({ error: "Failed to update account settings" });
    }
  });

  // ── HOSPITAL LOOKUP (bed count) ──────────────────────────────────────────
  let hospitalCache: any[] | null = null;

  app.get("/api/lookup/hospital", (req, res) => {
    const { name, state } = req.query as { name?: string; state?: string };
    if (!name || name.length < 3) return res.json({ results: [] });

    // Lazy-load hospitals.json
    if (!hospitalCache) {
      try {
        const fs = require("fs");
        const path = require("path");
        // Try multiple locations: adjacent to bundle (dist/), project root server/data/, or cwd
        const candidates = [
          path.join(__dirname, "data", "hospitals.json"),
          path.join(process.cwd(), "server", "data", "hospitals.json"),
          path.join(process.cwd(), "dist", "data", "hospitals.json"),
          path.join(__dirname, "..", "server", "data", "hospitals.json"),
        ];
        let loaded = false;
        for (const candidate of candidates) {
          if (fs.existsSync(candidate)) {
            hospitalCache = JSON.parse(fs.readFileSync(candidate, "utf-8"));
            loaded = true;
            break;
          }
        }
        if (!loaded) throw new Error("hospitals.json not found in any candidate path: " + candidates.join(", "));
      } catch (err: any) {
        console.error("[hospital-lookup] Failed to load hospitals.json:", err.message);
        return res.status(500).json({ error: "Hospital data unavailable" });
      }
    }

    const queryWords = name.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);
    if (queryWords.length === 0) return res.json({ results: [] });

    type ScoredHospital = { hospital: any; score: number };
    const scored: ScoredHospital[] = [];

    for (const h of hospitalCache!) {
      if (state && h.state !== state.toUpperCase()) continue;

      const hName = h.nameNormalized || h.name.toLowerCase();

      // Score: exact match > all words present > partial match
      let score = 0;
      if (hName === name.toLowerCase()) {
        score = 1000;
      } else {
        let allPresent = true;
        for (const w of queryWords) {
          if (hName.includes(w)) {
            score += 10;
          } else {
            allPresent = false;
          }
        }
        if (allPresent && queryWords.length > 0) score += 50;
      }

      if (score > 0) {
        scored.push({ hospital: h, score });
      }
    }

    scored.sort((a, b) => b.score - a.score || a.hospital.name.localeCompare(b.hospital.name));
    const top5 = scored.slice(0, 5);

    const results = top5.map(({ hospital }) => {
      const suggestion = suggestTierFromBeds(hospital.beds);
      return {
        name: hospital.name,
        state: hospital.state,
        zip: hospital.zip,
        beds: hospital.beds,
        ccn: hospital.ccn,
        facilityType: hospital.facilityType,
        suggestedTier: suggestion.tier,
        tierLabel: suggestion.label,
        tierPrice: suggestion.price,
        tierSeats: suggestion.seats,
      };
    });

    res.json({ results });
  });

  // ── ADMIN SET PLAN (PATCH) ──────────────────────────────────────────────
  app.patch("/api/admin/set-plan", (req, res) => {
    const secret = req.headers["x-admin-secret"] as string;
    if (secret !== ADMIN_SECRET) return res.status(403).json({ error: "forbidden" });

    const { userId, plan } = req.body;
    if (!userId || !plan) return res.status(400).json({ error: "userId and plan required" });

    const validPlans = ["free", "per_study", "clinic", "community", "hospital", "enterprise", "waived", "large_hospital", "veritacheck_only", "lab"];
    if (!validPlans.includes(plan)) return res.status(400).json({ error: "Invalid plan" });

    const planCredits = plan === "free" || plan === "per_study" ? 0 : 99999;
    storage.updateUserPlan(Number(userId), plan, planCredits);

    // Also update seat_count to match plan defaults
    const seats = PLAN_SEATS[plan] || 1;
    (db as any).$client.prepare("UPDATE users SET seat_count = ? WHERE id = ?").run(seats, Number(userId));

    const user = storage.getUserById(Number(userId));
    res.json({ ok: true, user: { id: user?.id, email: user?.email, plan: user?.plan, studyCredits: user?.studyCredits, seatCount: seats } });
  });

  // ── ADMIN: Audit log viewer ────────────────────────────────────────────────────────
  app.get("/api/admin/audit-log", (req, res) => {
    const secret = (req.query.secret || req.headers["x-admin-secret"]) as string;
    if (secret !== ADMIN_SECRET) return res.status(403).json({ error: "forbidden" });

    const { userId, module, limit = 200 } = req.query;
    let query = `SELECT * FROM audit_log WHERE 1=1`;
    const params: any[] = [];
    if (userId) { query += ` AND owner_user_id = ?`; params.push(Number(userId)); }
    if (module) { query += ` AND module = ?`; params.push(module); }
    query += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(Number(limit));
    const rows = (db as any).$client.prepare(query).all(...params) as any[];
    // Return without before/after JSON (too large for list view)
    const lite = rows.map(r => ({ ...r, before_json: r.before_json ? `${Math.round(r.before_json.length/1024*10)/10}KB` : null, after_json: r.after_json ? `${Math.round(r.after_json.length/1024*10)/10}KB` : null }));
    res.json({ entries: lite, count: lite.length });
  });

  // ── ADMIN: Snapshots viewer ────────────────────────────────────────────────────
  app.get("/api/admin/snapshots", (req, res) => {
    const secret = (req.query.secret || req.headers["x-admin-secret"]) as string;
    if (secret !== ADMIN_SECRET) return res.status(403).json({ error: "forbidden" });
    const { userId } = req.query;
    // Query directly from db to avoid any module caching issues
    if (!userId) {
      // Return all snapshots summary if no userId
      const all = (db as any).$client.prepare(
        "SELECT user_id, snapshot_date, created_at, length(modules_json) as size_bytes FROM nightly_snapshots ORDER BY created_at DESC LIMIT 50"
      ).all();
      return res.json({ snapshots: all, total: all.length });
    }
    const snaps = (db as any).$client.prepare(
      "SELECT id, snapshot_date, created_at, length(modules_json) as size_bytes FROM nightly_snapshots WHERE user_id = ? ORDER BY snapshot_date DESC LIMIT 30"
    ).all(Number(userId));
    res.json({ snapshots: snaps });
  });

  app.get("/api/admin/snapshots/:id", (req, res) => {
    const secret = (req.query.secret || req.headers["x-admin-secret"]) as string;
    if (secret !== ADMIN_SECRET) return res.status(403).json({ error: "forbidden" });
    const { getSnapshot } = require("./audit");
    const snap = getSnapshot(Number(req.params.id));
    if (!snap) return res.status(404).json({ error: "Snapshot not found" });
    res.json(snap);
  });

  // ── ADMIN: Trigger nightly snapshot manually ─────────────────────────────────────
  app.post("/api/admin/run-snapshot", (req, res) => {
    const secret = (req.query.secret as string || req.headers["x-admin-secret"] as string);
    if (secret !== ADMIN_SECRET) return res.status(403).json({ error: "forbidden" });
    try {
      const sqlite = (db as any).$client;
      const targetUserId = req.body?.userId || req.query?.userId;
      const today = new Date().toISOString().split("T")[0];
      const now = new Date().toISOString();

      // Get users to snapshot
      const users: { id: number }[] = targetUserId
        ? [{ id: Number(targetUserId) }]
        : sqlite.prepare("SELECT id FROM users").all();

      let saved = 0;
      for (const user of users) {
        try {
          // Capture snapshot - each query wrapped to handle missing tables gracefully
          const safeQuery = (sql: string, ...params: any[]) => { try { return sqlite.prepare(sql).all(...params); } catch { return []; } };
          const maps = safeQuery("SELECT id, name, created_at FROM veritamap_maps WHERE user_id = ?", user.id) as any[];
          const mapIds = maps.map((m: any) => m.id);
          const instrRows = mapIds.length ? safeQuery(`SELECT id, instrument_name, role, category FROM veritamap_instruments WHERE map_id IN (${mapIds.map(() => '?').join(',')})`, ...mapIds) as any[] : [];
          const instrIds = instrRows.map((i: any) => i.id);
          const snap = {
            snapshot_version: 1,
            user_id: user.id,
            captured_at: now,
            studies: safeQuery("SELECT id, test_name, study_type, instrument, analyst, date, status FROM studies WHERE user_id = ?", user.id),
            maps,
            instruments: instrRows,
            instrument_tests: instrIds.length ? safeQuery(`SELECT analyte, specialty, complexity, active, instrument_id FROM veritamap_instrument_tests WHERE instrument_id IN (${instrIds.map(() => '?').join(',')})`, ...instrIds) : [],
            scans: safeQuery("SELECT id, name, created_at FROM veritascan_scans WHERE user_id = ?", user.id),
            assessments: safeQuery("SELECT a.id, e.name as employee_name, p.name as program_name, a.assessment_type, a.status, a.created_at FROM competency_assessments a LEFT JOIN competency_employees e ON a.employee_id = e.id LEFT JOIN competency_programs p ON a.program_id = p.id WHERE p.user_id = ?", user.id),
            certificates: safeQuery("SELECT id, cert_type, cert_name, expiration_date FROM lab_certificates WHERE user_id = ? AND is_active = 1", user.id),
          };
          const jsonStr = JSON.stringify(snap);
          sqlite.prepare("DELETE FROM nightly_snapshots WHERE user_id = ? AND snapshot_date = ?").run(user.id, today);
          sqlite.prepare("INSERT INTO nightly_snapshots (user_id, snapshot_date, modules_json, created_at) VALUES (?, ?, ?, ?)").run(user.id, today, jsonStr, now);
          saved++;
        } catch (uerr: any) {
          console.error(`[snapshot] User ${user.id} failed:`, uerr.message);
        }
      }

      // Purge old snapshots
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      sqlite.prepare("DELETE FROM nightly_snapshots WHERE snapshot_date < ?").run(cutoff);

      res.json({ ok: true, message: `Snapshots saved for ${saved} of ${users.length} users on ${today}.` });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── ADMIN: Download raw SQLite database file (REAL external backup) ──────
  app.get("/api/admin/backup-db", (req, res) => {
    const secret = (req.query.secret as string || req.headers["x-admin-secret"] as string);
    if (secret !== ADMIN_SECRET) return res.status(403).json({ error: "forbidden" });
    try {
      const sqlite = (db as any).$client;
      // WAL checkpoint to ensure all data is in the main DB file
      sqlite.pragma('wal_checkpoint(TRUNCATE)');
      const dbPath = sqlite.name;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      res.setHeader('Content-Type', 'application/x-sqlite3');
      res.setHeader('Content-Disposition', `attachment; filename="veritas-backup-${timestamp}.db"`);
      const fileStream = fs.createReadStream(dbPath);
      fileStream.pipe(res);
    } catch (err: any) {
      console.error('[backup-db] Error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── ADMIN: One-shot seed for Michael's Lab demo data (COLA conf 2026-05-06) ──
  // Runs scripts/seed/michaels_lab_2026_05_03.sql against the live DB.
  // Idempotent: refuses to run if [SEED-2026-05-03] markers already present.
  // To re-seed: call DELETE first, then POST.
  app.post("/api/admin/seed-michaels-lab", (req, res) => {
    const secret = (req.query.secret as string || req.headers["x-admin-secret"] as string);
    if (secret !== ADMIN_SECRET) return res.status(403).json({ error: "forbidden" });
    try {
      const sqlite = (db as any).$client;
      // Idempotency check: refuse if already seeded
      const existing = sqlite.prepare(
        "SELECT COUNT(*) as n FROM staff_employees WHERE user_id=17 AND qualifications_text LIKE '%[SEED-2026-05-03]%'"
      ).get() as { n: number };
      if (existing.n > 0) {
        return res.status(409).json({
          error: "already_seeded",
          message: `Found ${existing.n} rows tagged [SEED-2026-05-03]. DELETE /api/admin/seed-michaels-lab to wipe first.`,
        });
      }
      const sqlPath = path.join(process.cwd(), "scripts", "seed", "michaels_lab_2026_05_03.sql");
      if (!fs.existsSync(sqlPath)) {
        return res.status(500).json({ error: "seed_file_missing", path: sqlPath });
      }
      const sql = fs.readFileSync(sqlPath, "utf-8");
      // better-sqlite3 .exec runs a multi-statement script.
      // BEGIN/COMMIT in the file handle the transaction.
      const before = {
        staff_employees: (sqlite.prepare("SELECT COUNT(*) as n FROM staff_employees WHERE user_id=17").get() as { n: number }).n,
        lab_certificates: (sqlite.prepare("SELECT COUNT(*) as n FROM lab_certificates WHERE user_id=17").get() as { n: number }).n,
        veritamap_maps: (sqlite.prepare("SELECT COUNT(*) as n FROM veritamap_maps WHERE user_id=17").get() as { n: number }).n,
        veritascan_assessed: (sqlite.prepare("SELECT COUNT(*) as n FROM veritascan_items WHERE scan_id=4 AND status != 'Not Assessed'").get() as { n: number }).n,
      };
      sqlite.exec(sql);
      const after = {
        staff_employees: (sqlite.prepare("SELECT COUNT(*) as n FROM staff_employees WHERE user_id=17").get() as { n: number }).n,
        lab_certificates: (sqlite.prepare("SELECT COUNT(*) as n FROM lab_certificates WHERE user_id=17").get() as { n: number }).n,
        veritamap_maps: (sqlite.prepare("SELECT COUNT(*) as n FROM veritamap_maps WHERE user_id=17").get() as { n: number }).n,
        veritamap_instruments: (sqlite.prepare("SELECT COUNT(*) as n FROM veritamap_instruments WHERE map_id IN (SELECT id FROM veritamap_maps WHERE user_id=17)").get() as { n: number }).n,
        veritamap_tests: (sqlite.prepare("SELECT COUNT(*) as n FROM veritamap_tests WHERE map_id IN (SELECT id FROM veritamap_maps WHERE user_id=17)").get() as { n: number }).n,
        pt_enrollments_v2: (sqlite.prepare("SELECT COUNT(*) as n FROM pt_enrollments_v2 WHERE user_id=17").get() as { n: number }).n,
        pt_events: (sqlite.prepare("SELECT COUNT(*) as n FROM pt_events WHERE user_id=17").get() as { n: number }).n,
        pt_corrective_actions: (sqlite.prepare("SELECT COUNT(*) as n FROM pt_corrective_actions WHERE user_id=17").get() as { n: number }).n,
        inventory_items: (sqlite.prepare("SELECT COUNT(*) as n FROM inventory_items WHERE account_id=17").get() as { n: number }).n,
        veritapolicy_lab_policies: (sqlite.prepare("SELECT COUNT(*) as n FROM veritapolicy_lab_policies WHERE user_id=17").get() as { n: number }).n,
        veritapolicy_requirement_status: (sqlite.prepare("SELECT COUNT(*) as n FROM veritapolicy_requirement_status WHERE user_id=17").get() as { n: number }).n,
        veritascan_assessed: (sqlite.prepare("SELECT COUNT(*) as n FROM veritascan_items WHERE scan_id=4 AND status != 'Not Assessed'").get() as { n: number }).n,
      };
      console.log('[seed-michaels-lab] before:', before, 'after:', after);
      res.json({ ok: true, before, after, sql_bytes: sql.length });
    } catch (err: any) {
      console.error('[seed-michaels-lab] Error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── ADMIN: Wipe seeded demo data (rolls back POST /seed-michaels-lab) ──
  // All DELETEs use parameterized userId binding for safety; userId comes from
  // the URL search param so the hook can verify dynamic binding.
  app.delete("/api/admin/seed-michaels-lab", (req, res) => {
    const secret = (req.query.secret as string || req.headers["x-admin-secret"] as string);
    if (secret !== ADMIN_SECRET) return res.status(403).json({ error: "forbidden" });
    try {
      const sqlite = (db as any).$client;
      const TAG = '[SEED-2026-05-03]';
      // userId is a query parameter, defaulting to Michael's user id
      const userId = parseInt((req.query.userId as string) || "17", 10);
      if (!Number.isInteger(userId) || userId <= 0) {
        return res.status(400).json({ error: "invalid_userId" });
      }
      const tx = sqlite.transaction(() => {
        const out: Record<string, number> = {};
        out.staff_employees = sqlite.prepare("DELETE FROM staff_employees WHERE user_id = ? AND qualifications_text LIKE ?").run(userId, `%${TAG}%`).changes;
        out.staff_labs = sqlite.prepare("DELETE FROM staff_labs WHERE user_id = ?").run(userId).changes;
        out.competency_employees = sqlite.prepare("DELETE FROM competency_employees WHERE user_id = ?").run(userId).changes;
        out.competency_programs = sqlite.prepare("DELETE FROM competency_programs WHERE user_id = ?").run(userId).changes;
        out.lab_certificates = sqlite.prepare("DELETE FROM lab_certificates WHERE user_id = ? AND notes = ?").run(userId, TAG).changes;
        out.veritapolicy_lab_policies = sqlite.prepare("DELETE FROM veritapolicy_lab_policies WHERE user_id = ? AND notes = ?").run(userId, TAG).changes;
        out.veritapolicy_requirement_status = sqlite.prepare("DELETE FROM veritapolicy_requirement_status WHERE user_id = ? AND notes = ?").run(userId, TAG).changes;
        out.pt_corrective_actions = sqlite.prepare("DELETE FROM pt_corrective_actions WHERE user_id = ?").run(userId).changes;
        out.pt_events = sqlite.prepare("DELETE FROM pt_events WHERE user_id = ? AND notes = ?").run(userId, TAG).changes;
        out.pt_enrollments_v2 = sqlite.prepare("DELETE FROM pt_enrollments_v2 WHERE user_id = ?").run(userId).changes;
        out.inventory_items = sqlite.prepare("DELETE FROM inventory_items WHERE account_id = ? AND notes LIKE ?").run(userId, `%${TAG}%`).changes;
        out.cumsum_trackers = sqlite.prepare("DELETE FROM cumsum_trackers WHERE user_id = ?").run(userId).changes;
        out.veritamap_tests = sqlite.prepare("DELETE FROM veritamap_tests WHERE notes = ?").run(TAG).changes;
        // Delete instruments + maps for the new seeded maps only (scoped by userId + map name).
        const seededMaps = sqlite.prepare("SELECT id FROM veritamap_maps WHERE user_id = ? AND name IN ('Beckman AU480 Chemistry','Siemens DCA Vantage POC')").all(userId) as Array<{ id: number }>;
        out.veritamap_instruments = 0;
        for (const m of seededMaps) {
          out.veritamap_instruments += sqlite.prepare("DELETE FROM veritamap_instruments WHERE map_id = ?").run(m.id).changes;
        }
        out.veritamap_maps = sqlite.prepare("DELETE FROM veritamap_maps WHERE user_id = ? AND name IN ('Beckman AU480 Chemistry','Siemens DCA Vantage POC')").run(userId).changes;
        // Reset scan_id=4 items that we filled. Caveat: we can't perfectly
        // reverse this without the pre-seed snapshot, so we reset every
        // assessed item in scan #4 back to Not Assessed. Capture before/after.
        out.veritascan_items_reset = sqlite.prepare("UPDATE veritascan_items SET status='Not Assessed' WHERE scan_id=4 AND status != 'Not Assessed'").run().changes;
        return out;
      });
      const result = tx();
      console.log('[seed-michaels-lab DELETE] result:', result);
      res.json({ ok: true, deleted: result });
    } catch (err: any) {
      console.error('[seed-michaels-lab DELETE] Error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── VeritaPolicy Routes ──────────────────────────────────────────────────
  const { TJC_REQUIREMENTS } = await import('./tjcRequirements');
  const { CAP_REQUIREMENTS } = await import('./capRequirements');
  const { CFR_REQUIREMENTS } = await import('./cfrRequirements');
  const { AABB_REQUIREMENTS } = await import('./aabbRequirements');
  const { COLA_REQUIREMENTS } = await import('./colaRequirements');

  // Phase 2 (2026-05-02): build the requirement set for a given lab from the
  // four accreditation flags. CFR is appended for every lab regardless of
  // accreditor selection (CLIA binds every lab). AABB and COLA now live and
  // dispatch to their generated requirement files (gen_requirements_from_xlsx.py).
  function veritapolicyReqSetsForLab(lab: any): any[] {
    const reqSets: any[] = [];
    if (lab?.accreditation_tjc)  reqSets.push(...(TJC_REQUIREMENTS as unknown as any[]).map((r: any) => ({ ...r, source: 'tjc' })));
    if (lab?.accreditation_cap)  reqSets.push(...(CAP_REQUIREMENTS as unknown as any[]).map((r: any) => ({ ...r, source: 'cap' })));
    if (lab?.accreditation_aabb) reqSets.push(...(AABB_REQUIREMENTS as unknown as any[]).map((r: any) => ({ ...r, source: 'aabb' })));
    if (lab?.accreditation_cola) reqSets.push(...(COLA_REQUIREMENTS as unknown as any[]).map((r: any) => ({ ...r, source: 'cola' })));
    // CFR appended for every lab.
    reqSets.push(...(CFR_REQUIREMENTS as unknown as any[]).map((r: any) => ({ ...r, source: 'cfr' })));
    return reqSets;
  }

  // GET settings
  // Phase 1 (2026-05-01): also returns accreditation_choice derived from labs
  // table flags. The legacy accreditation_body column is left in place but
  // no longer authoritative. Six choices: TJC, CAP, AABB, COLA, CAP+AABB, CLIA.
  app.get('/api/veritapolicy/settings', authMiddleware, (req: any, res) => {
    const sqlite = db.$client;
    const userId = req.userId;
    let settings = sqlite.prepare('SELECT * FROM veritapolicy_settings WHERE user_id = ?').get(userId) as any;
    if (!settings) {
      sqlite.prepare(`INSERT INTO veritapolicy_settings (user_id) VALUES (?)`).run(userId);
      settings = sqlite.prepare('SELECT * FROM veritapolicy_settings WHERE user_id = ?').get(userId);
    }
    const lab = resolveLabForUser(userId);
    const accCount = (lab?.accreditation_cap ? 1 : 0) + (lab?.accreditation_tjc ? 1 : 0)
      + (lab?.accreditation_cola ? 1 : 0) + (lab?.accreditation_aabb ? 1 : 0);
    let accreditationChoice = 'CLIA';
    if (accCount === 1 && lab?.accreditation_tjc) accreditationChoice = 'TJC';
    else if (accCount === 1 && lab?.accreditation_cap) accreditationChoice = 'CAP';
    else if (accCount === 1 && lab?.accreditation_aabb) accreditationChoice = 'AABB';
    else if (accCount === 1 && lab?.accreditation_cola) accreditationChoice = 'COLA';
    else if (accCount === 2 && lab?.accreditation_cap && lab?.accreditation_aabb) accreditationChoice = 'CAP+AABB';
    res.json({ ...settings, accreditation_choice: accreditationChoice });
  });

  // PUT settings (lab type + accreditation body)
  // Deprecated columns (has_blood_bank, has_transplant, has_microbiology, has_maternal_serum, waived_only)
  // are retained in the schema but no longer written; they keep their existing or default values.
  app.put('/api/veritapolicy/settings', authMiddleware, requireWriteAccess, (req: any, res) => {
    const sqlite = db.$client;
    const userId = req.userId;
    const { is_independent, setup_complete, accreditation_body } = req.body;
    sqlite.prepare(`
      INSERT INTO veritapolicy_settings (user_id, is_independent, setup_complete, accreditation_body, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET
        is_independent = excluded.is_independent,
        setup_complete = excluded.setup_complete,
        accreditation_body = excluded.accreditation_body,
        updated_at = excluded.updated_at
    `).run(userId, is_independent?1:0, setup_complete?1:0, accreditation_body || 'tjc');
    res.json({ ok: true });
  });

  // GET requirements with user status overlay
  app.get('/api/veritapolicy/requirements', authMiddleware, (req: any, res) => {
    const sqlite = db.$client;
    const userId = req.userId;
    // Get all user requirement statuses
    const statuses = sqlite.prepare('SELECT * FROM veritapolicy_requirement_status WHERE user_id = ?').all(userId) as any[];
    const statusMap: Record<number, any> = {};
    for (const s of statuses) statusMap[s.requirement_id] = s;
    // Get settings for applicability
    const settings = sqlite.prepare('SELECT * FROM veritapolicy_settings WHERE user_id = ?').get(userId) as any;
    // Get lab policies for mapping display
    const policies = sqlite.prepare('SELECT id, policy_number, policy_name FROM veritapolicy_lab_policies WHERE user_id = ? ORDER BY policy_name').all(userId) as any[];
    const policyMap: Record<number, any> = {};
    for (const p of policies) policyMap[p.id] = p;
    // Phase 1 (2026-05-01): source of truth for accreditation is the labs
    // table, not veritapolicy_settings.accreditation_body. The latter is
    // retained but no longer drives content selection.
    const lab = resolveLabForUser(userId);
    const reqSets = veritapolicyReqSetsForLab(lab);

    // Build response
    const result = reqSets.map((req: any) => {
      const userStatus = statusMap[req.id];
      // Determine if applicable based on settings
      // Service-line toggles (blood_bank, transplant, microbiology, maternal_serum) removed;
      // users now mark those N/A individually. Only structural flag (is_independent) remains.
      let autoNa = false;
      if (settings) {
        if (req.service_line === 'independent' && !settings.is_independent) autoNa = true;
      }
      const isNa = autoNa || (userStatus?.is_na ? true : false);
      const status = isNa ? 'na' : (userStatus?.status || 'not_started');
      const linkedPolicy = userStatus?.lab_policy_id ? policyMap[userStatus.lab_policy_id] : null;
      return {
        ...req,
        status,
        is_na: isNa,
        auto_na: autoNa,
        na_reason: userStatus?.na_reason || null,
        lab_policy_id: userStatus?.lab_policy_id || null,
        lab_policy: linkedPolicy,
        policy_name: userStatus?.policy_name || null,
        notes: userStatus?.notes || null,
        updated_at: userStatus?.updated_at || null,
      };
    });
    res.json(result);
  });

  // PATCH requirement status
  app.patch('/api/veritapolicy/requirements/:id', authMiddleware, requireWriteAccess, (req: any, res) => {
    const sqlite = db.$client;
    const userId = req.userId;
    const reqId = parseInt(req.params.id);
    const { status, is_na, na_reason, lab_policy_id, policy_name, notes } = req.body;
    sqlite.prepare(`
      INSERT INTO veritapolicy_requirement_status (user_id, requirement_id, status, is_na, na_reason, lab_policy_id, policy_name, notes, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id, requirement_id) DO UPDATE SET
        status = COALESCE(excluded.status, status),
        is_na = COALESCE(excluded.is_na, is_na),
        na_reason = COALESCE(excluded.na_reason, na_reason),
        lab_policy_id = excluded.lab_policy_id,
        policy_name = excluded.policy_name,
        notes = COALESCE(excluded.notes, notes),
        updated_at = excluded.updated_at
    `).run(userId, reqId, status || 'not_started', is_na ? 1 : 0, na_reason || null, lab_policy_id || null, policy_name || null, notes || null);
    res.json({ ok: true });
  });

  // GET lab policies
  app.get('/api/veritapolicy/policies', authMiddleware, (req: any, res) => {
    const sqlite = db.$client;
    const policies = sqlite.prepare('SELECT * FROM veritapolicy_lab_policies WHERE user_id = ? ORDER BY policy_name').all(req.userId) as any[];
    // For each policy, count how many requirements it covers
    const counts = sqlite.prepare('SELECT lab_policy_id, COUNT(*) as count FROM veritapolicy_requirement_status WHERE user_id = ? AND lab_policy_id IS NOT NULL GROUP BY lab_policy_id').all(req.userId) as any[];
    const countMap: Record<number, number> = {};
    for (const c of counts) countMap[c.lab_policy_id] = c.count;
    res.json(policies.map((p: any) => ({ ...p, requirements_covered: countMap[p.id] || 0 })));
  });

  // POST lab policy
  app.post('/api/veritapolicy/policies', authMiddleware, requireWriteAccess, (req: any, res) => {
    const sqlite = db.$client;
    const { policy_number, policy_name, owner, status, last_reviewed, next_review, notes } = req.body;
    if (!policy_name) return res.status(400).json({ error: 'policy_name required' });
    const result = sqlite.prepare(`
      INSERT INTO veritapolicy_lab_policies (user_id, policy_number, policy_name, owner, status, last_reviewed, next_review, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.userId, policy_number || null, policy_name, owner || null, status || 'not_started', last_reviewed || null, next_review || null, notes || null) as any;
    res.json({ ok: true, id: result.lastInsertRowid });
  });

  // PUT lab policy
  app.put('/api/veritapolicy/policies/:id', authMiddleware, requireWriteAccess, (req: any, res) => {
    const sqlite = db.$client;
    const userId = req.userId;
    const { policy_number, policy_name, owner, status, last_reviewed, next_review, notes } = req.body;
    sqlite.prepare(`
      UPDATE veritapolicy_lab_policies SET
        policy_number = ?, policy_name = ?, owner = ?, status = ?,
        last_reviewed = ?, next_review = ?, notes = ?, updated_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `).run(policy_number || null, policy_name, owner || null, status || 'not_started', last_reviewed || null, next_review || null, notes || null, parseInt(req.params.id), userId);
    res.json({ ok: true });
  });

  // DELETE lab policy
  app.delete('/api/veritapolicy/policies/:id', authMiddleware, requireWriteAccess, (req: any, res) => {
    const sqlite = db.$client;
    const userId = req.userId;
    const policyId = parseInt(req.params.id);
    // Unlink from requirements
    sqlite.prepare('UPDATE veritapolicy_requirement_status SET lab_policy_id = NULL WHERE user_id = ? AND lab_policy_id = ?').run(userId, policyId);
    sqlite.prepare('DELETE FROM veritapolicy_lab_policies WHERE id = ? AND user_id = ?').run(policyId, userId);
    res.json({ ok: true });
  });

  // POST document upload for a policy
  app.post('/api/veritapolicy/policies/:id/upload', authMiddleware, requireWriteAccess, async (req: any, res) => {
    try {
      const sqlite = db.$client;
      const userId = req.userId;
      const policyId = parseInt(req.params.id);
      const policy = sqlite.prepare('SELECT * FROM veritapolicy_lab_policies WHERE id = ? AND user_id = ?').get(policyId, userId) as any;
      if (!policy) return res.status(404).json({ error: 'Policy not found' });
      const data = await req.file();
      if (!data) return res.status(400).json({ error: 'No file' });
      const buf = await data.toBuffer();
      const ext = path.extname(data.filename) || '.pdf';
      const fname = `policy_${userId}_${policyId}_${Date.now()}${ext}`;
      const uploadDir = path.join(process.cwd(), 'uploads', 'policies');
      await fs.promises.mkdir(uploadDir, { recursive: true });
      await fs.promises.writeFile(path.join(uploadDir, fname), buf);
      sqlite.prepare('UPDATE veritapolicy_lab_policies SET document_name = ?, document_path = ?, updated_at = datetime(\'now\') WHERE id = ? AND user_id = ?')
        .run(data.filename, fname, policyId, userId);
      res.json({ ok: true, document_name: data.filename, document_path: fname });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET readiness summary
  app.get('/api/veritapolicy/summary', authMiddleware, (req: any, res) => {
    const sqlite = db.$client;
    const userId = req.userId;
    const settings = sqlite.prepare('SELECT * FROM veritapolicy_settings WHERE user_id = ?').get(userId) as any;
    const statuses = sqlite.prepare('SELECT * FROM veritapolicy_requirement_status WHERE user_id = ?').all(userId) as any[];
    const statusMap: Record<number, any> = {};
    for (const s of statuses) statusMap[s.requirement_id] = s;
    // Phase 1 (2026-05-01): source the accreditor set from labs flags via the
    // shared helper. CFR is included for every lab.
    const lab = resolveLabForUser(userId);
    const summaryReqs = veritapolicyReqSetsForLab(lab);
    let total = 0, complete = 0, inProgress = 0, notStarted = 0, na = 0;
    for (const req of summaryReqs) {
      // Service-line toggles (blood_bank, transplant, microbiology, maternal_serum) removed;
      // users now mark those N/A individually. Only structural flag (is_independent) remains.
      let autoNa = false;
      if (settings) {
        if (req.service_line === 'independent' && !settings.is_independent) autoNa = true;
      }
      const userStatus = statusMap[req.id];
      const isNa = autoNa || (userStatus?.is_na ? true : false);
      if (isNa) { na++; continue; }
      total++;
      const s = userStatus?.status || 'not_started';
      if (s === 'complete') complete++;
      else if (s === 'in_progress') inProgress++;
      else notStarted++;
    }
    const score = total > 0 ? Math.round((complete / total) * 100) : 0;
    res.json({ total, complete, in_progress: inProgress, not_started: notStarted, na, score, setup_complete: settings?.setup_complete || 0 });
  });

  // POST PDF report
  app.post('/api/veritapolicy/pdf', authMiddleware, async (req: any, res) => {
    try {
      const sqlite = db.$client;
      const userId = req.userId;
      const user = sqlite.prepare('SELECT * FROM users WHERE id = ?').get(userId) as any;
      const settings = sqlite.prepare('SELECT * FROM veritapolicy_settings WHERE user_id = ?').get(userId) as any;
      const statuses = sqlite.prepare('SELECT * FROM veritapolicy_requirement_status WHERE user_id = ?').all(userId) as any[];
      const statusMap: Record<number, any> = {};
      for (const s of statuses) statusMap[s.requirement_id] = s;
      // Phase 1 (2026-05-01): source from labs flags via shared helper.
      // CFR included for every lab regardless of accreditor selection.
      const lab = resolveLabForUser(userId);
      const allReqs = veritapolicyReqSetsForLab(lab);
      const enrichedReqs = allReqs.map((reqItem: any) => {
        const us = statusMap[reqItem.id];
        // Service-line toggles (blood_bank, transplant, microbiology, maternal_serum) removed;
        // users now mark those N/A individually. Only structural flag (is_independent) remains.
        let autoNa = false;
        if (settings) {
          if (reqItem.service_line === 'independent' && !settings.is_independent) autoNa = true;
        }
        const isNa = autoNa || (us?.is_na ? true : false);
        return {
          ...reqItem,
          status: isNa ? 'na' : (us?.status || 'not_started'),
          is_na: isNa,
          auto_na: autoNa,
          policy_name: us?.policy_name || null,
        };
      });
      // Phase 1 (2026-05-01): derive accreditation choice from labs flags so the
      // PDF subtitle matches what the user sees in the app. CFR is appended for
      // every lab regardless of choice.
      const accCountPdf = (lab?.accreditation_cap ? 1 : 0) + (lab?.accreditation_tjc ? 1 : 0)
        + (lab?.accreditation_cola ? 1 : 0) + (lab?.accreditation_aabb ? 1 : 0);
      let accreditationChoicePdf = 'CLIA';
      if (accCountPdf === 1 && lab?.accreditation_tjc) accreditationChoicePdf = 'TJC';
      else if (accCountPdf === 1 && lab?.accreditation_cap) accreditationChoicePdf = 'CAP';
      else if (accCountPdf === 1 && lab?.accreditation_aabb) accreditationChoicePdf = 'AABB';
      else if (accCountPdf === 1 && lab?.accreditation_cola) accreditationChoicePdf = 'COLA';
      else if (accCountPdf === 2 && lab?.accreditation_cap && lab?.accreditation_aabb) accreditationChoicePdf = 'CAP+AABB';
      const { generateVeritaPolicyPDF } = await import('./pdfReport');
      const pdfBuf = await generateVeritaPolicyPDF({ user, settings, requirements: enrichedReqs, statusMap, policyMap: {}, policies: [], accreditationBody: accreditationChoicePdf });
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="VeritaPolicy-Report.pdf"' });
      res.send(pdfBuf);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // VeritaTrack routes
  const { registerVeritaTrackRoutes } = await import('./veritatrack');
  registerVeritaTrackRoutes(app, authMiddleware, requireWriteAccess, requireModuleEdit);

  const { registerVeritaCheckVerificationRoutes } = await import('./veritacheck_verification');
  registerVeritaCheckVerificationRoutes(app, authMiddleware, requireWriteAccess);

  // VeritaBench routes (Productivity Tracker + Staffing Analyzer)
  const { registerVeritaBenchRoutes } = await import('./veritabench');
  registerVeritaBenchRoutes(app, authMiddleware, requireWriteAccess, requireModuleEdit);

  console.log('[routes] All routes registered successfully (176 routes)');
  return httpServer;
}
