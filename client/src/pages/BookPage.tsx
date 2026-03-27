import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { BookOpen, CheckCircle2, FlaskConical, Users, Award, Mic } from "lucide-react";
import { Link } from "wouter";

const CHAPTERS = [
  "Understanding US Lab Law",
  "The Laboratory Medical Director: Authority, Obligation, and Liability",
  "The LAD/LMD Venn Diagram",
  "Laboratory Administrative Directors Face Outward",
  "Staffing",
  "The Workforce Shortage: What the Regulations Actually Allow",
  "Enhancing Laboratory Productivity: Understanding the Key Metrics",
  "Proficiency Testing",
  "Accuracy and Precision Studies: What the Regulations Actually Require",
  "Meaningful QC Review: Reading What Your Data Is Actually Telling You",
  "The End-of-Month Review: Your Lab's Management Accountability Document",
  "Performance Improvement (PI) in the Laboratory",
  "Blood Utilization and Management",
  "Blood Administration: What the Laboratory Owes the Transfusionist",
  "Laboratory Outreach: From Cost Center to Revenue Driver",
  "AI in the Laboratory",
];

const CREDENTIALS = [
  { icon: <Award size={15} />, text: "MS, MBA, MLS(ASCP), CPHQ" },
  { icon: <Users size={15} />, text: "TJC Surveyor — 200+ facility inspections" },
  { icon: <Mic size={15} />, text: "Speaker: TJC BAMM, CLMA Knowledge Lab, ASCLS Annual Meeting" },
  { icon: <BookOpen size={15} />, text: "Published author — Medical Lab Management magazine" },
  { icon: <FlaskConical size={15} />, text: "30-episode webinar series — 1,500+ downloads per episode" },
];

function NotifyForm() {
  return (
    <div className="bg-primary/5 border border-primary/20 rounded-xl p-6 text-center">
      <div className="text-2xl mb-2">📬</div>
      <div className="font-bold text-lg mb-1">Notify me when it's available</div>
      <p className="text-sm text-muted-foreground mb-4">
        The book is in final production. Leave your email and we'll reach out the moment it's ready to ship.
      </p>
      <form
        onSubmit={e => {
          e.preventDefault();
          const email = (e.currentTarget.elements.namedItem("email") as HTMLInputElement).value;
          window.location.href = `mailto:VeriLabGuy@gmail.com?subject=Lab Management 101 — Notify Me&body=Please notify me when the book is available. My email is: ${email}`;
        }}
        className="flex gap-2 max-w-sm mx-auto"
      >
        <input
          name="email"
          type="email"
          required
          placeholder="your@email.com"
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <button
          type="submit"
          className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap"
        >
          Notify Me
        </button>
      </form>
    </div>
  );
}

const PULL_QUOTES = [
  {
    quote: "I became a laboratory director without ever being taught how. That gap is why this book exists.",
    context: "Introduction",
  },
  {
    quote: "The medical director's name on the CLIA certificate is not an honorific. It is personal regulatory exposure.",
    context: "Chapter 2",
  },
  {
    quote: "When someone states that 'CLIA says' something, they should be able to take you directly to the CFRs and show you the specific provision. If they can't, it is quite possible that CLIA says no such thing.",
    context: "Chapter 1",
  },
  {
    quote: "Personnel competency documentation is the single most common deficiency across all accrediting organizations — and it is squarely the director's responsibility.",
    context: "Chapter 2",
  },
];

export default function BookPage() {
  return (
    <div>
      {/* Hero */}
      <section className="border-b border-border bg-primary/5">
        <div className="container-default py-16">
          <div className="grid lg:grid-cols-2 gap-12 items-center max-w-5xl mx-auto">
            {/* Left: Text */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <BookOpen size={20} className="text-primary" />
                <Badge className="bg-primary/10 text-primary border-0">New Book</Badge>
                <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20 border">Coming Soon</Badge>
              </div>
              <h1 className="font-serif text-5xl font-bold mb-3 leading-tight">
                Lab Management 101
              </h1>
              <p className="text-xl text-muted-foreground font-medium mb-5">A Guide to Laboratory Leadership</p>

              {/* Hook */}
              <div className="border-l-4 border-primary pl-4 mb-6">
                <p className="text-base leading-relaxed italic text-foreground/90">
                  "I became a laboratory director without ever being taught how."
                </p>
                <p className="text-sm text-muted-foreground mt-1">— Michael Veri, Introduction</p>
              </div>

              <p className="text-muted-foreground leading-relaxed mb-4">
                Every laboratory director knows the feeling: degrees earned, certifications passed, years logged — and still unprepared for the actual job. The regulations read like a foreign language. The C-suite speaks finance, not science. Accreditors are coming. There is no manual.
              </p>
              <p className="text-muted-foreground leading-relaxed mb-6">
                <em>Lab Management 101</em> is that manual. Written by a laboratory director, regional director, and four-year Joint Commission surveyor who has walked into more than 200 facilities and seen exactly what goes wrong — and why.
              </p>

              <div className="flex flex-wrap gap-3 mb-8">
                <div className="bg-card border border-border rounded-lg px-4 py-2.5 text-center">
                  <div className="text-2xl font-bold text-primary">$69</div>
                  <div className="text-xs text-muted-foreground">Book only</div>
                </div>
                <div className="bg-primary text-primary-foreground rounded-lg px-4 py-2.5 text-center relative">
                  <div className="absolute -top-2.5 left-1/2 -translate-x-1/2">
                    <Badge className="bg-amber-500 text-white border-0 text-xs">Best Value</Badge>
                  </div>
                  <div className="text-2xl font-bold">$198</div>
                  <div className="text-xs opacity-80">Book + 1-Year VeritaCheck</div>
                  <div className="text-xs opacity-60">($69 + $149 — save $20)</div>
                </div>
              </div>
              <NotifyForm />
            </div>

            {/* Right: Book cover placeholder */}
            <div className="flex justify-center lg:justify-end">
              <div className="relative">
                <div className="w-64 h-80 bg-gradient-to-br from-[#0e8a82] to-[#0a5e58] rounded-lg shadow-2xl flex flex-col items-center justify-center p-8 text-white">
                  <div className="w-12 h-0.5 bg-white/40 mb-6" />
                  <div className="font-serif text-3xl font-bold text-center leading-tight mb-3">
                    Lab<br />Management<br />101
                  </div>
                  <div className="text-sm text-white/70 text-center mb-6">A Guide to Laboratory Leadership</div>
                  <div className="w-12 h-0.5 bg-white/40 mb-4" />
                  <div className="text-sm font-semibold">Michael Veri</div>
                  <div className="text-xs text-white/60 mt-1">MS, MBA, MLS(ASCP), CPHQ</div>
                </div>
                <div className="absolute -bottom-2 -right-2 w-64 h-80 bg-black/20 rounded-lg -z-10" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Synopsis */}
      <section className="section-padding border-b border-border">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="grid lg:grid-cols-3 gap-10">
            <div className="lg:col-span-2 space-y-5">
              <h2 className="font-serif text-3xl font-bold">About the Book</h2>

              <p className="text-muted-foreground leading-relaxed">
                There is a gap in laboratory medicine that nobody talks about openly. Clinical training produces exceptional scientists. It does not produce laboratory directors. The skills required to pass boards — chemistry, microbiology, immunology, hematology — have almost no overlap with the skills required to manage sixty employees, defend a budget to a CFO, survive a Joint Commission inspection, or navigate the regulatory exposure that comes with your name on a CLIA certificate.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Most laboratory directors learn the job by accumulating scar tissue. A surveyor finds a deficiency you didn't know existed. A medical director signs a plan of correction they never read. A staffing shortage leads to a competency documentation gap that turns into a condition-level finding. A QC deviation that could have been caught in week one isn't found until month six. <em>Lab Management 101</em> exists to shorten that learning curve.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Each chapter is built around a core principle that the regulatory documents technically require but rarely explain in plain language. Chapter 1 establishes what CLIA actually is — a set of laws, not an organization — and why the difference matters every time someone says "CLIA says" without a CFR citation. Chapter 2 addresses what most pathologists who sign CLIA certificates don't know: that their name carries personal regulatory exposure, including a two-year bar from operating any CLIA-certified laboratory if a certificate is revoked.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                The productivity chapters give directors the formula, the benchmarks, and the language to make capital arguments to administration. The staffing chapter walks through what CLIA actually permits — and what it doesn't — when workforce shortages force qualification decisions that sit in regulatory gray zones. The QC chapter doesn't just explain Westgard rules; it shows you how to read what your QC data is actually telling you before an accreditor reads it for you.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Woven throughout every chapter are <strong>Surveyor Callout boxes</strong> — drawn from real inspections at real facilities. These are not hypotheticals. They are direct observations from the other side of the table: what was found, what it looked like from the inspector's vantage point, and what happened next. No other laboratory management resource offers this perspective.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                The final chapters cover the emerging pressures — laboratory outreach as a revenue strategy, the transfusion committee politics that determine whether blood management becomes a quality win or a liability, and the practical questions AI is already forcing laboratory leaders to answer whether they feel ready or not.
              </p>
              <p className="text-base font-semibold text-foreground">
                This is the book laboratory directors have been finding their way to through hard experience. Now it exists.
              </p>
            </div>

            {/* Pull quotes */}
            <div className="space-y-4">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">From the Book</div>
              {PULL_QUOTES.map((q, i) => (
                <div key={i} className="bg-muted/30 border border-border rounded-xl p-4">
                  <p className="text-sm leading-relaxed italic text-foreground/90 mb-2">"{q.quote}"</p>
                  <p className="text-xs text-muted-foreground">{q.context}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Who it's for */}
      <section className="section-padding border-b border-border bg-muted/20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <h2 className="font-serif text-3xl font-bold mb-2">Who This Book Is For</h2>
          <p className="text-muted-foreground mb-8">If any of these describes you, this book was written with you in mind.</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { title: "New Laboratory Directors", desc: "You just sat down in the chair and realized the regulations are a foreign language. This book is your orientation." },
              { title: "Experienced Directors Preparing for Survey", desc: "You know your lab. This book gives you the surveyor's vantage point — what they look for, what they find, and why." },
              { title: "Administrative Directors", desc: "You run the operation. This book gives you the regulatory fluency to lead your medical director conversation from a position of authority." },
              { title: "Laboratory Managers Moving Up", desc: "You're managing people and processes. This book prepares you for the director-level responsibilities you'll be taking on." },
              { title: "Medical Directors New to Clinical Labs", desc: "You trained in pathology. This book explains the clinical laboratory regulatory environment you now personally own." },
              { title: "Students and Emerging Leaders", desc: "You want to understand the job before you're in it. This is the curriculum that no MLS or MBA program offers." },
            ].map((item, i) => (
              <div key={i} className="bg-card border border-border rounded-xl p-4">
                <div className="font-semibold text-sm mb-1.5">{item.title}</div>
                <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* About the author */}
      <section className="section-padding border-b border-border">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="grid lg:grid-cols-3 gap-10 items-start">
            <div className="lg:col-span-2">
              <h2 className="font-serif text-3xl font-bold mb-4">About the Author</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                Michael Veri brings more than a decade of director-level leadership in civilian healthcare and twenty-two years of service in the United States Army. He has served as a laboratory director, regional laboratory director, and for four years as a surveyor for The Joint Commission — conducting inspections at more than 200 healthcare facilities across the country.
              </p>
              <p className="text-muted-foreground leading-relaxed mb-6">
                Recognizing that laboratory administrative leaders often have the least access to practical mentorship, Michael created a 30-episode free webinar series on laboratory management through LabVine Learning, with more than 1,500 downloads per episode. He founded Veritas Lab Services to extend that mission.
              </p>
              <div className="space-y-2.5">
                {CREDENTIALS.map((c, i) => (
                  <div key={i} className="flex items-center gap-2.5 text-sm">
                    <span className="text-primary">{c.icon}</span>
                    <span className="text-muted-foreground">{c.text}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-4">
              <Card className="border-primary/20 bg-primary/5">
                <CardContent className="p-5">
                  <div className="font-semibold text-sm mb-1">Surveyor Callout Boxes</div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Every chapter includes real observations from 200+ TJC facility inspections — intelligence from the other side of the table.
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-5">
                  <div className="font-semibold text-sm mb-1">Worked Examples</div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Numbers, tables, regulatory citations, and week-by-week scenarios — principles with the proof built in.
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-5">
                  <div className="font-semibold text-sm mb-1">16 Chapters</div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Covers the full scope of laboratory leadership — law, staffing, QC, productivity, blood management, outreach, and AI.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </section>

      {/* What's inside */}
      <section className="section-padding border-b border-border bg-muted/20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <h2 className="font-serif text-3xl font-bold mb-2">What's Inside</h2>
          <p className="text-muted-foreground mb-8">16 chapters covering everything the job actually requires — with real examples, not theory.</p>
          <div className="grid sm:grid-cols-2 gap-3">
            {CHAPTERS.map((ch, i) => (
              <div key={i} className="flex items-start gap-2.5 text-sm">
                <CheckCircle2 size={15} className="text-primary mt-0.5 shrink-0" />
                <span className="text-muted-foreground"><span className="font-medium text-foreground">Chapter {i + 1}:</span> {ch}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing / bundles */}
      <section className="section-padding border-b border-border">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <h2 className="font-serif text-3xl font-bold mb-2">Pricing</h2>
          <p className="text-muted-foreground mb-8">Choose the option that fits your needs. Both include the complete book.</p>
          <div className="grid sm:grid-cols-2 gap-6 max-w-2xl">

            {/* Book only */}
            <Card className="border-2 border-border">
              <CardContent className="p-6">
                <div className="font-bold text-lg mb-1">Book Only</div>
                <div className="flex items-baseline gap-1 mb-3">
                  <span className="text-4xl font-bold">$69</span>
                </div>
                <p className="text-sm text-muted-foreground mb-5">
                  The complete Lab Management 101 guide — all 16 chapters, surveyor callouts, and worked examples.
                </p>
                <ul className="space-y-2 mb-6">
                  {["Complete 16-chapter guide", "Surveyor Callout boxes throughout", "Worked examples with real numbers", "Regulatory citations for every claim"].map(f => (
                    <li key={f} className="flex items-center gap-2 text-sm">
                      <CheckCircle2 size={13} className="text-primary shrink-0" />{f}
                    </li>
                  ))}
                </ul>
                <button
                  disabled
                  className="w-full border border-border rounded-lg py-2.5 text-sm font-semibold text-muted-foreground bg-muted/50 cursor-not-allowed"
                >
                  Available Soon
                </button>
              </CardContent>
            </Card>

            {/* Book + VeritaCheck */}
            <Card className="border-2 border-primary bg-primary/5 relative">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <Badge className="bg-primary text-primary-foreground">Best Value</Badge>
              </div>
              <CardContent className="p-6">
                <div className="font-bold text-lg mb-1">Book + VeritaCheck</div>
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="text-4xl font-bold">$198</span>
                </div>
                <div className="text-xs text-muted-foreground mb-3">$69 book + $149 Individual annual plan — save $20</div>
                <p className="text-sm text-muted-foreground mb-5">
                  Everything in the book, plus a full year of VeritaCheck to run the calibration verification, method comparison, and precision studies Chapter 9 covers.
                </p>
                <ul className="space-y-2 mb-6">
                  {[
                    "Everything in Book Only",
                    "1-year VeritaCheck Individual plan",
                    "Unlimited Cal Ver, Method Comp & Precision studies",
                    "CLIA-compliant PDF reports",
                    "Chapter 9 comes to life in your lab",
                  ].map(f => (
                    <li key={f} className="flex items-center gap-2 text-sm">
                      <CheckCircle2 size={13} className="text-primary shrink-0" />{f}
                    </li>
                  ))}
                </ul>
                <button
                  disabled
                  className="w-full bg-primary/40 rounded-lg py-2.5 text-sm font-semibold text-primary-foreground cursor-not-allowed"
                >
                  Available Soon
                </button>
              </CardContent>
            </Card>
          </div>
          <p className="text-xs text-muted-foreground mt-5">
            Notify us at{" "}
            <a href="mailto:VeriLabGuy@gmail.com?subject=Lab Management 101 — Purchase Inquiry" className="text-primary hover:underline">
              VeriLabGuy@gmail.com
            </a>{" "}
            if you'd like to be contacted when the book is available.
          </p>
        </div>
      </section>

      {/* Chapter 9 callout */}
      <section className="section-padding border-b border-border bg-muted/20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="grid lg:grid-cols-2 gap-10 items-center">
            <div>
              <Badge className="bg-primary/10 text-primary border-0 mb-3">Chapter 9</Badge>
              <h2 className="font-serif text-2xl font-bold mb-3">
                Accuracy and Precision Studies:<br />What the Regulations Actually Require
              </h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                Chapter 9 walks through calibration verification, method comparison, and precision studies — what CLIA actually mandates, how the math works, and what surveyors look for in your documentation.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                VeritaCheck automates every calculation in that chapter. The book explains the why. The software handles the how.
              </p>
            </div>
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="p-6 space-y-3">
                <div className="font-semibold">VeritaCheck handles it all</div>
                {[
                  ["Calibration Verification / Linearity", "42 CFR §493.931"],
                  ["Correlation / Method Comparison", "42 CFR §493.933"],
                  ["Precision Verification (EP15)", "42 CFR §493.941"],
                ].map(([study, cfr]) => (
                  <div key={study} className="flex items-center justify-between text-sm border-b border-border/40 pb-2 last:border-0 last:pb-0">
                    <span className="font-medium">{study}</span>
                    <a
                      href={`https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline"
                    >
                      {cfr}
                    </a>
                  </div>
                ))}
                <div className="pt-2">
                  <Link href="/veritacheck">
                    <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline cursor-pointer">
                      <FlaskConical size={14} />
                      Try VeritaCheck now
                    </span>
                  </Link>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="section-padding">
        <div className="max-w-xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="font-serif text-2xl font-bold mb-3">Be the first to know</h2>
          <p className="text-muted-foreground mb-6">
            The book is in final production. Enter your email and we'll notify you the moment it's available — no spam, just one email when it ships.
          </p>
          <NotifyForm />
        </div>
      </section>
    </div>
  );
}
