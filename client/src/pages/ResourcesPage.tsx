import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BookOpen, ChevronRight, Clock, FlaskConical, User, Search, Wrench, Download, Shield, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import { NewsletterSignup } from "@/components/NewsletterSignup";

const articles = [
  {
    slug: "how-veritaassure-trains-lab-leaders",
    title: "How VeritaAssure Trains the Next Generation of Lab Leaders",
    summary: "Most lab directors learn compliance the hard way. VeritaAssure changes that. Here is how the modules work as a leadership development curriculum.",
    category: "Leadership Development",
    readTime: "14 min read",
    author: "Michael Veri",
    date: "March 2026",
    tags: ["Leadership Development", "Lab Director", "CLIA", "VeritaAssure"],
    featured: true,
  },
  {
    slug: "clia-calibration-verification-method-comparison",
    title: "CLIA Calibration Verification and Method Comparison: What Lab Managers Actually Need to Know",
    summary: "Calibration verification is an accuracy study. Correlation is a precision study. Most labs are doing both wrong. Spending money on kits they don't need and missing the 6-month-plus-20-day compliance window that would eliminate the stress entirely.",
    category: "Regulatory Compliance",
    readTime: "12 min read",
    author: "Michael Veri",
    date: "March 2026",
    tags: ["CLIA", "Calibration Verification", "Method Comparison", "Compliance"],
    featured: false,
  },
  {
    slug: "clia-tea-what-lab-directors-dont-know",
    title: "CLIA Allowable Error (TEa): What It Is, Where to Find It, and Why Most Lab Directors Don't Know About It",
    summary: "In 200+ inspections as a Joint Commission surveyor, most lab directors evaluated calibration verification against manufacturer criteria, unaware that the regulatory standard lives in federal law. Here's where to find it and how to use it.",
    category: "Regulatory Compliance",
    readTime: "10 min read",
    author: "Michael Veri",
    date: "March 2026",
    tags: ["CLIA TEa", "Allowable Error", "Calibration Verification", "CFR"],
    featured: false,
  },
  {
    slug: "calibration-verification-requirements-clia",
    title: "Calibration Verification Requirements Under CLIA: What Every Lab Director Needs to Know",
    summary: "Calibration verification is one of the most consistently cited deficiencies in CLIA and CAP inspections. This article covers what the regulation requires, when out-of-cycle verification is triggered, and what your documentation must include.",
    category: "Regulatory Compliance",
    readTime: "8 min read",
    author: "Michael Veri",
    date: "April 2026",
    tags: ["CLIA", "Calibration Verification", "42 CFR 493.1255", "Inspection"],
    featured: false,
  },
  {
    slug: "how-to-perform-method-comparison-study",
    title: "How to Perform a Method Comparison Study in Your Clinical Laboratory",
    summary: "A practical guide to running a method comparison study: specimen requirements, regression statistics, acceptance criteria, and common mistakes that lead to inspection findings.",
    category: "Method Evaluation",
    readTime: "10 min read",
    author: "Michael Veri",
    date: "April 2026",
    tags: ["Method Comparison", "Correlation", "CLSI EP09", "CAP"],
    featured: false,
  },
  {
    slug: "tjc-laboratory-inspection-checklist-preparation",
    title: "Preparing for a TJC Laboratory Inspection: A Practical Checklist for Lab Directors",
    summary: "A former Joint Commission surveyor explains the five areas surveyors trace most consistently and how to prepare your documentation before the survey window opens.",
    category: "Inspection Readiness",
    readTime: "10 min read",
    author: "Michael Veri",
    date: "April 2026",
    tags: ["TJC", "Inspection Readiness", "Survey Prep", "Documentation"],
    featured: false,
  },
  {
    slug: "how-to-validate-veritacheck-clia",
    title: "How to Validate VeritaCheck(TM) for Your Clinical Laboratory",
    summary: "A step-by-step guide to completing IQ/OQ/PQ software validation for VeritaCheck(TM), with a free downloadable template. Most labs finish in under two hours.",
    category: "Software Validation",
    readTime: "8 min read",
    author: "Michael Veri",
    date: "April 2026",
    tags: ["Software Validation", "IQ/OQ/PQ", "CLIA 493.1251", "CAP"],
    featured: false,
  },
];

const tools = [
  {
    slug: "clia-tea-lookup",
    title: "CLIA TEa Lookup Tool",
    description: "Search the complete 2025 CLIA acceptable performance criteria for 76+ analytes. Free, no login required.",
    badge: "Free Tool",
  },
];

const comingSoon = [
  { title: "EP15 Precision Verification: A Step-by-Step Guide for Clinical Labs", category: "EP Studies" },
  { title: "How to Run a CLIA-Compliant Method Comparison Without Commercial Kits", category: "Cost Savings" },
  { title: "The 10 Most Cited CLIA Deficiencies: and How to Fix Them Before Your Survey", category: "Inspection Readiness" },
  { title: "Understanding CLIA Allowable Error (TEa): A Practical Reference for Lab Directors", category: "Regulatory Compliance" },
];

// ── FAQ Data ─────────────────────────────────────────────────────────────────

const FAQ_CATEGORIES = [
  {
    category: "About VeritaAssure\u2122",
    items: [
      {
        q: "What is VeritaAssure\u2122?",
        a: "VeritaAssure\u2122 is a SaaS compliance platform built specifically for clinical laboratories. It covers method validation studies, inspection readiness, test menu regulatory mapping, staff competency documentation, personnel tracking, certificate monitoring, and proficiency testing guidance - all in one platform. Every report includes regulatory citations and a laboratory director or designee review block.",
      },
      {
        q: "Who built VeritaAssure\u2122?",
        a: "VeritaAssure\u2122 was designed and built by Michael Veri, MS, MBA, MLS(ASCP), CPHQ - a laboratory professional with over 25 years in clinical laboratory science. Michael spent 4 years as a Joint Commission surveyor, conducting more than 200 laboratory surveys across the country. He built VeritaAssure\u2122 as someone who lived the compliance burden from both sides of the inspection table.",
      },
      {
        q: "Is VeritaAssure\u2122 a CLIA-approved or accreditation-approved software?",
        a: "VeritaAssure\u2122 is a documentation and compliance management tool. It generates records that laboratories can use to satisfy their regulatory obligations, but it is not itself a regulatory body and does not grant certification or accreditation. Your laboratory director or designee retains final responsibility for all compliance determinations.",
      },
      {
        q: "Does VeritaAssure\u2122 replace my laboratory director or designee?",
        a: "No. Every report and study generated by VeritaAssure\u2122 includes a laboratory director or designee review block. Final approval and clinical determination must be made by the laboratory director or designee. VeritaAssure\u2122 supports compliance documentation - it does not replace professional judgment.",
      },
    ],
  },
  {
    category: "HIPAA and Data Privacy",
    items: [
      {
        q: "Is VeritaAssure\u2122 a HIPAA-covered platform?",
        a: "No. VeritaAssure\u2122 is not designed to store, process, or transmit protected health information (PHI). It is a QC and compliance documentation tool. Users are required to use only de-identified data: sample IDs, QC lot numbers, instrument control values, and non-patient-identifiable information. Do not enter patient names, dates of birth, medical record numbers, or any other PHI into any VeritaAssure\u2122 module.",
      },
      {
        q: "Why isn't VeritaAssure\u2122 a HIPAA-covered platform?",
        a: "Method validation studies, calibration verification, proficiency testing documentation, inspection readiness checklists, and staff competency records do not require patient data. QC work is performed on controls and reference materials, not patient specimens. Compliance documentation references regulatory standards, not patient outcomes. There is no legitimate need for PHI in any function VeritaAssure\u2122 performs.",
      },
      {
        q: "Will you sign a Business Associate Agreement (BAA)?",
        a: "A BAA is available for organizations that require one as part of their vendor compliance program. Contact info@veritaslabservices.com. Because VeritaAssure\u2122 does not process PHI, a BAA is a contractual formality rather than a functional requirement.",
      },
      {
        q: "What data do you collect about me?",
        a: "We collect your name, email address, lab name, CLIA number, and the compliance data you enter into the platform: study results, test menus, inspection responses, and personnel records. We do not collect patient data, and we do not share or sell your data to third parties.",
      },
      {
        q: "Who can see my data?",
        a: "Your data is visible only to you and any seat users you invite. Veritas Lab Services staff may access data for support purposes. We do not sell, share, or disclose your data to third parties.",
      },
    ],
  },
  {
    category: "Data Security",
    items: [
      {
        q: "How is my data protected?",
        a: "All data is transmitted over encrypted HTTPS connections and stored in an isolated database on a secured cloud server. Access requires authentication with your credentials. Passwords are hashed before storage and never stored in plaintext.",
      },
      {
        q: "Do you back up my data?",
        a: "Yes. Your data is automatically snapshotted nightly and retained for 30 days. In addition, all destructive actions - deleting a study, removing an instrument, clearing a scan - are logged with a before-state record that can be used to restore data if needed. Contact info@veritaslabservices.com if you need to recover data.",
      },
      {
        q: "What happens to my data if VeritaAssure\u2122 experiences an outage?",
        a: "Your data is stored on a persistent cloud volume and is not affected by application restarts or brief outages. Nightly snapshots ensure your data can be restored from the most recent backup in the event of a prolonged outage.",
      },
    ],
  },
  {
    category: "Subscriptions and Billing",
    items: [
      {
        q: "What plans are available?",
        a: "VeritaAssure\u2122 offers plans based on your lab's size and needs. Per Study ($25 one-time, VeritaCheck\u2122 only), VeritaCheck\u2122 Unlimited ($299/yr, single user), Clinic ($499/yr, 0-25 beds, 2 seats), Community ($799/yr, 26-100 beds, 5 seats), Hospital ($1,299/yr, 101-300 beds, 15 seats), Enterprise ($1,999/yr, 300+ beds, 25 seats), and Enterprise+ (custom pricing for multi-site health systems). All plans include a 14-day trial period.",
      },
      {
        q: "How is my plan tier determined?",
        a: "At signup, we look up your hospital by name against CMS Provider of Services data and suggest a plan based on your licensed bed count. You can always select a different tier. Non-hospital labs - physician office labs, independent labs, FQHCs - select their tier directly from all available options.",
      },
      {
        q: "Can I try VeritaAssure\u2122 before subscribing?",
        a: "Yes. A fully interactive live demo is available at veritaslabservices.com/#/demo with no login required. You can also run individual VeritaCheck\u2122 studies on a per-study basis before committing to a subscription.",
      },
      {
        q: "What payment methods do you accept?",
        a: "Self-service subscriptions are processed by credit or debit card through Stripe. Hospitals and health systems requiring purchase order-based invoicing should contact info@veritaslabservices.com to arrange billing. Payment card information is processed and stored by Stripe and is never stored on our servers.",
      },
      {
        q: "Can I cancel at any time?",
        a: "Yes. You can cancel your subscription at any time. Your access will continue through the end of your current billing period.",
      },
    ],
  },
  {
    category: "Data Retention and Cancellation",
    items: [
      {
        q: "What happens to my data if I cancel?",
        a: "Your data is retained for 2 years after your subscription ends. During this period you can reactivate your subscription and regain full access to your historical records. This retention period is designed to align with common laboratory record retention requirements.",
      },
      {
        q: "Can I export my data before canceling?",
        a: "Yes. Every module that generates structured data has an Excel or PDF export function. We recommend exporting your records before canceling if you want local copies.",
      },
      {
        q: "What happens after the 2-year retention period?",
        a: "After 2 years of inactivity, your account and associated data are permanently deleted from our servers. We will notify you by email before this occurs.",
      },
      {
        q: "Can I request deletion of my data before the retention period ends?",
        a: "Yes. Contact info@veritaslabservices.com to request early deletion. We will confirm deletion within 30 days.",
      },
    ],
  },
  {
    category: "Technical and Support",
    items: [
      {
        q: "What browsers does VeritaAssure\u2122 support?",
        a: "VeritaAssure\u2122 works in any modern browser including Chrome, Edge, Firefox, and Safari. No software installation is required.",
      },
      {
        q: "Is there a mobile app?",
        a: "Not currently. VeritaAssure\u2122 is a web-based platform accessible from any device with a browser, but it is optimized for desktop use.",
      },
      {
        q: "Is software validation documentation available?",
        a: "Yes. A software validation template is available for download on this page. Laboratories that require formal software validation documentation as part of their quality system can use this template to document their validation process.",
      },
      {
        q: "How do I get support?",
        a: "Email info@veritaslabservices.com. We aim to respond within 2 business days.",
      },
      {
        q: "Is training available?",
        a: "Community, Hospital, and Enterprise plans include a complimentary 1-hour onboarding session via Zoom or Teams with a VeritaAssure\u2122 specialist. Additional training sessions can be arranged on request.",
      },
    ],
  },
];

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-border last:border-b-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-start justify-between gap-4 py-4 text-left group"
      >
        <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors leading-snug">{q}</span>
        {open
          ? <ChevronUp size={15} className="shrink-0 text-primary mt-0.5" />
          : <ChevronDown size={15} className="shrink-0 text-muted-foreground mt-0.5" />}
      </button>
      {open && (
        <div className="pb-4 pr-8">
          <p className="text-sm text-muted-foreground leading-relaxed">{a}</p>
        </div>
      )}
    </div>
  );
}

function FaqSection() {
  return (
    <section id="faq">
      <div className="flex items-center gap-2 mb-1">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">FAQ</div>
      </div>
      <h2 className="font-serif text-2xl font-bold mb-2">Frequently Asked Questions</h2>
      <p className="text-sm text-muted-foreground mb-8 max-w-2xl">
        Answers about the platform, data privacy, billing, and support.
      </p>
      <div className="space-y-8">
        {FAQ_CATEGORIES.map(cat => (
          <div key={cat.category}>
            <h3 className="text-xs font-semibold text-primary uppercase tracking-widest mb-1 pb-2 border-b border-primary/20">
              {cat.category}
            </h3>
            <div>
              {cat.items.map(item => (
                <FaqItem key={item.q} q={item.q} a={item.a} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function ResourcesPage() {
  useEffect(() => {
    // Auto-scroll to FAQ when navigated via /faq route
    if (window.location.hash.includes("/faq")) {
      const scrollToFaq = () => {
        const el = document.getElementById("faq");
        if (el) {
          el.scrollIntoView({ behavior: "smooth" });
        } else {
          // Retry if DOM not ready yet
          setTimeout(scrollToFaq, 100);
        }
      };
      setTimeout(scrollToFaq, 200);
    }
  }, []);

  return (
    <div className="min-h-screen bg-background">

      {/* Hero */}
      <section className="border-b border-border bg-gradient-to-br from-primary/8 via-transparent to-transparent">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
          <Badge variant="outline" className="mb-4 text-primary border-primary/30 bg-primary/5 font-medium">
            Resources
          </Badge>
          <h1 className="font-serif text-3xl sm:text-4xl font-bold tracking-tight mb-4 leading-tight">
            Clinical Laboratory Knowledge Base
          </h1>
          <p className="text-muted-foreground text-lg max-w-2xl leading-relaxed">
            Practical, regulation-backed guidance for lab directors and managers, written by a former Joint Commission Surveyor with 200+ facility inspections. No filler, no generic advice.
          </p>
        </div>
      </section>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12 space-y-14">

        {/* Featured article */}
        <section>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4">Featured Article</div>
          {articles.filter(a => a.featured).map(article => (
            <Link key={article.slug} href={`/resources/${article.slug}`}>
              <Card className="border-primary/20 hover:border-primary/40 hover:shadow-md transition-all cursor-pointer group">
                <CardContent className="p-6 sm:p-8">
                  <div className="flex flex-wrap gap-2 mb-3">
                    <Badge variant="outline" className="text-primary border-primary/30 bg-primary/5 text-xs">{article.category}</Badge>
                    {article.tags.slice(1).map(tag => (
                      <Badge key={tag} variant="outline" className="text-muted-foreground text-xs">{tag}</Badge>
                    ))}
                  </div>
                  <h2 className="font-serif text-xl sm:text-2xl font-bold mb-3 group-hover:text-primary transition-colors leading-tight">
                    {article.title}
                  </h2>
                  <p className="text-muted-foreground leading-relaxed mb-4 text-sm sm:text-base">
                    {article.summary}
                  </p>
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><User size={12} /> {article.author}</span>
                      <span className="flex items-center gap-1"><Clock size={12} /> {article.readTime}</span>
                      <span>{article.date}</span>
                    </div>
                    <Button size="sm" className="bg-primary text-primary-foreground text-xs">
                      Read Article <ChevronRight size={12} className="ml-1" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </section>

        {/* Free Downloads */}
        <section>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4">Free Downloads</div>
          <div className="grid sm:grid-cols-2 gap-3">
            {[
              {
                title: "VeritaCheck™ CLSI Compliance Matrix",
                desc: "One-page landscape reference mapping all 6 VeritaCheck™ study types to CLSI, CLIA (42 CFR), CAP, and TJC standards. Use this with inspectors to demonstrate regulatory alignment.",
                url: "/api/downloads/clsi-compliance-matrix",
                filename: "VeritaCheck_CLSI_Compliance_Matrix.pdf",
                icon: Shield,
              },
              {
                title: "VeritaCheck™ Software Validation Template",
                desc: "4-page fillable template to validate VeritaCheck™ for compliance documentation before placing it into service. Satisfies CAP GEN.20316, TJC QSA.15.01.01 EP1, and CLIA 42 CFR 493.1251.",
                url: "/api/downloads/software-validation-template",
                filename: "VeritaCheck_Software_Validation_Template.pdf",
                icon: CheckCircle2,
              },
            ].map(({ title, desc, url, filename, icon: Icon }) => (
              <Card key={title} className="border-primary/20 hover:border-primary/40 hover:shadow-md transition-all group">
                <CardContent className="p-5">
                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                      <Icon size={16} className="text-primary" />
                    </div>
                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5 mt-0.5">
                      Free Download
                    </span>
                  </div>
                  <div className="font-semibold text-sm mb-1.5 group-hover:text-primary transition-colors">{title}</div>
                  <p className="text-xs text-muted-foreground leading-relaxed mb-3">{desc}</p>
                  <a
                    href={url}
                    download={filename}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
                  >
                    <Download size={13} /> Download PDF
                  </a>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Tools */}
        <section>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4">Free Tools</div>
          <div className="grid sm:grid-cols-2 gap-3">
            {tools.map(({ slug, title, description, badge }) => (
              <Link key={slug} href={`/resources/${slug}`}>
                <Card className="hover:border-primary/40 hover:shadow-md transition-all cursor-pointer group h-full">
                  <CardContent className="p-5">
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <Search size={16} className="text-primary" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-sm group-hover:text-primary transition-colors">{title}</span>
                          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">{badge}</span>
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>

        {/* Second article */}
        {articles.filter(a => !a.featured).map(article => (
          <Link key={article.slug} href={`/resources/${article.slug}`}>
            <Card className="hover:border-primary/30 hover:shadow-sm transition-all cursor-pointer group">
              <CardContent className="p-5 sm:p-6">
                <div className="flex flex-wrap gap-2 mb-2">
                  <Badge variant="outline" className="text-primary border-primary/30 bg-primary/5 text-xs">{article.category}</Badge>
                </div>
                <h3 className="font-serif text-lg font-bold mb-2 group-hover:text-primary transition-colors leading-tight">{article.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed mb-3">{article.summary}</p>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><User size={11} /> {article.author}</span>
                  <span className="flex items-center gap-1"><Clock size={11} /> {article.readTime}</span>
                  <span>{article.date}</span>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}

        {/* Coming soon */}
        <section>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4">Coming Soon</div>
          <div className="grid sm:grid-cols-2 gap-3">
            {comingSoon.map(({ title, category }) => (
              <Card key={title} className="border-dashed border-border opacity-70">
                <CardContent className="p-4">
                  <Badge variant="outline" className="text-muted-foreground text-xs mb-2">{category}</Badge>
                  <p className="text-sm font-medium text-muted-foreground">{title}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* FAQ */}
        <FaqSection />

        {/* Newsletter */}
        <NewsletterSignup variant="card" source="resources-page" />

        {/* CTA */}
        <section className="rounded-2xl bg-primary text-primary-foreground p-8 text-center">
          <FlaskConical size={28} className="mx-auto mb-3 opacity-80" />
          <h2 className="font-serif text-xl font-bold mb-2">Put the knowledge to work.</h2>
          <p className="text-primary-foreground/80 text-sm max-w-md mx-auto mb-5">
            VeritaCheck runs the studies described in these articles automatically: calibration verification, method comparison, and EP15 precision verification, with CLIA-compliant PDF reports.
          </p>
          <Button asChild size="lg" className="bg-white text-primary hover:bg-white/90 font-semibold">
            <Link href="/veritacheck">Run a Free Study <ChevronRight size={15} className="ml-1" /></Link>
          </Button>
        </section>

      </div>
    </div>
  );
}
