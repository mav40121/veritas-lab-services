import { useSEO } from "@/hooks/useSEO";
import { useAuth } from "@/components/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import { CheckCircle2, Map, ChevronRight, FlaskConical, Shield, ExternalLink } from "lucide-react";
import { useLabRoute } from "@/hooks/useLabRoute";

// The eleven columns of the shipped map (VeritaMapMapPage.tsx table header), then
// the lab-established values held in the row. Keep this list in step with that header.
const COLUMNS: { col: string; reg?: string; desc: string }[] = [
  { col: "Analyte",           desc: "One row per test on your menu. Expand the row to enter its lab-established values." },
  { col: "Instruments",       desc: "Every instrument running the test, with its role, drawn from the instruments you add to the map." },
  { col: "Specialty",         desc: "The specialty for the test. Filter the map by specialty to work one section at a time." },
  { col: "Complexity",        reg: "42 CFR §493.15, §493.17", desc: "Waived, moderate, or high. Complexity sets which personnel, QC, and verification requirements apply." },
  { col: "CFR",               reg: "42 CFR Part 493, Subpart I", desc: "The Subpart I section for the test's specialty, shown on the row and set by specialty." },
  { col: "Correlation Req'd", reg: "42 CFR §493.1281(a)",     desc: "Flags a test run on two or more instruments, where results must be compared twice a year. You can mark it N/A with a reason." },
  { col: "Cal Verification",  reg: "42 CFR §493.1255(b)(3)",  desc: "Last-completed date, with due-soon and overdue status on a 6-month cycle. Exempt and not-applicable tests are marked as such." },
  { col: "Method Comparison", reg: "42 CFR §493.1281(a)",     desc: "Last Correlation / Method Comparison date, with due-soon and overdue status on a 6-month cycle." },
  { col: "Precision",         reg: "42 CFR §493.1253(b)(1)(i)(B)", desc: "Last-completed date. The map tracks it on a 6-month cycle; the regulation requires precision verification when a method is introduced." },
  { col: "SOP Review",        reg: "42 CFR §493.1251",        desc: "Link a VeritaDC™ policy and the map reads its review status, or enter the review date and track it on a 24-month cycle." },
  { col: "Notes",             desc: "Free text for anything the row needs to carry." },
  { col: "Lab-Established Values (in the row)", reg: "42 CFR §493.1253, §493.1291(g)", desc: "Reference range, critical values, and AMR, stored by age, sex, or specimen band. Blank until your lab enters what it has verified and adopted." },
];

const FEATURES = [
  "Build your test menu from an instrument library: pick your instruments, toggle the tests you run",
  "CLIA complexity, specialty, and CFR section on every row",
  "Flags every test that needs a correlation, with the instruments involved",
  "Last-completed dates and status for calibration verification, method comparison, precision, and SOP review",
  "Reference range, critical values, and AMR in the row, by age, sex, or specimen band",
  "Filter by specialty: focus on one section at a time",
  "Sort by any column, including complexity",
  "Excel export adds serial number, department, specimen type, units, reportable range, attestations, and status columns",
  "The menu feeds VeritaCheck® study setup, VeritaComp™ competency programs, VeritaPT™ PT coverage, and VeritaTrack™ calendar tasks",
  "Built on CLIA '88 (42 CFR Part 493)",
];

export default function VeritaMapPage() {
  const labRoute = useLabRoute();
  const { isLoggedIn } = useAuth();
    useSEO({ title: "VeritaMap® | Clinical Laboratory Test Menu Mapping Software", description: "Map your complete laboratory test menu with instrument assignments, reference ranges, and critical values. Built for CLIA compliance and accreditation surveys." });
return (
    <div>
      {/* Hero */}
      <section className="border-b border-border bg-primary/5">
        <div className="container-default py-16">
          <div className="grid lg:grid-cols-2 gap-12 items-center max-w-5xl mx-auto">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Map size={20} className="text-primary" />
                <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 border">Now Live</Badge>
              </div>
              <h1 className="font-serif text-5xl font-bold mb-3 leading-tight">VeritaMap®</h1>
              <p className="text-xl text-muted-foreground font-medium mb-5">
                Laboratory Test Menu Regulatory Mapping Tool
              </p>
              <div className="border-l-4 border-primary pl-4 mb-6">
                <p className="text-base leading-relaxed italic text-foreground/90">
                  "Every test your lab runs, its due dates, and its lab-established values. In one place."
                </p>
              </div>
              <p className="text-muted-foreground leading-relaxed mb-4">
                VeritaMap® is the master regulatory map for your test menu. For every test your laboratory performs, VeritaMap® holds the CLIA complexity, specialty, CFR section, whether a correlation is required, last-completed dates for calibration verification, method comparison, precision, and SOP review, and your reference ranges, critical values, and AMR. The menu feeds PT coverage in VeritaPT™ and competency programs in VeritaComp™.
              </p>
              <p className="text-muted-foreground leading-relaxed mb-6">
                Most laboratories discover regulatory gaps during inspections. VeritaMap® shows required correlations and overdue or missing dates before then. Built by a former TJC laboratory surveyor with 200+ facility inspections.
              </p>

              {!isLoggedIn && (
                <div className="flex flex-wrap gap-3 mb-8">
                  <div className="bg-card border border-border rounded-lg px-4 py-2.5 text-center">
                    <div className="text-2xl font-bold text-primary">Free</div>
                    <div className="text-xs text-muted-foreground">Up to 4 instruments & 10 analytes lab-wide</div>
                  </div>
                  <div className="bg-card border border-border rounded-lg px-4 py-2.5 text-center">
                    <div className="text-2xl font-bold text-primary">Included</div>
                    <div className="text-xs text-muted-foreground">in Clinic ($999/yr) and above</div>
                  </div>
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-3">
                <Link href={labRoute("/veritamap-app")} className="inline-flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold px-6 py-3 rounded-lg text-sm transition-colors">
                  Launch VeritaMap® →
                </Link>
                <Link href="/login" className="inline-flex items-center justify-center gap-2 border border-border hover:bg-secondary text-foreground font-semibold px-6 py-3 rounded-lg text-sm transition-colors">
                  Sign In / Create Account
                </Link>
              </div>
            </div>

            {/* Right: visual */}
            <div className="flex justify-center lg:justify-end">
              <div className="relative">
                <div className="w-64 h-80 bg-gradient-to-br from-[#0e8a82] to-[#0a5e58] rounded-lg shadow-2xl flex flex-col p-6 text-white">
                  <div className="flex items-center gap-2 mb-4">
                    <Map size={20} className="text-white/80" />
                    <span className="font-serif font-bold text-lg">VeritaMap®</span>
                  </div>
                  <div className="space-y-2 flex-1">
                    {["Glucose · Chem · Mod · Corr ✓","HgbA1C · Chem · Mod · Cal Ver ✓","CBC · Heme · Mod · Corr ✓","PT/INR · Coag · Mod · Cal Ver ✓","Blood Cx · Micro · High · -","Urine Cx · Micro · High · -","ABO/Rh · BB · High · Corr ✓","UA Dipstick · UA · Waived · -"].map((t, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${t.includes("✓") ? "bg-green-400" : "bg-amber-400"}`} />
                        <span className="text-white/80 font-mono">{t}</span>
                      </div>
                    ))}
                  </div>
                  <div className="border-t border-white/20 pt-3 mt-2">
                    <div className="text-xs text-white/60">Sample: 207 tests · 42 dates overdue or missing</div>
                  </div>
                </div>
                <div className="absolute -bottom-2 -right-2 w-64 h-80 bg-black/20 rounded-lg -z-10" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* What it is */}
      <section className="section-padding border-b border-border">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="grid lg:grid-cols-3 gap-10">
            <div className="lg:col-span-2 space-y-5">
              <h2 className="font-serif text-3xl font-bold">What is VeritaMap®?</h2>
              <p className="text-muted-foreground leading-relaxed">
                Every clinical laboratory has a test menu. Every test on that menu carries a specific set of regulatory obligations: a CLIA complexity designation, a proficiency testing requirement, a competency assessment obligation, a linearity or correlation study requirement, a quality control standard, a reference range verification requirement, and a written procedure. Most laboratories track these obligations inconsistently, if at all.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                VeritaMap® is the infrastructure that makes your test menu visible. One row per test, with its CLIA complexity, specialty, the 42 CFR Part 493 section for that specialty, and the status of calibration verification, correlation, precision, and SOP review. The result is one view of your menu, and a clear view of which dates are overdue or missing before a surveyor finds them.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                VeritaMap® is designed to be permanent infrastructure. Unlike a self-inspection that happens once before a survey, VeritaMap® is updated when tests are added or instruments change. A laboratory that maintains a current VeritaMap® can show a surveyor where each test stands.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                When VeritaMap® shows a test needs calibration verification or a correlation, a link on that row opens VeritaCheck® so you can run the study. The same menu feeds VeritaPT™ coverage and VeritaComp™ competency programs.
              </p>
              <p className="text-base font-semibold text-foreground">
                Know your obligations. Document your compliance. Find the gaps before the survey does.
              </p>
            </div>

            {/* Stat cards */}
            <div className="space-y-4">
              {[
                { stat: "11", label: "Map columns per test, plus lab-established values by band" },
                { stat: "∞", label: "Tests supported on suite plans, no menu size limit" },
              ].map((s, i) => (
                <div key={i} className="bg-muted/30 border border-border rounded-xl p-4 text-center">
                  <div className="font-serif text-4xl font-bold text-primary mb-1">{s.stat}</div>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                </div>
              ))}
              <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
                <div className="text-xs font-semibold text-primary mb-1">Your menu feeds</div>
                <div className="space-y-1.5">
                  <Link href="/veritacheck" className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors">
                    <FlaskConical size={12} />VeritaCheck® - calibration verification and correlation studies
                  </Link>
                  <Link href="/veritapt" className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors">
                    <Shield size={12} />VeritaPT™ - PT coverage by analyte
                  </Link>
                  <Link href="/veritacomp" className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors">
                    <Shield size={12} />VeritaComp™ - competency programs
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* What each test row holds */}
      <section className="section-padding border-b border-border bg-muted/20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <h2 className="font-serif text-3xl font-bold mb-2">What Each Test Row Holds</h2>
          <p className="text-muted-foreground mb-8">Eleven columns per test, plus the values your lab establishes. Citations show where 42 CFR Part 493 addresses the item.</p>
          <div className="grid sm:grid-cols-2 gap-4">
            {COLUMNS.map((c, i) => (
              <div key={i} className="border border-border rounded-xl p-4 bg-card hover:bg-muted/20 transition-colors">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="font-semibold text-sm">{c.col}</div>
                  {c.reg && <code className="text-xs text-primary bg-primary/10 px-1.5 py-0.5 rounded shrink-0">{c.reg}</code>}
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{c.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="section-padding border-b border-border">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <h2 className="font-serif text-3xl font-bold mb-2">What's Included</h2>
          <p className="text-muted-foreground mb-8">Map your test menu and track its verification dates in one place.</p>
          <div className="grid sm:grid-cols-2 gap-3">
            {FEATURES.map((f, i) => (
              <div key={i} className="flex items-start gap-2.5 text-sm">
                <CheckCircle2 size={15} className="text-primary mt-0.5 shrink-0" />
                <span className="text-muted-foreground">{f}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing - public visitors only */}
      {!isLoggedIn && (
      <section className="section-padding border-b border-border bg-muted/20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <h2 className="font-serif text-3xl font-bold mb-2">Pricing</h2>
          <p className="text-muted-foreground mb-8">Start free. Upgrade when you're ready.</p>
          <div className="grid sm:grid-cols-2 gap-6 max-w-2xl">

            <Card className="border-2 border-border">
              <CardContent className="p-6">
                <div className="font-bold text-lg mb-1">Free Plan</div>
                <div className="flex items-baseline gap-1 mb-3">
                  <span className="text-4xl font-bold">Free</span>
                </div>
                <p className="text-sm text-muted-foreground mb-5">
                  Try free: up to 4 instruments and 10 analytes across your lab.
                </p>
                <ul className="space-y-2 mb-6">
                  {["Up to 4 instruments lab-wide","Up to 10 analytes lab-wide","Every map column","Calibration verification, correlation, precision and SOP review status"].map(f => (
                    <li key={f} className="flex items-center gap-2 text-sm">
                      <CheckCircle2 size={13} className="text-primary shrink-0" />{f}
                    </li>
                  ))}
                </ul>
                <Link href={labRoute("/veritamap-app")} className="block w-full border border-primary rounded-lg py-2.5 text-sm font-semibold text-primary text-center hover:bg-primary/5 transition-colors">
                  Launch VeritaMap®
                </Link>
              </CardContent>
            </Card>

            <Card className="border-2 border-primary bg-primary/5 relative">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <Badge className="bg-primary text-primary-foreground">Full Access</Badge>
              </div>
              <CardContent className="p-6">
                <div className="font-bold text-lg mb-1">VeritaAssure&#174; Suite</div>
                <div className="flex items-baseline gap-1 mb-3">
                  <span className="text-sm text-muted-foreground">from</span>
                  <span className="text-4xl font-bold">$999</span>
                  <span className="text-sm text-muted-foreground">/year</span>
                </div>
                <p className="text-sm text-muted-foreground mb-5">
                  Unlimited instruments and analytes. Full map export to Excel. Tier is based on the active seats you need.
                </p>
                <ul className="space-y-2 mb-6">
                  {["Unlimited instruments and analytes","Full map export to Excel","VeritaCheck® + VeritaScan® included","Priority support on Community and above"].map(f => (
                    <li key={f} className="flex items-center gap-2 text-sm">
                      <CheckCircle2 size={13} className="text-primary shrink-0" />{f}
                    </li>
                  ))}
                </ul>
                <Link href="/pricing" className="block w-full bg-primary hover:bg-primary/90 rounded-lg py-2.5 text-sm font-semibold text-primary-foreground text-center transition-colors">
                  View All Plans →
                </Link>
              </CardContent>
            </Card>
          </div>

          {/* Full suite callout */}
          <div className="mt-6 max-w-2xl">
            <div className="bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/20 rounded-xl p-5">
              <div className="font-bold text-base mb-1">
                VeritaAssure&#174; Suite: <span className="text-primary">Starting at $999/year</span>
                <Badge className="ml-2 bg-primary text-primary-foreground text-xs">Full Suite</Badge>
              </div>
              <p className="text-sm text-muted-foreground mb-3">
                The VeritaAssure® compliance suite, including VeritaCheck®, VeritaScan®, and VeritaMap®, in one plan.
              </p>
              <div className="grid sm:grid-cols-3 gap-3 mb-3">
                {[
                  { icon: <FlaskConical size={14} />, name: "VeritaCheck®", desc: "Unlimited EP studies" },
                  { icon: <Shield size={14} />, name: "VeritaScan®", desc: "Self-inspection audit" },
                  { icon: <Map size={14} />, name: "VeritaMap®", desc: "Test menu mapping" },
                ].map((t, i) => (
                  <div key={i} className="bg-card border border-border rounded-lg p-3 text-center">
                    <div className="flex items-center justify-center gap-1 text-primary mb-1">{t.icon}<span className="font-semibold text-xs">{t.name}</span></div>
                    <div className="text-xs text-muted-foreground">{t.desc}</div>
                  </div>
                ))}
              </div>
              <Link href="/pricing" className="inline-flex items-center gap-1 text-sm text-primary hover:underline font-medium">
                View all plans <ChevronRight size={13} />
              </Link>
            </div>
          </div>

          <p className="text-xs text-muted-foreground mt-5">
            Questions?{" "}
            <a href="mailto:info@veritaslabservices.com?subject=VeritaMap® Purchase Inquiry" className="text-primary hover:underline">
              Contact us
            </a>
          </p>
        </div>
      </section>
      )}

      {/* Who it's for */}
      <section className="section-padding border-b border-border">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <h2 className="font-serif text-3xl font-bold mb-2">Who This Is For</h2>
          <p className="text-muted-foreground mb-8">Any laboratory that wants to know its regulatory obligations, before a surveyor does.</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { title: "Laboratory Directors", desc: "You're responsible for every test on that menu. See when each study was last done and what is due next." },
              { title: "Quality Managers", desc: "Your QA program can't monitor what it can't see. VeritaMap® puts each test's due dates and status in one view." },
              { title: "New Lab Administrators", desc: "Inherited a test menu with unknown compliance status? VeritaMap® lays out every test, instrument, and date on file." },
              { title: "Lab Compliance Consultants", desc: "Deploy VeritaMap® at every client engagement. The same map structure every time." },
              { title: "Survey-Prep Teams", desc: "Surveyors ask about specific tests. VeritaMap® puts each test's status in one place." },
              { title: "Growing Laboratories", desc: "Adding tests? Add them to VeritaMap® and VeritaCheck®, VeritaComp™, VeritaPT™ and VeritaTrack™ can draw on them." },
            ].map((item, i) => (
              <div key={i} className="bg-card border border-border rounded-xl p-4">
                <div className="font-semibold text-sm mb-1.5">{item.title}</div>
                <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="section-padding">
        <div className="max-w-xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="font-serif text-2xl font-bold mb-3">Ready to map your test menu?</h2>
          <p className="text-muted-foreground mb-6">
            VeritaMap® is live. Select your instruments, pull each one's test menu from the library, and have a map of your lab in minutes.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button asChild size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold">
              <Link href={labRoute("/veritamap-app")}>Launch VeritaMap® <ChevronRight size={15} className="ml-1" /></Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/login">Sign In / Create Account</Link>
            </Button>
          </div>
          <div className="mt-6 flex flex-col gap-2 items-center">
            <Link href="/veritacheck" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline font-medium">
              <FlaskConical size={14} />Also try VeritaCheck® - EP studies<ChevronRight size={13} />
            </Link>
            <Link href="/veritascan" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline font-medium">
              <Shield size={14} />Also try VeritaScan® - inspection readiness<ChevronRight size={13} />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
