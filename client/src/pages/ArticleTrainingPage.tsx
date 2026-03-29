import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, ChevronRight, Clock, FlaskConical, User, ExternalLink } from "lucide-react";
import { NewsletterSignup } from "@/components/NewsletterSignup";

export default function ArticleTrainingPage() {
  return (
    <div className="min-h-screen bg-background">

      {/* Header */}
      <section className="border-b border-border bg-gradient-to-br from-primary/5 via-transparent to-transparent">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
            <Link href="/resources" className="hover:text-primary transition-colors">Resources</Link>
            <span>/</span>
            <span>Leadership Development</span>
          </div>
          <Badge variant="outline" className="mb-4 text-primary border-primary/30 bg-primary/5">Leadership Development</Badge>
          <h1 className="font-serif text-3xl sm:text-4xl font-bold tracking-tight mb-4 leading-tight">
            How VeritaAssure Trains the Next Generation of Lab Leaders
          </h1>
          <p className="text-muted-foreground text-lg leading-relaxed mb-6">
            Most lab directors learn compliance the hard way. VeritaAssure changes that. Here is how the modules work as a leadership development curriculum.
          </p>
          <div className="flex items-center gap-5 text-xs text-muted-foreground border-t border-border pt-4">
            <span className="flex items-center gap-1.5"><User size={12} /> Michael Veri, MBA, MS, CPHQ, MLS(ASCP)</span>
            <span className="flex items-center gap-1.5"><Clock size={12} /> 14 min read</span>
            <span>March 2026</span>
          </div>
        </div>
      </section>

      {/* Article body */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">

        {/* Key Takeaways */}
        <Card className="border-primary/20 bg-primary/5 mb-10">
          <CardContent className="p-5">
            <div className="font-semibold text-sm text-primary mb-3">Key Takeaways</div>
            <ul className="space-y-2">
              {[
                "Each VeritaAssure module teaches the regulatory framework it operates within, not just how to fill out forms",
                "New directors can build institutional knowledge in their first 90 days using a structured five-module path",
                "Health systems can use VeritaAssure as a shared training environment across multiple labs and supervisors",
                "Lab Management 101 (the book) and VeritaAssure (the software) form a complete leadership curriculum",
                "The documentation produced during training is real and audit-ready, not a separate exercise",
              ].map(t => (
                <li key={t} className="flex items-start gap-2 text-sm">
                  <CheckCircle2 size={13} className="text-primary shrink-0 mt-0.5" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* Prose */}
        <div className="prose prose-slate dark:prose-invert max-w-none space-y-6 text-[15px] leading-relaxed">

          <p>
            Most lab directors learn compliance the hard way: the first time a surveyor walks in and asks for documentation they don't have.
          </p>

          <p>
            There is no formal curriculum for laboratory leadership. You earn a degree in laboratory science, pass your boards, work the bench for years, and then one day you are handed keys to a department with CLIA obligations, accreditation requirements, and a staff looking to you for direction. Nobody teaches you how to manage a calibration verification program. Nobody explains what a surveyor actually looks for when they pull your competency records. You figure it out, sometimes with the help of a mentor, sometimes the hard way.
          </p>

          <p>
            VeritaAssure was built to change that.
          </p>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">The Gap Between Bench Competence and Leadership Competence</h2>

          <p>
            Technical competence and regulatory competence are fundamentally different skills. An excellent MLS who becomes a lab director still needs to learn what CLIA actually requires, not what their previous director told them. They need to know how to read and apply 42 CFR Part 493, what a surveyor looks for when they pull specific documentation, and how to build systems that survive leadership transitions.
          </p>

          <p>
            Most of this knowledge is passed down informally, inconsistently, or not at all. A new director may have spent fifteen years mastering immunoassay methodology and still have no mental model for how to structure a method comparison study as a documented compliance event. These are not the same knowledge base, and confusing them is how labs end up with findings during surveys.
          </p>

          <p>
            Health systems have been managing this problem for decades. Some invest in external consultants before surveys. Some rely on a single experienced director to mentor everyone below them. Some do nothing and absorb the consequences. None of these approaches scale, and all of them depend on individual knowledge that walks out the door during turnover.
          </p>

          <p>
            The problem is structural. The solution needs to be structural.
          </p>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">Why Software Can Teach</h2>

          <p>
            The educational architecture embedded in VeritaAssure is not incidental. Each module is designed so that the act of using it teaches the regulatory framework it operates within.
          </p>

          <p>
            <strong>VeritaMap teaches regulatory mapping.</strong> When a new director builds their first test menu map, they encounter something most bench scientists never do: every test their lab runs carries a specific federal regulatory obligation. The FDA database cross-referenced against 42 CFR Part 493 makes this concrete. When the intelligence engine flags that sodium and potassium on the Dimension EXL require a correlation study because two instruments are running the same analyte, the director learns a compliance requirement in context, not from a lecture. Using VeritaMap is how a new director learns what CLIA requires of their specific lab, for their instruments, their analytes, their departments.
          </p>

          <p>
            <strong>VeritaCheck teaches EP methodology.</strong> A new supervisor who has never designed a calibration verification study learns it by doing one. The data entry fields teach them what specimens are needed. The pass/fail logic teaches them what total allowable error means and why it is the standard against which performance is measured. The PDF report teaches them what documentation a surveyor expects to see. There is no better way to understand method comparison than to run one in a guided environment where the structure enforces correct methodology.
          </p>

          <p>
            <strong>VeritaScan teaches the survey mindset.</strong> Walking through 168 compliance items across 10 domains teaches a new director how a surveyor thinks. They learn what "Quality Systems" means in a regulatory context. They learn that personnel competency has specific elements required by CLIA, and that equipment maintenance records are a separate compliance domain from calibration verification. This is the mental model that takes years to build through direct survey experience. VeritaScan makes it visible on day one.
          </p>

          <p>
            <strong>VeritaComp teaches the six CLIA elements.</strong> Most lab staff who have completed competency assessments have never read 42 CFR 493.1451. They fill out the form because their supervisor told them to. VeritaComp shows them why each element exists: direct observation, result review, QC review, maintenance observation, blind specimen performance, problem-solving. A supervisor building their first competency program in VeritaComp learns the regulatory basis for each field they fill out, which is the only way to apply it correctly when circumstances change.
          </p>

          <p>
            <strong>VeritaStaff teaches personnel qualifications.</strong> Building the TC/TS/GS role assignments for a lab forces a new director to understand what CLIA requires of each supervisory role. Who can sign a high complexity competency? Why can the Technical Consultant role not be delegated? What qualifications does a Technical Supervisor need for each specialty? VeritaStaff makes these questions concrete because they have to be answered correctly before the CMS 209 generates.
          </p>

          {/* VeritaAssure CTA */}
          <div className="rounded-xl border-2 border-primary/20 bg-primary/5 p-6 my-8">
            <div className="flex items-start gap-3">
              <FlaskConical size={20} className="text-primary shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-sm mb-1">See VeritaAssure in action</div>
                <p className="text-sm text-muted-foreground mb-3">
                  Walk through the full compliance workflow with a real hospital lab. No login required.
                </p>
                <Button asChild size="sm" className="bg-primary text-primary-foreground">
                  <Link href="/demo">Launch Interactive Demo <ChevronRight size={13} className="ml-1" /></Link>
                </Button>
              </div>
            </div>
          </div>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">The Curriculum Nobody Offers</h2>

          <p>
            A health system with five labs and ten supervisors who all need to understand compliance can use VeritaAssure as a shared training environment. A pathologist developing a successor can assign them to build the lab's VeritaMap from scratch, an exercise that requires inventorying every test, every instrument, and every regulatory obligation in the department. A regional director grooming a department supervisor can have them run their first VeritaCheck study before the annual survey cycle begins.
          </p>

          <p>
            The documentation produced is real and audit-ready. The learning is embedded in the work, not in a separate training module that gets completed and forgotten.
          </p>

          <p>
            This is what "built by working lab leaders" actually means. Not that the software looks like what lab people use. That the software teaches what lab leaders need to know.
          </p>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">Lab Management 101 and the Full Picture</h2>

          <p>
            VeritaAssure does not stand alone. The book, <em>Lab Management 101</em>, covers the leadership principles, the regulatory landscape, the C-suite relationships, and the career development framework that no software can substitute for. Understanding why a compliance program exists requires context that comes from reading, reflection, and experience.
          </p>

          <p>
            VeritaAssure is where those principles become practice. Every concept addressed in the book has a corresponding workflow in the software. A new director who reads the book learns the regulatory landscape. A new director who uses the software builds the documentation habits that make that knowledge durable.
          </p>

          <p>
            Together they form a curriculum that most directors piece together over years of hard experience. A new director who has both has a stronger foundation than many directors who have been in the role for a decade.
          </p>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">A Practical Development Path</h2>

          <p>
            The following framework is designed for health systems and individual directors who want to use VeritaAssure as a structured development tool, not just a compliance platform.
          </p>

          <h3 className="font-semibold text-lg mt-8 mb-2">For a new lab director in their first 90 days:</h3>

          <ol className="list-decimal list-inside space-y-2 pl-2">
            <li>Build the lab's VeritaMap: inventory every instrument, every test, every regulatory obligation.</li>
            <li>Run the first VeritaCheck study on the analyte with the highest compliance risk.</li>
            <li>Complete the first VeritaScan assessment: establish the baseline before anything else is prioritized.</li>
            <li>Build the staff roster in VeritaStaff: understand the qualification requirements for each role before the next personnel decision.</li>
            <li>Set up the first VeritaComp program: understand the competency framework before the next survey cycle.</li>
          </ol>

          <p>
            By the end of this sequence, a new director has built institutional knowledge that previously existed only in the outgoing director's head. That knowledge is now documented, structured, and transferable.
          </p>

          <h3 className="font-semibold text-lg mt-8 mb-2">For an experienced director developing a successor:</h3>

          <p>
            Assign the successor to own one module at a time. Start with VeritaMap. Let them make mistakes in a documented environment where you can review their work and correct their understanding before a surveyor does. The goal is not perfect output on the first attempt. The goal is that by the time a surveyor arrives, the successor has already encountered every question that surveyor will ask.
          </p>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">Built for the Leaders Who Come Next</h2>

          <p>
            Laboratory leadership is not taught: it is transmitted. From director to supervisor, informally, inconsistently, and with gaps that show up during inspections.
          </p>

          <p>
            VeritaAssure does not replace mentorship. Nothing does. But it creates a structured environment where the regulatory requirements are visible, the documentation is guided, and a new leader can build understanding through practice rather than crisis.
          </p>

          <p>
            That is what this was built for.
          </p>

          {/* Newsletter */}
          <NewsletterSignup variant="inline" source="article-training" />

          {/* Final CTA */}
          <div className="rounded-xl bg-primary text-primary-foreground p-7 mt-10 text-center">
            <FlaskConical size={28} className="mx-auto mb-3 opacity-80" />
            <h3 className="font-serif text-xl font-bold mb-2">See the curriculum in action.</h3>
            <p className="text-primary-foreground/80 text-sm max-w-md mx-auto mb-5">
              Walk through the full VeritaAssure compliance workflow with a real hospital lab. No login required. No demo call. Just the product.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button asChild size="lg" className="bg-white text-primary hover:bg-white/90 font-semibold">
                <Link href="/demo">Launch Interactive Demo <ChevronRight size={15} className="ml-1" /></Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="border-white/40 text-white hover:bg-white/10">
                <Link href="/book">Lab Management 101 <ExternalLink size={13} className="ml-1" /></Link>
              </Button>
            </div>
          </div>

          {/* Author bio */}
          <div className="mt-8 pt-6 border-t border-border flex items-start gap-4">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <User size={20} className="text-primary" />
            </div>
            <div>
              <div className="font-semibold text-sm">Michael Veri</div>
              <div className="text-xs text-muted-foreground mb-1">Owner, Veritas Lab Services, LLC · Former Joint Commission Laboratory Surveyor · CPHQ</div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Michael Veri is a US Army veteran with 22 years of military leadership, former Joint Commission Laboratory Surveyor with 200+ facility inspections, and CPHQ-certified healthcare quality professional. He founded Veritas Lab Services to provide expert consulting and accessible compliance tools to clinical laboratories nationwide, and is the developer of VeritaCheck, VeritaScan, VeritaMap, and VeritaComp.
              </p>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
