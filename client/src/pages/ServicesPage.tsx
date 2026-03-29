import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, Users, Shield, BarChart3, Mic, Building2, Stethoscope, FlaskConical } from "lucide-react";

const serviceGroups = [
  {
    heading: "Regulatory Readiness and Mock Inspections",
    leadIn: "We provide structured regulatory reviews and mock inspections that mirror real survey conditions, so your team identifies and corrects issues before they become findings.",
    services: [
      {
        icon: Shield,
        category: "On-Site",
        title: "On-Site Inspection Readiness",
        duration: "24 hrs",
        pricing: "Project Based",
        description: "An on-site mock inspection service for laboratory management — a realistic, supportive simulation of a regulatory survey experience, guiding laboratories through the inspection process and fostering team confidence for official inspections.",
        details: [
          "Expert-led walkthrough emulating real regulatory inspections (CLIA, TJC, CAP, COLA, FDA)",
          "Detailed review of policies, procedures, and quality documentation",
          "Hands-on staff education and direct troubleshooting",
          "Workflow optimization and regulatory compliance review",
          "Post-survey written report with findings and recommendations",
        ],
        cta: "Discuss your lab's scope",
      },
    ],
  },
  {
    heading: "Productivity and Workflow Optimization",
    leadIn: "Our on-site assessments connect operational performance with regulatory expectations — helping you optimize staffing, processes, and turnaround times without compromising compliance.",
    services: [
      {
        icon: BarChart3,
        category: "On-Site",
        title: "Productivity Analysis",
        duration: "1 hr+",
        pricing: "Project Based",
        description: "Unlock the full potential of your laboratory with expert on-site productivity analysis. Our specialists assess workflows and resources using industry-standard benchmarks to pinpoint hidden inefficiencies.",
        details: [
          "Industry-standard benchmarking of staffing and workflows",
          "Identification of inefficiencies from staffing gaps, outdated processes, or resource misallocation",
          "Customized analysis reports with clear, actionable recommendations",
          "C-suite communication support — data-driven staffing rationales",
          "Authored by Michael Veri, author of \"Capturing Productivity in the Laboratory\"",
        ],
        cta: "Start a productivity analysis",
      },
    ],
  },
  {
    heading: "Leadership Coaching and Education",
    leadIn: "We coach lab leaders and frontline staff on how to think like surveyors, communicate with administration, and build a culture where compliance is sustainable, not reactive.",
    services: [
      {
        icon: Users,
        category: "Coaching",
        title: "Leadership Coaching",
        duration: "1 hr sessions",
        pricing: "Email us!",
        description: "VLS offers coaching services to laboratory leaders. You pick the topics — whether improving your lab, C-suite relationships, or learning how to advance into laboratory leadership.",
        details: [
          "Single 1-hour sessions or blocks of 10",
          "Topics entirely chosen by you",
          "C-suite relationship building and communication",
          "Laboratory leadership career development",
          "Mentorship for directors and managers who are the most senior in their organizations",
        ],
        cta: "Book a session",
      },
      {
        icon: Mic,
        category: "Education",
        title: "Educational Webinars",
        duration: "1 hr",
        pricing: "Project Based",
        description: "Interactive online sessions led by published experts covering a full spectrum of laboratory and hospital topics, tailored to specific educational needs.",
        details: [
          "Blood administration (co-ownership with Lab, Nursing, and Providers)",
          "QC/QA review and implementation",
          "Delegation of authority",
          "Introduction to Lab Survey Process for Nursing",
          "Custom topics upon request — researched and tailored to your team",
        ],
        cta: "Request a webinar",
      },
    ],
  },
  {
    heading: "CLIA Laboratory Director Services",
    leadIn: "Our CLIA Laboratory Director services provide the oversight, documentation, and day-to-day collaboration your lab needs to satisfy regulatory requirements at every level.",
    services: [
      {
        icon: Building2,
        category: "Administrative",
        title: "Interim Lab Administrative Director",
        duration: "Variable",
        pricing: "Project Based",
        description: "Comprehensive support during laboratory leadership transitions with experienced interim Lab Administrative Directors who ensure uninterrupted operations and regulatory compliance.",
        details: [
          "Uninterrupted laboratory operations during transition",
          "Regulatory compliance maintenance",
          "Staff stability and morale management",
          "Expert guidance and operational improvements",
          "Full documentation and transition handoff",
        ],
        cta: "Discuss placement",
      },
      {
        icon: Stethoscope,
        category: "Compliance",
        title: "Moderate Complexity Lab Medical Director",
        duration: "Ongoing",
        pricing: "Starting at $3,500/month",
        description: "Stay CLIA compliant with one of our available CLIA laboratory directors. Remote and on-site oversight so your laboratory remains compliant and delivers consistently reliable results.",
        details: [
          "Full CLIA medical director responsibilities",
          "Staff oversight and quality assurance programs",
          "Regulatory reviews and compliance maintenance",
          "Remote and on-site oversight options",
          "Qualified for all phases of lab testing",
        ],
        cta: "Inquire about availability",
      },
    ],
  },
];

export default function ServicesPage() {
  return (
    <div>
      {/* Header */}
      <section className="border-b border-border bg-secondary/20">
        <div className="container-default py-14">
          <Badge variant="outline" className="mb-4 text-primary border-primary/30">VeritaAssure Suite</Badge>
          <h1 className="font-serif text-4xl font-bold mb-3">Laboratory Consulting Services</h1>
          <p className="text-muted-foreground text-lg max-w-2xl leading-relaxed">
            Veritas Lab Services delivers VeritaAssure — integrated support for regulatory readiness, mock inspections, productivity analysis, leadership coaching, and CLIA laboratory director services. Our approach combines on-site expertise with practical compliance tools so your lab stays ahead of CLIA, CAP, COLA, TJC, and FDA expectations year-round, not just right before surveyors arrive.
          </p>
        </div>
      </section>

      {/* Services */}
      <section className="section-padding">
        <div className="container-default space-y-10">
          {serviceGroups.map(({ heading, leadIn, services: groupServices }) => (
            <div key={heading} className="space-y-6">
              <div className="mb-2">
                <h2 className="font-serif text-2xl font-bold mb-1">{heading}</h2>
                <p className="text-xs text-primary font-semibold uppercase tracking-wide mb-2">Part of the VeritaAssure suite</p>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">{leadIn}</p>
              </div>
              {groupServices.map(({ icon: Icon, category, title, duration, pricing, description, details, cta }) => (
                <Card key={title} className="border-border">
                  <CardContent className="p-6">
                    <div className="grid sm:grid-cols-3 gap-6">
                      <div className="sm:col-span-2">
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
                            <Icon size={16} />
                          </div>
                          <Badge variant="secondary" className="text-xs">{category}</Badge>
                        </div>
                        <h3 className="font-serif text-xl font-bold mb-2">{title}</h3>
                        <p className="text-sm text-muted-foreground leading-relaxed mb-4">{description}</p>
                        <ul className="space-y-1.5">
                          {details.map(d => (
                            <li key={d} className="flex items-start gap-2 text-sm">
                              <span className="text-primary mt-0.5 shrink-0">→</span>
                              <span>{d}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div className="flex flex-col justify-between border-l border-border pl-6">
                        <div className="space-y-3">
                          <div>
                            <div className="text-xs text-muted-foreground">Duration</div>
                            <div className="font-medium text-sm">{duration}</div>
                          </div>
                          <div>
                            <div className="text-xs text-muted-foreground">Pricing</div>
                            <div className="font-semibold text-sm text-primary">{pricing}</div>
                          </div>
                        </div>
                        <Button asChild className="mt-4 bg-primary hover:bg-primary/90 text-primary-foreground" size="sm">
                          <Link href="/contact">{cta} <ChevronRight size={13} className="ml-1" /></Link>
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ))}

          {/* VeritaCheck card */}
          <Card className="border-2 border-primary/30 bg-primary/5">
            <CardContent className="p-6">
              <div className="grid sm:grid-cols-3 gap-6">
                <div className="sm:col-span-2">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center text-primary shrink-0">
                      <FlaskConical size={16} />
                    </div>
                    <Badge className="text-xs bg-primary text-primary-foreground">VeritaAssure Tool</Badge>
                  </div>
                  <h3 className="font-serif text-xl font-bold mb-2">VeritaCheck™ — Lab Study Platform</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed mb-4">Automated calibration verification and method comparison studies with CLIA-compliant PDF reports. Scatter plots, percent recovery charts, pass/fail evaluation — all in under 60 seconds.</p>
                  <ul className="space-y-1.5">
                    {["Calibration verification (linearity)", "Method comparison (up to 3 instruments)", "Slope, intercept, R², proportional bias", "CLIA TEa presets for major analytes", "Professional PDF report — printable and signable"].map(d => (
                      <li key={d} className="flex items-start gap-2 text-sm"><span className="text-primary mt-0.5 shrink-0">→</span><span>{d}</span></li>
                    ))}
                  </ul>
                </div>
                <div className="flex flex-col justify-between border-l border-border pl-6">
                  <div className="space-y-3">
                    <div><div className="text-xs text-muted-foreground">Per Study</div><div className="font-bold text-xl text-primary">$25</div></div>
                    <div><div className="text-xs text-muted-foreground">Starter</div><div className="font-bold text-xl text-primary">$299<span className="text-sm font-normal text-muted-foreground">/yr</span></div></div>
                  </div>
                  <Button asChild className="mt-4 bg-primary hover:bg-primary/90 text-primary-foreground" size="sm">
                    <Link href="/veritacheck">Try VeritaCheck™ Free <ChevronRight size={13} className="ml-1" /></Link>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Why VeritaAssure */}
      <section className="section-padding border-t border-border bg-secondary/20">
        <div className="container-default text-center max-w-3xl">
          <h2 className="font-serif text-3xl font-bold mb-4">Why VeritaAssure</h2>
          <p className="text-muted-foreground leading-relaxed">
            Laboratory compliance isn't a one-time event. VeritaAssure is built on the belief that inspection readiness should be a permanent state — not a sprint. Whether you engage us for a single mock survey or an ongoing partnership, every service we deliver is designed to leave your lab more prepared, more documented, and more confident than when we arrived.
          </p>
        </div>
      </section>
    </div>
  );
}
