import { useState, type FormEvent, type CSSProperties } from "react";
import { useLocation } from "wouter";
import { SampleReportsSection } from "@/components/SampleReportsSection";

const modules = [
  {
    key: "compliance",
    label: "Compliance Demo",
    brand: "VeritaAssure\u2122 Suite",
    path: "/demo/compliance",
    color: "#1e40af",
    icon: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="8" y="4" width="32" height="40" rx="4" stroke="#1e40af" strokeWidth="2.5" fill="none" />
        <path d="M16 18L21 23L32 12" stroke="#1e40af" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="16" y1="30" x2="32" y2="30" stroke="#1e40af" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
        <line x1="16" y1="36" x2="28" y2="36" stroke="#1e40af" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
      </svg>
    ),
    features: [
      "VeritaCheck\u2122 Method Verification",
      "VeritaScan\u2122 Inspection Readiness",
      "VeritaMap\u2122 Reportable Range Mapping",
      "VeritaComp\u2122 Competency Tracking",
      "VeritaQC\u2122 Westgard + Monthly Attestation (Phase 1 preview)",
    ],
    description:
      "Method verification, inspection readiness scoring, reportable range mapping, competency management, and daily QC with Westgard rule evaluation and monthly attestation.",
    cta: "Explore Compliance Suite",
  },
  {
    key: "operations",
    label: "Operations Demo",
    brand: "VeritaBench\u2122 + VeritaOps\u2122",
    path: "/demo/operations",
    color: "#01696F",
    icon: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="4" y="28" width="8" height="14" rx="2" fill="#01696F" opacity="0.6" />
        <rect x="15" y="20" width="8" height="22" rx="2" fill="#01696F" opacity="0.75" />
        <rect x="26" y="14" width="8" height="28" rx="2" fill="#01696F" opacity="0.9" />
        <rect x="37" y="8" width="8" height="34" rx="2" fill="#01696F" />
        <path d="M8 26L19 18L30 12L41 6" stroke="#01696F" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="41" cy="6" r="3" fill="#01696F" />
      </svg>
    ),
    features: [
      "Instant VeritaBench™ access",
      "Monthly Productivity Tracking",
      "By-Hour Staffing Analysis",
      "Inventory Management",
      "VeritaOps™ Cost Per Reportable Test (4-layer CLSI GP11-A)",
    ],
    description:
      "Staffing efficiency benchmarks, monthly productivity tracking, by-hour scheduling, and the four-layer Cost-Per-Reportable-Test calculator built on the conceptual model in CLSI GP11-A.",
    cta: "Explore Operations Tools",
  },
];

const inputStyle: CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "10px 12px", fontSize: "14px",
  border: "1px solid #cbd5e0", borderRadius: "8px", outline: "none", fontFamily: "inherit",
};
const labelStyle: CSSProperties = {
  display: "block", fontSize: "13px", fontWeight: 600, color: "#2d3748", marginBottom: "5px",
};

export default function DemoSelectorPage() {
  const [, setLocation] = useLocation();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", organization: "", phone: "", message: "" });
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errMsg, setErrMsg] = useState("");
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submitDemoRequest(e: FormEvent) {
    e.preventDefault();
    if (form.name.trim().length < 2 || !form.email.includes("@")) {
      setStatus("error");
      setErrMsg("Please enter your name and a valid email address.");
      return;
    }
    setStatus("sending");
    setErrMsg("");
    try {
      const res = await fetch("/api/request-demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(typeof j.error === "string" ? j.error : "Something went wrong.");
      }
      setStatus("sent");
    } catch (err: any) {
      setStatus("error");
      setErrMsg(err?.message || "Could not send. Please email info@veritaslabservices.com.");
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafb" }}>
      {/* Hero */}
      <div
        style={{
          background: "linear-gradient(135deg, #01696F 0%, #014d52 100%)",
          padding: "64px 24px 56px",
          textAlign: "center",
        }}
      >
        <div
          style={{
            display: "inline-block",
            background: "rgba(255,255,255,0.15)",
            borderRadius: "20px",
            padding: "6px 16px",
            fontSize: "13px",
            fontWeight: 600,
            color: "#ffffff",
            letterSpacing: "0.5px",
            marginBottom: "20px",
            textTransform: "uppercase",
          }}
        >
          Interactive Live Demo
        </div>
        <h1
          style={{
            color: "#ffffff",
            fontSize: "clamp(28px, 5vw, 44px)",
            fontWeight: 700,
            margin: "0 0 12px",
            lineHeight: 1.15,
          }}
        >
          Experience VeritaAssure&#8482;
        </h1>
        <p
          style={{
            color: "rgba(255,255,255,0.85)",
            fontSize: "clamp(16px, 2.5vw, 20px)",
            maxWidth: "600px",
            margin: "0 auto",
            lineHeight: 1.5,
          }}
        >
          Built by a lab operations consultant. Choose your path below.
        </p>
        <div style={{ marginTop: "28px" }}>
          <button
            onClick={() => { setShowForm(true); setStatus("idle"); setErrMsg(""); }}
            style={{
              background: "#ffffff", color: "#01696F", border: "none", borderRadius: "10px",
              padding: "13px 30px", fontSize: "16px", fontWeight: 700, cursor: "pointer",
              boxShadow: "0 3px 14px rgba(0,0,0,0.18)",
            }}
          >
            Request a live demo
          </button>
        </div>
      </div>

      {/* Cards */}
      <div
        style={{
          maxWidth: "960px",
          margin: "-32px auto 0",
          padding: "0 20px 80px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: "28px",
          position: "relative",
          zIndex: 1,
        }}
      >
        {modules.map((mod) => (
          <div
            key={mod.key}
            onClick={() => setLocation(mod.path)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") setLocation(mod.path);
            }}
            role="button"
            tabIndex={0}
            style={{
              background: "#ffffff",
              borderRadius: "16px",
              boxShadow: "0 4px 24px rgba(0,0,0,0.08), 0 1px 4px rgba(0,0,0,0.04)",
              padding: "36px 32px 32px",
              cursor: "pointer",
              transition: "transform 0.2s ease, box-shadow 0.2s ease",
              border: `2px solid transparent`,
              display: "flex",
              flexDirection: "column" as const,
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.transform = "translateY(-4px)";
              (e.currentTarget as HTMLElement).style.boxShadow =
                "0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)";
              (e.currentTarget as HTMLElement).style.borderColor = mod.color;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
              (e.currentTarget as HTMLElement).style.boxShadow =
                "0 4px 24px rgba(0,0,0,0.08), 0 1px 4px rgba(0,0,0,0.04)";
              (e.currentTarget as HTMLElement).style.borderColor = "transparent";
            }}
          >
            {/* Icon + Badge row */}
            <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "20px" }}>
              {mod.icon}
              <div>
                <div style={{ fontSize: "12px", fontWeight: 600, color: mod.color, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "2px" }}>
                  {mod.brand}
                </div>
                <h2 style={{ fontSize: "22px", fontWeight: 700, color: "#1a1a1a", margin: 0 }}>
                  {mod.label}
                </h2>
              </div>
            </div>

            {/* Description */}
            <p style={{ fontSize: "15px", lineHeight: 1.6, color: "#4a5568", margin: "0 0 20px", flex: 1 }}>
              {mod.description}
            </p>

            {/* Features */}
            <ul style={{ listStyle: "none", padding: 0, margin: "0 0 24px" }}>
              {mod.features.map((f, i) => (
                <li
                  key={i}
                  style={{
                    fontSize: "14px",
                    color: "#2d3748",
                    padding: "6px 0",
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                  }}
                >
                  <span
                    style={{
                      width: "20px",
                      height: "20px",
                      borderRadius: "50%",
                      background: mod.color + "15",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2.5 6L5 8.5L9.5 3.5" stroke={mod.color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  {f}
                </li>
              ))}
            </ul>

            {/* CTA button */}
            <div
              style={{
                background: mod.color,
                color: "#ffffff",
                textAlign: "center",
                padding: "14px 24px",
                borderRadius: "10px",
                fontWeight: 600,
                fontSize: "15px",
                transition: "opacity 0.15s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.opacity = "0.9";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.opacity = "1";
              }}
            >
              {mod.cta} &rarr;
            </div>

          </div>
        ))}
      </div>

      {/* Sample reports — visible on the selector landing so prospects can
          download real PDFs immediately without picking a demo path first.
          Shared component sourced from /components/SampleReportsSection. */}
      <div style={{ maxWidth: "960px", margin: "0 auto", padding: "8px 20px 48px" }}>
        <div style={{ height: "1px", background: "linear-gradient(to right, transparent, #01696F30, transparent)", marginBottom: "40px" }} />
        <SampleReportsSection
          heading="VeritaCheck™ Sample Reports"
          subheading="Download a real, generated PDF for each EP study type. Demo lab identity is Riverside Regional Medical Center (CLIA 22D0999999), a fixture for demonstration only."
        />
      </div>

      {/* Bottom note */}
      <div style={{ textAlign: "center", padding: "0 20px 48px" }}>
        <p style={{ fontSize: "14px", color: "#718096", maxWidth: "500px", margin: "0 auto" }}>
          Questions? <a href="mailto:info@veritaslabservices.com" style={{ color: "#01696F" }}>info@veritaslabservices.com</a>
        </p>
      </div>

      {/* Request a live demo modal */}
      {showForm && (
        <div
          onClick={() => setShowForm(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px", zIndex: 100 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "#ffffff", borderRadius: "16px", maxWidth: "480px", width: "100%", padding: "28px", boxShadow: "0 12px 48px rgba(0,0,0,0.24)", maxHeight: "90vh", overflowY: "auto" }}
          >
            {status === "sent" ? (
              <div style={{ textAlign: "center", padding: "12px 0" }}>
                <h2 style={{ fontSize: "20px", fontWeight: 700, color: "#01696F", margin: "0 0 10px" }}>Thanks, we will be in touch</h2>
                <p style={{ fontSize: "14px", color: "#4a5568", lineHeight: 1.6, margin: "0 0 20px" }}>
                  Your request reached the team at info@veritaslabservices.com. We will reply to schedule a live walkthrough.
                </p>
                <button
                  onClick={() => { setShowForm(false); setForm({ name: "", email: "", organization: "", phone: "", message: "" }); setStatus("idle"); }}
                  style={{ background: "#01696F", color: "#fff", border: "none", borderRadius: "8px", padding: "11px 24px", fontSize: "14px", fontWeight: 600, cursor: "pointer" }}
                >
                  Close
                </button>
              </div>
            ) : (
              <form onSubmit={submitDemoRequest}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "6px" }}>
                  <h2 style={{ fontSize: "20px", fontWeight: 700, color: "#1a1a1a", margin: 0 }}>Request a live demo</h2>
                  <button type="button" onClick={() => setShowForm(false)} aria-label="Close" style={{ background: "none", border: "none", fontSize: "24px", lineHeight: 1, color: "#a0aec0", cursor: "pointer" }}>&times;</button>
                </div>
                <p style={{ fontSize: "13px", color: "#718096", margin: "0 0 18px", lineHeight: 1.5 }}>
                  Tell us a little about your lab and we will schedule a walkthrough.
                </p>
                <div style={{ marginBottom: "14px" }}>
                  <label htmlFor="ld-name" style={labelStyle}>Name *</label>
                  <input id="ld-name" type="text" value={form.name} onChange={set("name")} style={inputStyle} autoComplete="name" />
                </div>
                <div style={{ marginBottom: "14px" }}>
                  <label htmlFor="ld-email" style={labelStyle}>Work email *</label>
                  <input id="ld-email" type="email" value={form.email} onChange={set("email")} style={inputStyle} autoComplete="email" />
                </div>
                <div style={{ marginBottom: "14px" }}>
                  <label htmlFor="ld-org" style={labelStyle}>Lab or organization</label>
                  <input id="ld-org" type="text" value={form.organization} onChange={set("organization")} style={inputStyle} autoComplete="organization" />
                </div>
                <div style={{ marginBottom: "14px" }}>
                  <label htmlFor="ld-phone" style={labelStyle}>Phone</label>
                  <input id="ld-phone" type="tel" value={form.phone} onChange={set("phone")} style={inputStyle} autoComplete="tel" />
                </div>
                <div style={{ marginBottom: "16px" }}>
                  <label htmlFor="ld-message" style={labelStyle}>Anything specific you would like to see?</label>
                  <textarea id="ld-message" value={form.message} onChange={set("message")} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
                </div>
                {status === "error" && (
                  <p style={{ color: "#c53030", fontSize: "13px", margin: "0 0 12px" }}>{errMsg}</p>
                )}
                <button
                  type="submit"
                  disabled={status === "sending"}
                  style={{ width: "100%", background: "#01696F", color: "#fff", border: "none", borderRadius: "9px", padding: "13px", fontSize: "15px", fontWeight: 700, cursor: status === "sending" ? "default" : "pointer", opacity: status === "sending" ? 0.7 : 1 }}
                >
                  {status === "sending" ? "Sending..." : "Send request"}
                </button>
                <p style={{ fontSize: "12px", color: "#a0aec0", textAlign: "center", margin: "12px 0 0" }}>
                  Or email <a href="mailto:info@veritaslabservices.com" style={{ color: "#01696F" }}>info@veritaslabservices.com</a>
                </p>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
