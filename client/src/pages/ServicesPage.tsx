import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, Users, Shield, BarChart3, Mic, Building2, Stethoscope, FlaskConical } from "lucide-react";

const services = [
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
];

export default function ServicesPage() {
  return (
    <div>
      {/* Header */}
      <section className="border-b border-border bg-secondary/20">
        <div className="container-default py-14">
          <Badge variant="outline" className="mb-4 text-primary border-primary/30">How We Can Help</Badge>
          <h1 className="font-serif text-4xl font-bold mb-3">Laboratory Consulting Services</h1>
          <p className="text-muted-foreground text-lg max-w-2xl leading-relaxed">
            Expert-led solutions for clinical laboratories — from on-site inspections and coaching to digital EP analysis tools.
          </p>
        </div>
      </section>

      {/* Services */}
      <section className="section-padding">
        <div className="container-default space-y-6">
          {services.map(({ icon: Icon, category, title, duration, pricing, description, details, cta }) => (
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
                    <h2 className="font-serif text-xl font-bold mb-2">{title}</h2>
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

          {/* VeritaCheck card */}
          <Card className="border-2 border-primary/30 bg-primary/5">
            <CardContent className="p-6">
              <div className="grid sm:grid-cols-3 gap-6">
                <div className="sm:col-span-2">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center text-primary shrink-0">
                      <FlaskConical size={16} />
                    </div>
                    <Badge className="text-xs bg-primary text-primary-foreground">New Tool</Badge>
                  </div>
                  <h2 className="font-serif text-xl font-bold mb-2">VeritaCheck — Lab Study Platform</h2>
                  <p className="text-sm text-muted-foreground leading-relaxed mb-4">Automated calibration verification and method comparison studies with CLIA-compliant PDF reports. Scatter plots, percent recovery charts, pass/fail evaluation — all in under 60 seconds.</p>
                  <ul className="space-y-1.5">
                    {["Calibration verification (linearity)", "Method comparison (up to 3 instruments)", "Slope, intercept, R², proportional bias", "CLIA TEa presets for major analytes", "Professional PDF report — printable and signable"].map(d => (
                      <li key={d} className="flex items-start gap-2 text-sm"><span className="text-primary mt-0.5 shrink-0">→</span><span>{d}</span></li>
                    ))}
                  </ul>
                </div>
                <div className="flex flex-col justify-between border-l border-border pl-6">
                  <div className="space-y-3">
                    <div><div className="text-xs text-muted-foreground">Per Study</div><div className="font-bold text-xl text-primary">$9</div></div>
                    <div><div className="text-xs text-muted-foreground">Annual Unlimited</div><div className="font-bold text-xl text-primary">$149<span className="text-sm font-normal text-muted-foreground">/yr</span></div></div>
                  </div>
                  <Button asChild className="mt-4 bg-primary hover:bg-primary/90 text-primary-foreground" size="sm">
                    <Link href="/veritacheck">Try VeritaCheck Free <ChevronRight size={13} className="ml-1" /></Link>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
