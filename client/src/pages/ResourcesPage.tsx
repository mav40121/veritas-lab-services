import { useSEO } from "@/hooks/useSEO";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronRight, Clock, FlaskConical, User, Search, Download, Shield, CheckCircle2 } from "lucide-react";
import { NewsletterSignup } from "@/components/NewsletterSignup";

const articles = [
  {
    slug: "how-veritaassure-trains-lab-leaders",
    title: "How VeritaAssure™ Trains the Next Generation of Lab Leaders",
    summary: "Most lab directors learn compliance the hard way. VeritaAssure™ changes that. Here is how the modules work as a leadership development curriculum.",
    category: "Leadership Development",
    readTime: "14 min read",
    author: "Michael Veri",
    date: "March 2026",
    tags: ["Leadership Development", "Lab Director", "CLIA", "VeritaAssure™"],
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
    title: "How to Validate VeritaCheck™ for Your Clinical Laboratory",
    summary: "A step-by-step guide to completing IQ/OQ/PQ software validation for VeritaCheck™, with a free downloadable template. Most labs finish in under two hours.",
    category: "Software Validation",
    readTime: "8 min read",
    author: "Michael Veri",
    date: "April 2026",
    tags: ["Software Validation", "IQ/OQ/PQ", "CLIA 493.1251", "CAP"],
    featured: false,
  },
  {
    slug: "laboratory-inventory-management",
    title: "Laboratory Inventory Management: Stop Guessing, Start Using the Math",
    summary: "Most labs manage inventory by feel. This guide covers the reorder point formula, burn rate, lead time, safety stock, and standing order discipline - the system that prevents stockouts without overspending.",
    category: "Lab Operations",
    readTime: "10 min read",
    author: "Michael Veri",
    date: "April 2026",
    tags: ["Inventory Management", "Lab Operations", "Par Level", "Supply Chain"],
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

export default function ResourcesPage() {

    useSEO({ title: "Resources | CLIA Compliance Guides for Clinical Laboratories", description: "Free guides and articles on CLIA compliance, method verification, calibration verification, proficiency testing, and laboratory inspection preparation." });
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

        {/* Newsletter */}
        <NewsletterSignup variant="card" source="resources-page" />

        {/* CTA */}
        <section className="rounded-2xl bg-primary text-primary-foreground p-8 text-center">
          <FlaskConical size={28} className="mx-auto mb-3 opacity-80" />
          <h2 className="font-serif text-xl font-bold mb-2">Put the knowledge to work.</h2>
          <p className="text-primary-foreground/80 text-sm max-w-md mx-auto mb-5">
            VeritaCheck™ runs the studies described in these articles automatically: calibration verification, method comparison, and EP15 precision verification, with CLIA-compliant PDF reports.
          </p>
          <Button asChild size="lg" className="bg-white text-primary hover:bg-white/90 font-semibold">
            <Link href="/veritacheck">Run a Free Study <ChevronRight size={15} className="ml-1" /></Link>
          </Button>
        </section>

      </div>
    </div>
  );
}
