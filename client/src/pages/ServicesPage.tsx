import { useSEO } from "@/hooks/useSEO";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ChevronRight,
  Users,
  Shield,
  BarChart3,
  Mic,
  Building2,
  Stethoscope,
  FlaskConical,
  Award,
  MapPin,
  Calendar,
  BookOpen,
} from "lucide-react";

// Services page redesign (2026-05-30):
// The page now leads with the founder's TJC Laboratory Surveyor
// credential rather than the VeritaAssure suite badge, surfaces
// price ranges so prospects can self-qualify, and adds a "Who
// you'll be working with" section so consulting buyers are
// hiring a named individual rather than a brand.
//
// Pricing ranges below are STARTING POINTS for the operator to
// adjust before final ship. Conservative anchors based on
// public market rates for clinical-lab consulting; the operator
// has the final word.

const serviceGroups = [
  {
    heading: "Regulatory Readiness and Mock Inspections",
    leadIn:
      "We provide structured regulatory reviews and mock inspections that mirror real survey conditions, so your team identifies and corrects issues before they become findings.",
    services: [
      {
        icon: Shield,
        category: "On-Site",
        title: "On-Site Inspection Readiness",
        duration: "2 days on-site, written report within 14 days",
        pricing: "$12,000 to $18,000 typical engagement",
        description:
          "An on-site mock inspection service for laboratory management, a realistic, supportive simulation of a regulatory survey experience, guiding laboratories through the inspection process and fostering team confidence for official inspections.",
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
    leadIn:
      "Our on-site assessments connect operational performance with regulatory expectations, helping you optimize staffing, processes, and turnaround times without compromising compliance.",
    services: [
      {
        icon: BarChart3,
        category: "On-Site",
        title: "Productivity Analysis",
        duration: "1 to 3 days on-site, plus written report",
        pricing: "$5,000 to $12,000 per engagement",
        description:
          "Unlock the full potential of your laboratory with expert on-site productivity analysis. Our specialists assess workflows and resources using industry-standard benchmarks to pinpoint hidden inefficiencies.",
        details: [
          "Industry-standard benchmarking of staffing and workflows",
          "Identification of inefficiencies from staffing gaps, outdated processes, or resource misallocation",
          "Customized analysis reports with clear, actionable recommendations",
          "C-suite communication support: data-driven staffing rationales",
          "Authored by Michael Veri, MS, MBA, MLS(ASCP), CPHQ, author of Lab Management 101: A Guide to Laboratory Leadership",
        ],
        cta: "Start a productivity analysis",
      },
    ],
  },
  {
    heading: "Leadership Coaching and Education",
    leadIn:
      "We coach lab leaders and frontline staff on how to think like surveyors, communicate with administration, and build a culture where compliance is sustainable, not reactive.",
    services: [
      {
        icon: Users,
        category: "Coaching",
        title: "Leadership Coaching",
        duration: "1 hour sessions, single or 10-session blocks",
        pricing: "$400 to $600 per session, or $4,000 for a 10-session block",
        description:
          "VLS offers coaching services to laboratory leaders. You pick the topics, whether improving your lab, C-suite relationships, or learning how to advance into laboratory leadership.",
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
        duration: "1 hour live, recording optional",
        pricing: "$2,500 to $7,500 per webinar, custom topics included",
        description:
          "Interactive online sessions led by published experts covering a full spectrum of laboratory and hospital topics, tailored to specific educational needs.",
        details: [
          "Blood administration (co-ownership with Lab, Nursing, and Providers)",
          "QC and QA review and implementation",
          "Delegation of authority",
          "Introduction to Lab Survey Process for Nursing",
          "Custom topics upon request, researched and tailored to your team",
        ],
        cta: "Request a webinar",
      },
    ],
  },
  {
    heading: "CLIA Laboratory Director Services",
    leadIn:
      "Our CLIA Laboratory Director services provide the oversight, documentation, and day-to-day collaboration your lab needs to satisfy regulatory requirements at every level.",
    services: [
      {
        icon: Building2,
        category: "Administrative",
        title: "Interim Lab Administrative Director",
        duration: "90-day minimum, ongoing as needed",
        pricing: "$15,000 to $25,000 per month",
        description:
          "Comprehensive support during laboratory leadership transitions with experienced interim Lab Administrative Directors who ensure uninterrupted operations and regulatory compliance.",
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
        title: "Moderate Complexity Lab Medical Director or Designee",
        duration: "Ongoing, 6-month minimum",
        pricing: "Starting at $5,500 per month",
        description:
          "Stay CLIA compliant with one of our available CLIA laboratory medical directors or designees. Remote and on-site oversight so your laboratory remains compliant and delivers consistently reliable results.",
        details: [
          "Full CLIA medical director or designee responsibilities",
          "Staff oversight and quality assurance programs",
          "Regulatory reviews and compliance maintenance",
          "Remote and on-site oversight options",
          "Qualified for all phases of moderate-complexity testing",
        ],
        cta: "Inquire about availability",
      },
    ],
  },
];

export default function ServicesPage() {
  useSEO({
    title:
      "Services | Veritas Lab Services Laboratory Consulting",
    description:
      "Laboratory consulting led by Michael Veri, MS, MBA, MLS(ASCP), CPHQ, former TJC Laboratory Surveyor with 200+ surveys conducted nationally. Mock inspections, productivity analysis, CLIA director coverage, and leadership coaching.",
  });
  return (
    <div>
      {/* ─── Hero: TJC surveyor credential leads ──────────────────── */}
      <section className="border-b border-border bg-secondary/20">
        <div className="container-default py-14">
          <Badge variant="outline" className="mb-4 text-primary border-primary/30">
            Laboratory Consulting
          </Badge>
          <h1 className="font-serif text-4xl font-bold mb-3">
            Laboratory Consulting from a Former TJC Surveyor
          </h1>
          <p className="text-muted-foreground text-lg max-w-2xl leading-relaxed mb-4">
            Led by Michael Veri, MS, MBA, MLS(ASCP), CPHQ. Former TJC Laboratory
            Surveyor with over 200 surveys conducted nationally, former
            clinical laboratory director of 12 years, and author of Lab
            Management 101.
          </p>
          <p className="text-muted-foreground text-base max-w-2xl leading-relaxed">
            Compliance is not a once-a-year event. It is the daily discipline
            of running a laboratory that can withstand scrutiny at any moment.
            Our consulting services exist because the gap between clinical
            training and compliance responsibility is real, and most lab
            professionals navigate it alone.
          </p>
        </div>
      </section>

      {/* ─── Who you'll be working with ───────────────────────────── */}
      <section className="section-padding border-b border-border">
        <div className="container-default">
          <h2 className="font-serif text-2xl font-bold mb-6">
            Who you will be working with
          </h2>
          <div className="grid sm:grid-cols-3 gap-8">
            {/* Photo column: 900x991 portrait, served from /public */}
            <div>
              <img
                src="/michael-veri.jpg"
                alt="Michael Veri, MS, MBA, MLS(ASCP), CPHQ"
                className="w-full aspect-[3/4] object-cover rounded-lg border border-border shadow-sm"
                width={900}
                height={991}
                loading="lazy"
                data-testid="bio-photo"
              />
            </div>
            <div className="sm:col-span-2 space-y-4">
              <p className="text-muted-foreground leading-relaxed">
                Michael Veri spent 12 years as a clinical laboratory director
                before becoming a TJC Laboratory Surveyor, where he conducted
                over 200 surveys at hospitals, reference laboratories, and
                outpatient centers across the country. He is a US Army retiree.
                He holds an MS, an MBA, MLS(ASCP) certification, and the
                Certified Professional in Healthcare Quality credential.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Every engagement is delivered personally. You are hiring a
                practitioner who has stood on both sides of the survey, not a
                brand. Whether the work is a mock TJC inspection ahead of your
                next visit, a productivity analysis that has to defend its
                staffing rationale to your CFO, or interim director coverage
                while you search, you have direct access to a peer who has run
                the bench, sat in the director's chair, and asked the
                surveyor's questions for a living.
              </p>
              <div className="grid sm:grid-cols-2 gap-3 pt-2">
                <div className="flex items-center gap-2">
                  <Award size={16} className="text-primary shrink-0" />
                  <span className="text-sm">
                    200+ TJC surveys conducted nationally
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Building2 size={16} className="text-primary shrink-0" />
                  <span className="text-sm">
                    12 years as a clinical laboratory director
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <BookOpen size={16} className="text-primary shrink-0" />
                  <span className="text-sm">
                    Author, Lab Management 101: A Guide to Laboratory
                    Leadership
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Shield size={16} className="text-primary shrink-0" />
                  <span className="text-sm">US Army retiree</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Services ──────────────────────────────────────────────── */}
      <section className="section-padding">
        <div className="container-default space-y-10">
          <div className="mb-2">
            <h2 className="font-serif text-3xl font-bold mb-2">
              Engagements
            </h2>
            <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">
              Pricing ranges shown reflect typical engagement sizes. Final
              scope is set during a no-cost 30-minute scoping call.
            </p>
          </div>
          {serviceGroups.map(({ heading, leadIn, services: groupServices }) => (
            <div key={heading} className="space-y-6">
              <div className="mb-2">
                <h3 className="font-serif text-2xl font-bold mb-1">
                  {heading}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
                  {leadIn}
                </p>
              </div>
              {groupServices.map(
                ({
                  icon: Icon,
                  category,
                  title,
                  duration,
                  pricing,
                  description,
                  details,
                  cta,
                }) => (
                  <Card key={title} className="border-border">
                    <CardContent className="p-6">
                      <div className="grid sm:grid-cols-3 gap-6">
                        <div className="sm:col-span-2">
                          <div className="flex items-center gap-2 mb-3">
                            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
                              <Icon size={16} />
                            </div>
                            <Badge variant="secondary" className="text-xs">
                              {category}
                            </Badge>
                          </div>
                          <h4 className="font-serif text-xl font-bold mb-2">
                            {title}
                          </h4>
                          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                            {description}
                          </p>
                          <ul className="space-y-1.5">
                            {details.map((d) => (
                              <li
                                key={d}
                                className="flex items-start gap-2 text-sm"
                              >
                                <span className="text-primary mt-0.5 shrink-0">
                                  →
                                </span>
                                <span>{d}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div className="flex flex-col justify-between border-l border-border pl-6">
                          <div className="space-y-3">
                            <div>
                              <div className="text-xs text-muted-foreground">
                                Duration
                              </div>
                              <div className="font-medium text-sm">
                                {duration}
                              </div>
                            </div>
                            <div>
                              <div className="text-xs text-muted-foreground">
                                Pricing
                              </div>
                              <div className="font-semibold text-sm text-primary">
                                {pricing}
                              </div>
                            </div>
                          </div>
                          <Button
                            asChild
                            className="mt-4 bg-primary hover:bg-primary/90 text-primary-foreground"
                            size="sm"
                          >
                            <Link href="/contact">
                              {cta}{" "}
                              <ChevronRight size={13} className="ml-1" />
                            </Link>
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ─── Engagement process and availability ──────────────────── */}
      <section className="section-padding border-t border-border bg-secondary/20">
        <div className="container-default">
          <h2 className="font-serif text-2xl font-bold mb-6">
            How an engagement starts
          </h2>
          <div className="grid sm:grid-cols-3 gap-6">
            <Card className="border-border">
              <CardContent className="p-6">
                <Calendar size={20} className="text-primary mb-3" />
                <h3 className="font-serif font-bold mb-2">
                  No-cost scoping call
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Thirty minutes by phone or video. We confirm whether the
                  engagement fits, identify the right scope, and give you a
                  clear price before any paper changes hands.
                </p>
              </CardContent>
            </Card>
            <Card className="border-border">
              <CardContent className="p-6">
                <Shield size={20} className="text-primary mb-3" />
                <h3 className="font-serif font-bold mb-2">
                  Written scope and fixed price
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Every engagement has a signed scope document with deliverables
                  and a fixed price, so your purchasing team is not waiting on
                  hourly invoices. No scope creep, no surprises.
                </p>
              </CardContent>
            </Card>
            <Card className="border-border">
              <CardContent className="p-6">
                <MapPin size={20} className="text-primary mb-3" />
                <h3 className="font-serif font-bold mb-2">
                  Availability
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Currently accepting engagements nationally. Typical lead time
                  for on-site work is 4 to 6 weeks. Remote oversight roles can
                  start within 2 weeks. Expedited engagements available for
                  imminent survey visits.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* ─── Software suite (kept, repositioned smaller) ──────────── */}
      <section className="section-padding">
        <div className="container-default">
          <h2 className="font-serif text-2xl font-bold mb-2">
            Tools we use in engagements
          </h2>
          <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed mb-6">
            Veritas Lab Services also publishes the VeritaAssure™ software
            suite, the same tools we use during consulting engagements. Labs
            that hire us for a mock survey or a productivity analysis often
            license the suite afterward to maintain the work in-house.
          </p>
          <Card className="border-2 border-primary/30 bg-primary/5">
            <CardContent className="p-6">
              <div className="grid sm:grid-cols-3 gap-6">
                <div className="sm:col-span-2">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center text-primary shrink-0">
                      <FlaskConical size={16} />
                    </div>
                    <Badge className="text-xs bg-primary text-primary-foreground">
                      VeritaAssure™ Suite
                    </Badge>
                  </div>
                  <h3 className="font-serif text-xl font-bold mb-2">
                    VeritaCheck™ and the VeritaAssure™ Suite
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                    Performance verification with the regulatory determination
                    and CFR citation written into the report, plus inventory,
                    competency, policy, and operations modules. Director
                    signature on page one, retained for the life of your
                    account plus two years if you ever cancel.
                  </p>
                  <ul className="space-y-1.5">
                    {[
                      "Calibration Verification / Linearity, Correlation / Method Comparison, Precision Verification, Reagent Lot Verification",
                      "Slope, intercept, R², proportional bias, CLIA TEa presets for major analytes",
                      "Director-signable PDFs with the CFR citation in the narrative",
                      "Cloud-hosted, no install, no IT review required",
                      "Studies retained for the life of the account plus two years",
                    ].map((d) => (
                      <li
                        key={d}
                        className="flex items-start gap-2 text-sm"
                      >
                        <span className="text-primary mt-0.5 shrink-0">
                          →
                        </span>
                        <span>{d}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex flex-col justify-between border-l border-border pl-6">
                  <div className="space-y-3">
                    <div>
                      <div className="text-xs text-muted-foreground">
                        Per Study
                      </div>
                      <div className="font-bold text-xl text-primary">$25</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">
                        VeritaCheck™ Unlimited
                      </div>
                      <div className="font-bold text-xl text-primary">
                        $299
                        <span className="text-sm font-normal text-muted-foreground">
                          /yr Y1
                        </span>
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">
                        Full Suite
                      </div>
                      <div className="font-bold text-xl text-primary">
                        from $999
                        <span className="text-sm font-normal text-muted-foreground">
                          /yr
                        </span>
                      </div>
                    </div>
                  </div>
                  <Button
                    asChild
                    className="mt-4 bg-primary hover:bg-primary/90 text-primary-foreground"
                    size="sm"
                  >
                    <Link href="/veritacheck">
                      Explore the Suite{" "}
                      <ChevronRight size={13} className="ml-1" />
                    </Link>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ─── Closing CTA ──────────────────────────────────────────── */}
      <section className="section-padding border-t border-border bg-secondary/20">
        <div className="container-default text-center max-w-3xl">
          <h2 className="font-serif text-3xl font-bold mb-4">
            Start with a 30-minute scoping call
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            No-cost, no obligation. We confirm whether the engagement is the
            right fit, identify the scope, and give you a clear price before
            you commit. If we are not the right team for your work, we will
            tell you who is.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-8">
            <Button
              asChild
              size="lg"
              className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
            >
              <Link href="/contact">Schedule a scoping call</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/veritacheck">Explore the software suite</Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
