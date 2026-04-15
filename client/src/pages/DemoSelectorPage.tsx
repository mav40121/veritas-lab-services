import { useLocation } from "wouter";

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
      "VeritaCheck\u2122 Method Validation",
      "VeritaScan\u2122 Inspection Readiness",
      "VeritaMap\u2122 Reportable Range Mapping",
      "VeritaComp\u2122 Competency Tracking",
    ],
    description:
      "Explore the full compliance suite: method validation, inspection readiness scoring, reportable range mapping, and competency management.",
    cta: "Explore Compliance Suite",
  },
  {
    key: "operations",
    label: "Operations Demo",
    brand: "VeritaOps\u2122",
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
      "Instant Productivity Calculator",
      "Monthly Productivity Tracking",
      "By-Hour Staffing Analysis",
      "Inventory Management",
    ],
    description:
      "See how your lab's staffing efficiency compares to industry benchmarks, track trends over time, and optimize scheduling by the hour.",
    cta: "Explore Operations Tools",
  },
];

export default function DemoSelectorPage() {
  const [, setLocation] = useLocation();

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

      {/* Bottom note */}
      <div style={{ textAlign: "center", padding: "0 20px 48px" }}>
        <p style={{ fontSize: "14px", color: "#718096", maxWidth: "500px", margin: "0 auto" }}>
          Questions? <a href="mailto:info@veritaslabservices.com" style={{ color: "#01696F" }}>info@veritaslabservices.com</a>
        </p>
      </div>
    </div>
  );
}
