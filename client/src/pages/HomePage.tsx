import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, Award, Users, Shield, BarChart3, FlaskConical, BookOpen, ExternalLink, CheckCircle2, Star } from "lucide-react";

const services = [
  { icon: Users, title: "Leadership Coaching", desc: "One-on-one coaching for lab directors and managers. You pick the topics — C-suite relationships, team development, career advancement." },
  { icon: Shield, title: "Inspection Readiness", desc: "Mock regulatory surveys simulating CLIA, TJC, CAP, COLA, and FDA inspections. Led by a former Joint Commission Surveyor with 200+ facility inspections." },
  { icon: BarChart3, title: "Productivity Analysis", desc: "Expert on-site assessment of workflows, staffing, and resources using industry benchmarks. Actionable reports with data-driven recommendations." },
  { icon: BookOpen, title: "Educational Webinars", desc: "Facility webinars on blood administration, QC/QA, delegation of authority, and lab survey preparation — tailored to your team's needs." },
  { icon: Award, title: "Interim Lab Director", desc: "Experienced interim Lab Administrative Directors who ensure uninterrupted operations and regulatory compliance during leadership transitions." },
  { icon: FlaskConical, title: "VeritaCheck — Lab Study Platform", desc: "Our new web-based EP evaluation tool — automated calibration verification and method comparison with CLIA-compliant PDF reports.", link: "/veritacheck", linkLabel: "Try VeritaCheck Free" },
];

const stats = [
  { value: "200+", label: "Facilities surveyed" },
  { value: "22 yrs", label: "Military leadership" },
  { value: "4 yrs", label: "Joint Commission surveyor" },
  { value: "CPHQ", label: "Healthcare quality certified" },
];

export default function HomePage() {
  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent pointer-events-none" />
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-20 sm:py-28">
          <div className="max-w-3xl">
            <Badge variant="outline" className="mb-5 text-primary border-primary/30 bg-primary/5 font-medium">
              Clinical Laboratory Consulting
            </Badge>
            <h1 className="font-serif text-4xl sm:text-5xl font-bold tracking-tight mb-5 leading-tight text-foreground">
              Your partner in laboratory excellence and regulatory compliance.
            </h1>
            <p className="text-lg text-muted-foreground mb-8 leading-relaxed max-w-2xl">
              Veritas Lab Services provides expert consulting in leadership coaching, productivity analysis, inspection readiness, and regulatory compliance — backed by over two decades of clinical laboratory and healthcare quality expertise.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button asChild size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold">
                <Link href="/contact">Tell Us About Your Needs <ChevronRight size={16} className="ml-1" /></Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link href="/services">View All Services</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="border-b border-border bg-card">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 grid grid-cols-2 sm:grid-cols-4 gap-6 text-center">
          {stats.map(({ value, label }) => (
            <div key={label}>
              <div className="text-2xl font-bold text-primary font-serif">{value}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Mission */}
      <section className="section-padding border-b border-border">
        <div className="container-default">
          <div className="grid sm:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="font-serif text-3xl font-bold mb-4">Our Mission</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                Veritas Lab Services' mission is to empower clinical laboratories by providing expert consulting in leadership coaching, comprehensive productivity analysis, and strategic regulatory readiness solutions, ensuring operational excellence and compliance with CLIA standards within every client organization.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Founded by Michael Veri — a US Army veteran, former Joint Commission Surveyor, and published author — VLS was built on the recognition that administrative lab leaders lacked accessible avenues for growth and mentorship.
              </p>
              <Button asChild variant="outline" className="mt-6">
                <Link href="/team">Meet Michael Veri <ChevronRight size={14} className="ml-1" /></Link>
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { icon: CheckCircle2, text: "CLIA standards expertise" },
                { icon: CheckCircle2, text: "TJC / CAP / COLA / FDA" },
                { icon: CheckCircle2, text: "Published author & speaker" },
                { icon: CheckCircle2, text: "CPHQ credential holder" },
                { icon: CheckCircle2, text: "200+ facility inspections" },
                { icon: CheckCircle2, text: "On-site & remote support" },
              ].map(({ icon: Icon, text }) => (
                <div key={text} className="flex items-center gap-2 text-sm">
                  <Icon size={15} className="text-primary shrink-0" />
                  <span>{text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Services */}
      <section className="section-padding border-b border-border bg-secondary/20">
        <div className="container-default">
          <div className="text-center mb-12">
            <h2 className="font-serif text-3xl font-bold mb-3">Available Services</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">From on-site inspections to digital EP analysis — comprehensive support for your laboratory.</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {services.map(({ icon: Icon, title, desc, link, linkLabel }) => (
              <Card key={title} className="border-border hover:border-primary/30 transition-colors group bg-card">
                <CardContent className="p-5">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center mb-3 text-primary group-hover:bg-primary/20 transition-colors">
                    <Icon size={18} />
                  </div>
                  <h3 className="font-semibold text-sm mb-2">{title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed mb-3">{desc}</p>
                  {link && (
                    <Button asChild size="sm" variant="outline" className="text-xs h-7 border-primary/30 text-primary hover:bg-primary/10">
                      <Link href={link}>{linkLabel} →</Link>
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="text-center mt-8">
            <Button asChild variant="outline">
              <Link href="/services">See Full Service Details <ChevronRight size={14} className="ml-1" /></Link>
            </Button>
          </div>
        </div>
      </section>

      {/* VeritaCheck CTA banner */}
      <section className="section-padding border-b border-border bg-primary/5">
        <div className="container-default text-center">
          <div className="inline-flex items-center gap-2 bg-primary/10 text-primary rounded-full px-4 py-1.5 text-sm font-semibold mb-4">
            <FlaskConical size={14} />
            New Tool — VeritaCheck
          </div>
          <h2 className="font-serif text-3xl font-bold mb-3">The studies your lab has always run — finally done right.</h2>
          <p className="text-muted-foreground max-w-2xl mx-auto mb-6 leading-relaxed">
            Calibration verification and method comparison, automated and browser-based. CLIA-compliant PDF reports with scatter plots, percent recovery charts, and pass/fail evaluation — no desktop software required.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button asChild size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold">
              <Link href="/veritacheck">Try VeritaCheck Free <ChevronRight size={16} className="ml-1" /></Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/veritacheck#pricing">See Pricing</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Publications */}
      <section className="section-padding">
        <div className="container-default">
          <h2 className="font-serif text-2xl font-bold mb-6 text-center">Published Work</h2>
          <div className="grid sm:grid-cols-2 gap-4 max-w-3xl mx-auto">
            {[
              { title: "Co-Own Blood Administration Among Lab, Nursing and Providers", url: "https://www.medlabmag.com/article/2195" },
              { title: "Laboratory Leadership's View of Accreditation", url: "https://www.medlabmag.com/article/1766" },
              { title: "Forming a Blood Utilization and Management Program", url: "https://www.medlabmag.com/article/1732" },
              { title: "Capturing Productivity in the Laboratory", url: "https://www.medlabmag.com/article/1575" },
            ].map(({ title, url }) => (
              <a key={url} href={url} target="_blank" rel="noopener noreferrer"
                className="flex items-start gap-3 p-4 rounded-lg border border-border hover:border-primary/30 hover:bg-secondary/50 transition-colors group">
                <Star size={14} className="text-primary mt-0.5 shrink-0" />
                <span className="text-sm font-medium group-hover:text-primary transition-colors">{title}</span>
                <ExternalLink size={12} className="shrink-0 mt-0.5 text-muted-foreground ml-auto" />
              </a>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
