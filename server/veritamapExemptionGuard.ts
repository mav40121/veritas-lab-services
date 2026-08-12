// server/veritamapExemptionGuard.ts
//
// Standing guard against a linearity/cal-ver EXEMPTION WIPE. The four
// linearity_exempt_* columns live on veritamap_instrument_tests; if they get
// cleared, every affected combo silently flips to "Cal Ver / Linearity
// required" and the lab's coverage view is wrong until someone notices. That
// happened to San Carlos on 2026-07-31 and again on 2026-08-01 and was not
// caught for 11 days. The build-wizard save path that dropped them is fixed
// (captureInstrumentExemptions/restoreInstrumentExemptions in routes.ts); this
// is the belt-and-suspenders: if ANY future path ever wipes exemptions, the
// nightly run emails info@ the next morning instead of a client finding it.
//
// Method: compare each user's two most recent nightly snapshots (which capture
// veritamap_instrument_tests with the exempt columns) and flag any map whose
// count of ACTIVE exempt combos fell by >= DROP_FRACTION from a baseline of at
// least MIN_BASELINE. A legit edit (removing one exempt instrument) stays well
// under the threshold; a wipe (242 -> 0) trips it loudly. Read-only.
//
// Scheduled nightly in server/index.ts (after the 04:00 snapshot and 04:30
// consistency check) and available on demand via
// GET /api/admin/veritamap/exemption-drop-audit.

// A map must have had at least this many active exemptions in the prior
// snapshot for a drop to matter (ignore maps that barely use exemptions).
const MIN_BASELINE = 5;
// Flag when the count fell by at least this fraction of the baseline.
const DROP_FRACTION = 0.5;

export interface ExemptionDrop {
  userId: number;
  mapId: number;
  mapName: string;
  prevExempt: number;
  curExempt: number;
  dropPct: number;
  prevDate: string;
  curDate: string;
}

export interface ExemptionGuardResult {
  ok: boolean;
  checkedUsers: number;
  comparedMaps: number;
  drops: ExemptionDrop[];
}

// Count ACTIVE exempt combos per map in one parsed snapshot payload. Mirrors the
// coverage definition of "exempt" (any of the four flags set) and only counts
// active rows, matching /api/admin/restore-linearity-exemptions.
function activeExemptByMap(data: any): Map<number, number> {
  const instToMap = new Map<number, number>();
  for (const i of data?.instruments || []) instToMap.set(i.id, i.map_id);
  const counts = new Map<number, number>();
  for (const t of data?.instrument_tests || []) {
    if (!(t.active === 1 || t.active == null)) continue;
    const exempt = t.linearity_exempt_multical || t.linearity_exempt_noncal || t.linearity_exempt_waived || (t.linearity_exempt_other || "").trim();
    if (!exempt) continue;
    const mapId = instToMap.get(t.instrument_id);
    if (mapId == null) continue;
    counts.set(mapId, (counts.get(mapId) || 0) + 1);
  }
  return counts;
}

// Read-only. Compares the two most recent snapshots per user and returns maps
// whose active-exemption count dropped past the threshold.
export function auditExemptionDrops(sqlite: any): ExemptionGuardResult {
  const users = sqlite.prepare("SELECT DISTINCT user_id FROM nightly_snapshots").all() as Array<{ user_id: number }>;
  const drops: ExemptionDrop[] = [];
  let comparedMaps = 0;
  const twoLatest = sqlite.prepare("SELECT snapshot_date, modules_json FROM nightly_snapshots WHERE user_id = ? ORDER BY snapshot_date DESC, id DESC LIMIT 2");

  for (const { user_id } of users) {
    const snaps = twoLatest.all(user_id) as Array<{ snapshot_date: string; modules_json: string }>;
    if (snaps.length < 2) continue;
    let latest: any, prev: any;
    try { latest = JSON.parse(snaps[0].modules_json); prev = JSON.parse(snaps[1].modules_json); } catch { continue; }

    const latestMapIds = new Set<number>((latest?.maps || []).map((m: any) => m.id));
    const curCounts = activeExemptByMap(latest);
    const prevCounts = activeExemptByMap(prev);

    for (const [mapId, prevExempt] of prevCounts) {
      if (!latestMapIds.has(mapId)) continue; // map deleted since -> not a wipe
      comparedMaps++;
      const curExempt = curCounts.get(mapId) || 0;
      if (prevExempt >= MIN_BASELINE && curExempt <= prevExempt * (1 - DROP_FRACTION)) {
        const mapName = (latest?.maps || []).find((m: any) => m.id === mapId)?.name || "";
        drops.push({
          userId: user_id, mapId, mapName, prevExempt, curExempt,
          dropPct: Math.round((1 - curExempt / prevExempt) * 100),
          prevDate: snaps[1].snapshot_date, curDate: snaps[0].snapshot_date,
        });
      }
    }
  }

  drops.sort((a, b) => b.dropPct - a.dropPct || b.prevExempt - a.prevExempt);
  return { ok: drops.length === 0, checkedUsers: users.length, comparedMaps, drops };
}

// Nightly entrypoint (scheduled in server/index.ts). Emails info@ on any drop.
export async function runNightlyExemptionGuard(): Promise<void> {
  const { db } = await import("./db");
  const result = auditExemptionDrops((db as any).$client);
  if (result.ok) {
    console.log(`[exemption-guard] OK: ${result.checkedUsers} users, ${result.comparedMaps} maps compared, 0 drops`);
    return;
  }
  console.error(`[exemption-guard] DROP DETECTED: ${result.drops.length} map(s)`, JSON.stringify(result.drops).slice(0, 2000));
  if (!process.env.RESEND_API_KEY) return;
  try {
    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);
    const tableRows = result.drops.slice(0, 100).map((d) =>
      `<tr><td style="padding:4px 8px">lab-owner user ${d.userId}</td><td style="padding:4px 8px">map ${d.mapId} (${d.mapName})</td><td style="padding:4px 8px;color:#A12C7B;font-weight:bold">${d.prevExempt} -> ${d.curExempt} (-${d.dropPct}%)</td><td style="padding:4px 8px">${d.prevDate} -> ${d.curDate}</td></tr>`
    ).join("");
    await resend.emails.send({
      from: "VeritaAssure System <info@veritaslabservices.com>",
      to: "info@veritaslabservices.com",
      subject: `[VeritaAssure] Linearity-exemption DROP: ${result.drops.length} map(s)`,
      html: `<p>The nightly guard found <strong>${result.drops.length}</strong> VeritaMap(s) whose count of active linearity/cal-ver exemptions fell sharply between the last two nightly snapshots. A drop like this usually means the exemption flags were wiped (as on San Carlos 2026-07-31 and 2026-08-01), which makes those combos read "Cal Ver / Linearity required" in the coverage view.</p>
             <p>Recover with a dry-run then apply of <code>POST /api/admin/restore-linearity-exemptions {labId, snapshotId, dryRun}</code> using a snapshot from before the drop. If the drop was intentional, ignore.</p>
             <table style="border-collapse:collapse;font-size:12px"><thead><tr><th style="padding:4px 8px;text-align:left">Owner</th><th style="padding:4px 8px;text-align:left">Map</th><th style="padding:4px 8px;text-align:left">Active exemptions</th><th style="padding:4px 8px;text-align:left">Snapshots compared</th></tr></thead><tbody>${tableRows}</tbody></table>`,
    });
    console.log("[exemption-guard] drop alert emailed to info@veritaslabservices.com");
  } catch (e: any) {
    console.error("[exemption-guard] alert email failed:", e?.message || e);
  }
}
