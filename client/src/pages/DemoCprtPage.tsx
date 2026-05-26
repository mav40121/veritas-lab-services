import { useState, useMemo } from "react";
import { Link } from "wouter";
import { useSEO } from "@/hooks/useSEO";

// VeritaOps™ CPRT live demo. Walks through the four-layer cost-per-reportable-test
// calculation on a pre-loaded coagulation-send-out-brought-in-house scenario.
// User can slide annual volume and watch L1-L4 recompute; the point is to show
// why the marginal-cost answer (L1) and the capital-justification answer (L3)
// diverge dramatically at low volume. Mirrors computeCprt() in server/veritaops.ts.

// ── Pre-loaded scenario: coagulation send-out brought in-house ────────────
// Matches the Wednesday May 27 LinkedIn post: in-house volume 180/yr,
// calibrator + QC run at the same cadence as a high-volume bench, tech time
// for setup and competency not amortized to a usable denominator.
const SCENARIO = {
  test_name: "Activated PTT (aPTT)",
  reagent_cost_per_test: 1.85,
  other_supplies_per_test: 0.20,
  calibrator_kit_cost: 320,
  cals_per_year: 12,
  qc_cost_per_run: 4.50,
  qc_runs_per_year: 730, // 2x daily, 365 days
  tech_minutes_per_test: 6,
  tech_loaded_hourly_rate: 48,
  instrument_purchase_cost: 78000,
  instrument_useful_life_years: 7,
  annual_maintenance_cost: 4200,
  overhead_flat_per_test: 1.75,
};

// Reference-lab quote for the same test (what the lab would pay to send out)
const REFERENCE_LAB_QUOTE = 9.50;

const TEAL = "#01696F";
const RED = "#a12c7b";
const GREEN = "#437a22";
const AMBER = "#964219";

function computeCprt(volume: number, s: typeof SCENARIO) {
  const amortize = (n: number) => (volume > 0 ? n / volume : 0);
  const l1 =
    s.reagent_cost_per_test +
    amortize(s.calibrator_kit_cost * s.cals_per_year) +
    amortize(s.qc_cost_per_run * s.qc_runs_per_year) +
    s.other_supplies_per_test;
  const labor = (s.tech_minutes_per_test / 60) * s.tech_loaded_hourly_rate;
  const l2 = l1 + labor;
  const annualDep = s.instrument_purchase_cost / Math.max(1, s.instrument_useful_life_years);
  const capitalPerTest = amortize(annualDep + s.annual_maintenance_cost);
  const l3 = l2 + capitalPerTest;
  const l4 = l3 + s.overhead_flat_per_test;
  return { l1, l2, l3, l4 };
}

function fmt(n: number) {
  return "$" + n.toFixed(2);
}

function comparison(value: number, quote: number) {
  if (value < quote * 0.85) return { label: "Strongly favors in-house", color: GREEN };
  if (value < quote) return { label: "Favors in-house", color: GREEN };
  if (value < quote * 1.15) return { label: "Close to send-out cost", color: AMBER };
  return { label: "Send-out is cheaper", color: RED };
}

const LAYER_NOTES: { layer: string; title: string; question: string; example: string }[] = [
  {
    layer: "L1",
    title: "Reagents + calibrators + QC + other supplies",
    question: "What does it cost to run one more test on an analyzer already on the floor?",
    example: "Use when answering: 'should we run this one extra batch?' Marginal-cost question only.",
  },
  {
    layer: "L2",
    title: "L1 + direct labor",
    question: "What is the true marginal cost of bringing this test in-house?",
    example: "Use when answering: 'should we insource this test from the reference lab?' Insource vs send-out lives here.",
  },
  {
    layer: "L3",
    title: "L2 + equipment depreciation and maintenance",
    question: "What is the all-in cost when justifying capital purchase?",
    example: "Use when answering: 'should we buy a new instrument for this test?' Finance committee will challenge you on this number.",
  },
  {
    layer: "L4",
    title: "L3 + indirect overhead",
    question: "What is the fully-loaded cost for charge-master pricing?",
    example: "Use when answering: 'what should we charge for this test?' Defensible cost basis for billed pricing.",
  },
];

export default function DemoCprtPage() {
  useSEO({
    title: "VeritaOps™ CPRT Demo — Cost Per Reportable Test",
    description:
      "Live demonstration of four-layer cost-per-reportable-test calculation. CLSI GP11-A conceptual model. Built for clinical lab directors and CFOs.",
  });

  const [volume, setVolume] = useState(180);
  const layers = useMemo(() => computeCprt(volume, SCENARIO), [volume]);
  const insourceVerdict = comparison(layers.l2, REFERENCE_LAB_QUOTE);
  const capitalVerdict = comparison(layers.l3, REFERENCE_LAB_QUOTE);

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafb" }}>
      {/* Hero */}
      <div style={{ background: `linear-gradient(135deg, ${TEAL} 0%, #014d52 100%)`, padding: "56px 24px 64px", textAlign: "center" }}>
        <div style={{
          display: "inline-block", background: "rgba(255,255,255,0.15)", borderRadius: 20,
          padding: "6px 16px", fontSize: 13, fontWeight: 600, color: "#fff",
          letterSpacing: "0.5px", marginBottom: 18, textTransform: "uppercase",
        }}>
          Live Demo · VeritaOps&trade;
        </div>
        <h1 style={{ color: "#fff", fontSize: "clamp(28px, 5vw, 44px)", fontWeight: 700, margin: "0 0 12px", lineHeight: 1.15 }}>
          Cost Per Reportable Test
        </h1>
        <p style={{ color: "rgba(255,255,255,0.85)", fontSize: "clamp(15px, 2.3vw, 19px)", maxWidth: 720, margin: "0 auto 4px", lineHeight: 1.5 }}>
          Four layers. Four different answers. Move the volume slider and watch the answer change.
        </p>
        <p style={{ color: "rgba(255,255,255,0.65)", fontSize: 13, maxWidth: 720, margin: "0 auto", lineHeight: 1.5 }}>
          Conceptual model from CLSI GP11-A "Basic Cost Accounting for Clinical Services."
        </p>
      </div>

      <div style={{ maxWidth: 960, margin: "-32px auto 0", padding: "0 20px 60px", position: "relative", zIndex: 1 }}>
        {/* Scenario card */}
        <div style={{ background: "#fff", borderRadius: 14, boxShadow: "0 4px 24px rgba(0,0,0,0.08)", padding: "28px 28px 24px", marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: TEAL, letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: 6 }}>
            Worked scenario
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: "#1a1a1a", margin: "0 0 8px" }}>
            {SCENARIO.test_name} brought in-house from a reference lab
          </h2>
          <p style={{ fontSize: 14, color: "#4a5568", lineHeight: 1.55, margin: "0 0 18px" }}>
            Reagent cost on the invoice looks favorable. The analyzer was already on the floor.
            The reference lab was charging <strong>{fmt(REFERENCE_LAB_QUOTE)}</strong> per result.
            The decision was made on the reagent number alone. Then volume came in at 180 tests per year.
          </p>

          {/* Volume slider */}
          <div style={{ background: "#f8fafb", border: "1px solid #e2e8f0", borderRadius: 10, padding: "16px 18px", marginBottom: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
              <label htmlFor="vol" style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1a" }}>
                Annual reportable volume
              </label>
              <span style={{ fontSize: 22, fontWeight: 700, color: TEAL, fontVariantNumeric: "tabular-nums" }}>
                {volume.toLocaleString()}
                <span style={{ fontSize: 12, color: "#718096", fontWeight: 500, marginLeft: 6 }}>tests / year</span>
              </span>
            </div>
            <input
              id="vol"
              type="range"
              min={50}
              max={10000}
              step={10}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              style={{ width: "100%", accentColor: TEAL }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#a0aec0", marginTop: 4 }}>
              <span>50</span><span>2,500</span><span>5,000</span><span>7,500</span><span>10,000</span>
            </div>
          </div>

          {/* Layer grid */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12,
          }}>
            {[
              { label: "L1 Reagents + supplies", value: layers.l1, color: "#4a5568" },
              { label: "L2 + direct labor", value: layers.l2, color: TEAL },
              { label: "L3 + equipment", value: layers.l3, color: "#1e40af" },
              { label: "L4 + overhead", value: layers.l4, color: "#7c3aed" },
            ].map((l) => (
              <div key={l.label} style={{
                border: `2px solid ${l.color}30`, borderRadius: 10, padding: "14px 16px",
                background: `${l.color}05`,
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: l.color, letterSpacing: "0.3px", textTransform: "uppercase", marginBottom: 4 }}>
                  {l.label.split(" ")[0]}
                </div>
                <div style={{ fontSize: 24, fontWeight: 700, color: "#1a1a1a", fontVariantNumeric: "tabular-nums" }}>
                  {fmt(l.value)}
                </div>
                <div style={{ fontSize: 11, color: "#718096", marginTop: 2 }}>
                  {l.label.split(" ").slice(1).join(" ")}
                </div>
              </div>
            ))}
          </div>

          {/* Insource vs send-out verdict bar */}
          <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={{ border: `2px solid ${insourceVerdict.color}40`, background: `${insourceVerdict.color}08`, borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: insourceVerdict.color, letterSpacing: "0.3px", textTransform: "uppercase" }}>
                L2 vs reference-lab quote ({fmt(REFERENCE_LAB_QUOTE)})
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#1a1a1a", marginTop: 4 }}>
                {insourceVerdict.label}
              </div>
              <div style={{ fontSize: 12, color: "#4a5568", marginTop: 2 }}>
                Marginal in-house cost: {fmt(layers.l2)} per result
              </div>
            </div>
            <div style={{ border: `2px solid ${capitalVerdict.color}40`, background: `${capitalVerdict.color}08`, borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: capitalVerdict.color, letterSpacing: "0.3px", textTransform: "uppercase" }}>
                L3 vs reference-lab quote (capital justification)
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#1a1a1a", marginTop: 4 }}>
                {capitalVerdict.label}
              </div>
              <div style={{ fontSize: 12, color: "#4a5568", marginTop: 2 }}>
                All-in cost: {fmt(layers.l3)} per result
              </div>
            </div>
          </div>

          <p style={{ fontSize: 12, color: "#718096", marginTop: 16, lineHeight: 1.55 }}>
            Pull the volume slider down to 180 and look at L2 vs the reference lab. At that volume the
            decision to insource looks negative even before equipment is in the math. Slide up to 5,000
            and the same test crosses over to favoring in-house at both L2 and L3.
          </p>
        </div>

        {/* Layer reference cards */}
        <div style={{ background: "#fff", borderRadius: 14, boxShadow: "0 4px 24px rgba(0,0,0,0.08)", padding: "28px", marginBottom: 24 }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: TEAL, margin: "0 0 4px" }}>
            Which layer answers which question
          </h3>
          <p style={{ fontSize: 13, color: "#718096", margin: "0 0 18px" }}>
            The marginal-cost question and the capital-justification question are not the same question.
            They do not use the same layer.
          </p>
          <div style={{ display: "grid", gap: 12 }}>
            {LAYER_NOTES.map((n) => (
              <div key={n.layer} style={{
                display: "grid", gridTemplateColumns: "60px 1fr", gap: 14,
                padding: "14px 16px", border: "1px solid #e2e8f0", borderRadius: 10,
                background: "#fafbfc",
              }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: TEAL, fontVariantNumeric: "tabular-nums" }}>
                  {n.layer}
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1a" }}>{n.title}</div>
                  <div style={{ fontSize: 13, color: "#4a5568", marginTop: 4, fontStyle: "italic" }}>
                    {n.question}
                  </div>
                  <div style={{ fontSize: 12, color: "#718096", marginTop: 6 }}>
                    {n.example}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Side-by-side preview */}
        <div style={{ background: "#fff", borderRadius: 14, boxShadow: "0 4px 24px rgba(0,0,0,0.08)", padding: "28px", marginBottom: 24 }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: TEAL, margin: "0 0 8px" }}>
            What you get inside VeritaOps&trade;
          </h3>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 14, color: "#2d3748", lineHeight: 1.7 }}>
            <li>Per-test CPRT studies in this four-layer GP11-A structure, saved per lab, retired and revised on a documented cycle.</li>
            <li>Side-by-side comparison of two studies (vendor A vs vendor B, before vs after a process change, insource vs send-out).</li>
            <li>One-page internal PDF your finance team can actually read, with the layer values, the assumptions, and the calculation date.</li>
            <li>Starting-point archetypes (high-volume chemistry, low-volume send-out, POCT, manual coag) so you are not starting from a blank form.</li>
            <li>Re-run the calculation any time volume changes; old versions retained for audit.</li>
          </ul>
        </div>

        {/* CTA */}
        <div style={{
          background: `linear-gradient(135deg, ${TEAL} 0%, #014d52 100%)`,
          borderRadius: 14, padding: "26px 28px", color: "#fff", textAlign: "center",
        }}>
          <h3 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>
            Try this with your own test menu
          </h3>
          <p style={{ fontSize: 14, opacity: 0.9, margin: "0 0 16px", lineHeight: 1.5 }}>
            VeritaOps&trade; is included with every paid VeritaAssure plan. Start a free trial and run
            your first CPRT study on the tests that matter most.
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <Link
              href="/pricing"
              style={{
                background: "#fff", color: TEAL, padding: "12px 24px", borderRadius: 10,
                fontWeight: 700, fontSize: 14, textDecoration: "none",
              }}
            >
              See plans &rarr;
            </Link>
            <Link
              href="/demo"
              style={{
                background: "rgba(255,255,255,0.15)", color: "#fff", padding: "12px 24px",
                borderRadius: 10, fontWeight: 600, fontSize: 14, textDecoration: "none",
                border: "1px solid rgba(255,255,255,0.35)",
              }}
            >
              Back to all demos
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
