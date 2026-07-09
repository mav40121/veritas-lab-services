import { Link } from "wouter";
import { useSEO } from "@/hooks/useSEO";

// VeritaQC™ Phase 1 demo. Unauthenticated walkthrough that mirrors what a
// logged-in user sees on /veritaqc-app and /veritaqc-app/review, using a
// hardcoded fixture (Riverside Regional, Estradiol Lot DEMO-2026-04). 90
// days of QC, one 1-2s warning, one 1-3s rejection with corrective action
// filed, one accepted monthly review.

const TEAL = "#01696F";
const GREEN_OK = "#16a34a";
const AMBER_WARN = "#d97706";
const RED_REJECT = "#dc2626";

// ── Fixture: 90 days of Estradiol QC ────────────────────────────────────
// mfr_mean=237, mfr_sd=35.5, sd_interval=2. Lab cumulative mean and SD
// computed from the in-bench data; values chosen so the LJ visual shows
// one 1-2s warning, one 1-3s rejection with CA, the rest in-control.

const LOT = {
  analyte: "Estradiol",
  lot_number: "DEMO-2026-04",
  level: "mid",
  manufacturer: "Bio-Rad Liquichek Immunoassay Plus",
  mfr_mean: 237,
  mfr_sd: 35.5,
  mfr_sd_interval: 2,
};

// Pre-computed lab cumulative baseline from 90 days of accepted runs
const BASELINE_MEAN = 232.4;
const BASELINE_SD = 8.7;

interface RunRow {
  date: string;
  value: number;
  rule?: { code: string; severity: "warning" | "rejection"; detail: string };
  ca?: { action_taken: string; status: string };
  accepted: boolean;
}

const RUNS: RunRow[] = [
  // Most recent first (last 14 shown in table)
  { date: "2026-04-30", value: 235, accepted: true },
  { date: "2026-04-29", value: 228, accepted: true },
  { date: "2026-04-28", value: 240, accepted: true },
  { date: "2026-04-25", value: 234, accepted: true },
  { date: "2026-04-24", value: 231, accepted: true },
  { date: "2026-04-23", value: 237, accepted: true },
  {
    date: "2026-04-22", value: 261,
    rule: { code: "1-3s", severity: "rejection", detail: "|SDI|=3.29 > 3" },
    ca: { action_taken: "Recalibrated and reran control. Result returned in range. Reagent lot checked, no degradation observed. Excluded from baseline.", status: "closed" },
    accepted: false,
  },
  { date: "2026-04-19", value: 230, accepted: true },
  { date: "2026-04-18", value: 233, accepted: true },
  { date: "2026-04-17", value: 229, accepted: true },
  {
    date: "2026-04-16", value: 252,
    rule: { code: "1-2s", severity: "warning", detail: "|SDI|=2.25 > 2" },
    accepted: true,
  },
  { date: "2026-04-15", value: 234, accepted: true },
  { date: "2026-04-12", value: 236, accepted: true },
  { date: "2026-04-11", value: 232, accepted: true },
];

// 90 SDIs for the LJ chart, including the 14 above plus 76 earlier in-control
// runs synthesized for the visual.
function buildSDIs(): { date: string; sdi: number; severity: "ok" | "warning" | "rejection" }[] {
  const synth: { date: string; sdi: number; severity: "ok" | "warning" | "rejection" }[] = [];
  // 76 earlier in-control runs, oldest first
  for (let i = 76; i >= 1; i--) {
    const d = new Date(2026, 3, 11);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    // Slight noise around baseline mean
    const noise = (Math.sin(i * 1.7) + Math.cos(i * 0.9)) * 0.7;
    const value = BASELINE_MEAN + noise * BASELINE_SD * 0.55;
    const sdi = (value - BASELINE_MEAN) / BASELINE_SD;
    synth.push({ date: dateStr, sdi, severity: "ok" });
  }
  // Recent 14 (chronological)
  const recentChrono = [...RUNS].reverse();
  for (const r of recentChrono) {
    const sdi = (r.value - BASELINE_MEAN) / BASELINE_SD;
    const severity: "ok" | "warning" | "rejection" =
      r.rule?.severity === "rejection" ? "rejection" :
      r.rule?.severity === "warning" ? "warning" : "ok";
    synth.push({ date: r.date, sdi, severity });
  }
  return synth;
}

const SDIS = buildSDIs();

// ── Levey-Jennings SVG ──────────────────────────────────────────────────
function LJChart() {
  const W = 760, H = 240, PL = 44, PR = 12, PT = 14, PB = 28;
  const innerW = W - PL - PR, innerH = H - PT - PB;
  const sdMin = -4, sdMax = 4;
  const yFor = (sdi: number) => PT + innerH * (1 - (sdi - sdMin) / (sdMax - sdMin));
  const xFor = (i: number) => PL + (SDIS.length === 1 ? innerW / 2 : (innerW * i) / (SDIS.length - 1));

  const bands = [
    { y1: -4, y2: -3, fill: "#fde2e2" },
    { y1: -3, y2: -2, fill: "#fef2cc" },
    { y1: -2, y2: 2, fill: "#e3f2e1" },
    { y1: 2, y2: 3, fill: "#fef2cc" },
    { y1: 3, y2: 4, fill: "#fde2e2" },
  ];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }} xmlns="http://www.w3.org/2000/svg">
      {bands.map((b, i) => (
        <rect key={i} x={PL} y={yFor(b.y2)} width={innerW} height={yFor(b.y1) - yFor(b.y2)} fill={b.fill} />
      ))}
      {[-3, -2, -1, 0, 1, 2, 3].map((sdi) => {
        const y = yFor(sdi);
        const stroke = sdi === 0 ? TEAL : "#a0a0a0";
        const sw = sdi === 0 ? 1.4 : 0.6;
        const dash = sdi === 0 ? undefined : "2,2";
        return (
          <g key={sdi}>
            <line x1={PL} y1={y} x2={PL + innerW} y2={y} stroke={stroke} strokeWidth={sw} strokeDasharray={dash} />
            <text x={PL - 6} y={y + 3} fontSize={9} fill="#555" textAnchor="end">
              {sdi > 0 ? `+${sdi}` : sdi}
            </text>
          </g>
        );
      })}
      <polyline
        points={SDIS.map((p, i) => `${xFor(i)},${yFor(p.sdi)}`).join(" ")}
        fill="none" stroke="#1a1a1a" strokeWidth={0.7}
      />
      {SDIS.map((p, i) => {
        const color =
          p.severity === "rejection" ? RED_REJECT :
          p.severity === "warning" ? AMBER_WARN :
          Math.abs(p.sdi) > 3 ? RED_REJECT :
          Math.abs(p.sdi) > 2 ? AMBER_WARN : GREEN_OK;
        return (
          <circle key={i} cx={xFor(i)} cy={yFor(p.sdi)} r={p.severity === "ok" ? 2.2 : 3.6}
            fill={color} stroke="#fff" strokeWidth={0.7}>
            <title>{p.date}: SDI {p.sdi.toFixed(2)}</title>
          </circle>
        );
      })}
      <text x={PL + innerW / 2} y={H - 8} fontSize={9} fill="#555" textAnchor="middle">
        Run sequence (oldest left to newest right, n=90)
      </text>
      <text x={12} y={PT + innerH / 2} fontSize={9} fill="#555" textAnchor="middle"
        transform={`rotate(-90,12,${PT + innerH / 2})`}>
        SDI from baseline mean
      </text>
    </svg>
  );
}

function severityChip(severity: "warning" | "rejection") {
  const bg = severity === "rejection" ? "#fde2e2" : "#fef2cc";
  const fg = severity === "rejection" ? RED_REJECT : AMBER_WARN;
  return { background: bg, color: fg, padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700 };
}

export default function DemoQcPage() {
  useSEO({
    title: "VeritaQC™ Demo: Westgard QC + Monthly Attestation",
    description:
      "Live walkthrough of VeritaQC: daily QC entry, Westgard rule evaluation, corrective action capture, and monthly review attestation. Phase 1 preview.",
  });

  const totalRej = RUNS.filter(r => r.rule?.severity === "rejection").length;
  const totalWarn = RUNS.filter(r => r.rule?.severity === "warning").length;
  const missingCA = RUNS.filter(r => r.rule?.severity === "rejection" && !r.ca).length;

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafb" }}>
      {/* Hero */}
      <div style={{ background: `linear-gradient(135deg, ${GREEN_OK} 0%, #128a3e 100%)`, padding: "56px 24px 64px", textAlign: "center" }}>
        <div style={{
          display: "inline-block", background: "rgba(255,255,255,0.15)", borderRadius: 20,
          padding: "6px 16px", fontSize: 13, fontWeight: 600, color: "#fff",
          letterSpacing: "0.5px", marginBottom: 18, textTransform: "uppercase",
        }}>
          Live Demo · VeritaQC&trade; · Phase 1 preview
        </div>
        <h1 style={{ color: "#fff", fontSize: "clamp(28px, 5vw, 44px)", fontWeight: 700, margin: "0 0 12px", lineHeight: 1.15 }}>
          Westgard QC + monthly attestation
        </h1>
        <p style={{ color: "rgba(255,255,255,0.85)", fontSize: "clamp(15px, 2.3vw, 19px)", maxWidth: 720, margin: "0 auto 4px", lineHeight: 1.5 }}>
          90 days of Estradiol QC. One warning, one rejection with corrective action filed. One signed monthly review.
        </p>
        <p style={{ color: "rgba(255,255,255,0.65)", fontSize: 13, maxWidth: 720, margin: "0 auto", lineHeight: 1.5 }}>
          Demo lab: Riverside Regional Medical Center (CLIA 22D0999999). Fixture for demonstration only.
        </p>
      </div>

      <div style={{ maxWidth: 960, margin: "-32px auto 0", padding: "0 20px 60px", position: "relative", zIndex: 1 }}>
        {/* Lot card */}
        <div style={{ background: "#fff", borderRadius: 14, boxShadow: "0 4px 24px rgba(0,0,0,0.08)", padding: "24px 28px", marginBottom: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: TEAL, letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: 6 }}>
            Control lot
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: "#1a1a1a", margin: "0 0 10px" }}>
            {LOT.analyte} &middot; Lot {LOT.lot_number} ({LOT.level})
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, fontSize: 13, color: "#4a5568" }}>
            <div><span style={{ fontWeight: 600, color: "#1a1a1a" }}>Mfr mean:</span> {LOT.mfr_mean}</div>
            <div><span style={{ fontWeight: 600, color: "#1a1a1a" }}>Mfr SD:</span> {LOT.mfr_sd}</div>
            <div><span style={{ fontWeight: 600, color: "#1a1a1a" }}>SD interval:</span> &plusmn;{LOT.mfr_sd_interval}</div>
            <div><span style={{ fontWeight: 600, color: "#1a1a1a" }}>Lab mean:</span> {BASELINE_MEAN}</div>
            <div><span style={{ fontWeight: 600, color: "#1a1a1a" }}>Lab SD:</span> {BASELINE_SD}</div>
            <div><span style={{ fontWeight: 600, color: "#1a1a1a" }}>Manufacturer:</span> {LOT.manufacturer}</div>
          </div>
        </div>

        {/* Summary tiles */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 18 }}>
          <div style={{ background: "#fff", borderRadius: 12, padding: "16px 18px", boxShadow: "0 2px 12px rgba(0,0,0,0.05)", textAlign: "center" }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: "#1a1a1a", fontVariantNumeric: "tabular-nums" }}>90</div>
            <div style={{ fontSize: 12, color: "#718096", marginTop: 2 }}>Runs in window</div>
          </div>
          <div style={{ background: "#fff", borderRadius: 12, padding: "16px 18px", boxShadow: "0 2px 12px rgba(0,0,0,0.05)", textAlign: "center" }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: AMBER_WARN, fontVariantNumeric: "tabular-nums" }}>{totalWarn}</div>
            <div style={{ fontSize: 12, color: "#718096", marginTop: 2 }}>Warning rules fired</div>
          </div>
          <div style={{ background: "#fff", borderRadius: 12, padding: "16px 18px", boxShadow: "0 2px 12px rgba(0,0,0,0.05)", textAlign: "center" }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: RED_REJECT, fontVariantNumeric: "tabular-nums" }}>{totalRej}</div>
            <div style={{ fontSize: 12, color: "#718096", marginTop: 2 }}>Rejection rules fired</div>
          </div>
          <div style={{ background: "#fff", borderRadius: 12, padding: "16px 18px", boxShadow: "0 2px 12px rgba(0,0,0,0.05)", textAlign: "center" }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: missingCA > 0 ? RED_REJECT : GREEN_OK, fontVariantNumeric: "tabular-nums" }}>{missingCA}</div>
            <div style={{ fontSize: 12, color: "#718096", marginTop: 2 }}>Missing corrective action</div>
          </div>
        </div>

        {/* LJ chart */}
        <div style={{ background: "#fff", borderRadius: 14, boxShadow: "0 4px 24px rgba(0,0,0,0.08)", padding: "20px 24px 14px", marginBottom: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: TEAL, letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: 8 }}>
            Levey-Jennings Chart
          </div>
          <LJChart />
          <div style={{ fontSize: 11, color: "#718096", marginTop: 6, display: "flex", gap: 16, flexWrap: "wrap" }}>
            <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 5, background: GREEN_OK, marginRight: 4 }} />Within 2 SD</span>
            <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 5, background: AMBER_WARN, marginRight: 4 }} />2-3 SD (warning band)</span>
            <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 5, background: RED_REJECT, marginRight: 4 }} />Beyond 3 SD (rejection)</span>
          </div>
        </div>

        {/* Recent runs table */}
        <div style={{ background: "#fff", borderRadius: 14, boxShadow: "0 4px 24px rgba(0,0,0,0.08)", padding: "20px 24px", marginBottom: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: TEAL, letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: 12 }}>
            Recent runs (last 14)
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "#718096", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.3px" }}>
                  <th style={{ padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>Date</th>
                  <th style={{ padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>Value</th>
                  <th style={{ padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>SDI</th>
                  <th style={{ padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>Rules</th>
                  <th style={{ padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>CA</th>
                  <th style={{ padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>Accepted</th>
                </tr>
              </thead>
              <tbody>
                {RUNS.map((r, i) => {
                  const sdi = ((r.value - BASELINE_MEAN) / BASELINE_SD).toFixed(2);
                  const bg = r.rule?.severity === "rejection" ? "#fff5f5" : "#fff";
                  return (
                    <tr key={i} style={{ background: bg }}>
                      <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>{r.date}</td>
                      <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9", fontFamily: "monospace" }}>{r.value}</td>
                      <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9", fontFamily: "monospace" }}>{sdi}</td>
                      <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>
                        {r.rule ? <span style={severityChip(r.rule.severity)}>{r.rule.code}</span> : <span style={{ color: "#a0aec0" }}>none</span>}
                      </td>
                      <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9", color: "#4a5568" }}>
                        {r.ca ? "1 action" : "-"}
                      </td>
                      <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>
                        {r.accepted ? <span style={{ color: GREEN_OK, fontWeight: 700 }}>&#10003;</span> :
                          <span style={{ color: AMBER_WARN, fontSize: 11 }}>excluded</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Corrective Action log */}
        <div style={{ background: "#fff", borderRadius: 14, boxShadow: "0 4px 24px rgba(0,0,0,0.08)", padding: "20px 24px", marginBottom: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: TEAL, letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: 12 }}>
            Corrective Actions Log
          </div>
          {RUNS.filter(r => r.ca).map((r, i) => (
            <div key={i} style={{ border: `1px solid ${RED_REJECT}30`, background: "#fff5f5", borderRadius: 8, padding: "12px 14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 12, color: "#4a5568" }}>
                <span><strong>{r.date}</strong> &middot; value {r.value} &middot; rule {r.rule?.code}</span>
                <span style={{ color: GREEN_OK, fontWeight: 700, textTransform: "uppercase", fontSize: 11 }}>{r.ca?.status}</span>
              </div>
              <div style={{ fontSize: 13, color: "#1a1a1a", lineHeight: 1.5 }}>{r.ca?.action_taken}</div>
            </div>
          ))}
        </div>

        {/* Monthly review attestation */}
        <div style={{ background: "#fff", borderRadius: 14, boxShadow: "0 4px 24px rgba(0,0,0,0.08)", padding: "24px 28px", marginBottom: 18, border: `1px solid ${TEAL}30` }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: TEAL, letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: 8 }}>
            Monthly Review Attestation
          </div>
          <p style={{ fontSize: 13, color: "#4a5568", lineHeight: 1.55, margin: "0 0 12px" }}>
            The medical director or designee attests that all QC runs in this period have been reviewed,
            that corrective actions taken at the time of each event are appropriately documented above,
            and that any unresolved issues have been escalated to the laboratory director or designee
            under the lab's non-conformance event process.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1.5fr 1fr 1fr", gap: 14, alignItems: "end", paddingTop: 12, borderTop: "1px solid #e2e8f0" }}>
            <div>
              <div style={{ fontSize: 10, color: "#718096", textTransform: "uppercase", letterSpacing: "0.5px" }}>Reviewer</div>
              <div style={{ fontSize: 14, color: "#1a1a1a", fontWeight: 600, marginTop: 4, borderBottom: "1px solid #1a1a1a", paddingBottom: 2 }}>Dr. Sarah Mitchell, MD</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#718096", textTransform: "uppercase", letterSpacing: "0.5px" }}>Title</div>
              <div style={{ fontSize: 14, color: "#1a1a1a", marginTop: 4, borderBottom: "1px solid #1a1a1a", paddingBottom: 2 }}>Medical Director</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#718096", textTransform: "uppercase", letterSpacing: "0.5px" }}>Date</div>
              <div style={{ fontSize: 14, color: "#1a1a1a", marginTop: 4, borderBottom: "1px solid #1a1a1a", paddingBottom: 2 }}>2026-05-02</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#718096", textTransform: "uppercase", letterSpacing: "0.5px" }}>Acknowledged</div>
              <div style={{ fontSize: 14, color: GREEN_OK, fontWeight: 700, marginTop: 4, borderBottom: "1px solid #1a1a1a", paddingBottom: 2 }}>YES</div>
            </div>
          </div>
        </div>

        {/* What you get */}
        <div style={{ background: "#fff", borderRadius: 14, boxShadow: "0 4px 24px rgba(0,0,0,0.08)", padding: "24px 28px", marginBottom: 24 }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: TEAL, margin: "0 0 8px" }}>
            What you get inside VeritaQC&trade;
          </h3>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 14, color: "#2d3748", lineHeight: 1.7 }}>
            <li>Tech-facing entry page: pick a control lot, log the result, see the Westgard rule decision in real time, file the required corrective action if a rejection fires.</li>
            <li>Daily review feed across all lots in the lab, with status filters: any, with-violation, missing-corrective-action.</li>
            <li>Per-lab Westgard rule configuration: CLSI C24 supports lab-set bias_consecutive_count and trend_consecutive_count, defaulted to 10 and 7.</li>
            <li>Monthly review PDF generator, with on-page-1 signature attestation block and inline Levey-Jennings chart.</li>
            <li>Baseline-excludes-candidate evaluator: outliers do not self-dampen their own SDI.</li>
          </ul>
        </div>

        {/* CTA */}
        <div style={{ background: `linear-gradient(135deg, ${GREEN_OK} 0%, #128a3e 100%)`, borderRadius: 14, padding: "26px 28px", color: "#fff", textAlign: "center" }}>
          <h3 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>
            Try VeritaQC&trade; with your own analytes
          </h3>
          <p style={{ fontSize: 14, opacity: 0.9, margin: "0 0 16px", lineHeight: 1.5 }}>
            VeritaQC is in Phase 1 preview, included with every paid VeritaAssure plan. Set up your
            first control lot, log a run, and see the Westgard math live.
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <Link href="/pricing" style={{
              background: "#fff", color: GREEN_OK, padding: "12px 24px", borderRadius: 10,
              fontWeight: 700, fontSize: 14, textDecoration: "none",
            }}>See plans &rarr;</Link>
            <Link href="/demo" style={{
              background: "rgba(255,255,255,0.15)", color: "#fff", padding: "12px 24px",
              borderRadius: 10, fontWeight: 600, fontSize: 14, textDecoration: "none",
              border: "1px solid rgba(255,255,255,0.35)",
            }}>Back to all demos</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
