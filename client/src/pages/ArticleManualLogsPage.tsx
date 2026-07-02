import { useSEO } from "@/hooks/useSEO";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, Clock, User } from "lucide-react";
import { NewsletterSignup } from "@/components/NewsletterSignup";
import { MANUAL_LOGS_FAQ } from "@/lib/faqContent";

export default function ArticleManualLogsPage() {
  useSEO({
    title: "Manual Logs: Why We Used Them, and Why Most Labs Should Stop | Veritas Lab Services",
    description:
      "Manual logs were invented to solve a memory problem in labs that had one or two computers. In 2026, the log is the source of the error that 24-hour review was designed to catch. Here is when to retire it.",
  });

  return (
    <div className="min-h-screen bg-background">

      {/* Header */}
      <section className="border-b border-border bg-gradient-to-br from-primary/5 via-transparent to-transparent">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
            <Link href="/resources" className="hover:text-primary transition-colors">Resources</Link>
            <span>/</span>
            <span>Lab Operations</span>
          </div>
          <Badge variant="outline" className="mb-4 text-primary border-primary/30 bg-primary/5">Lab Operations</Badge>
          <h1 className="font-serif text-3xl sm:text-4xl font-bold tracking-tight mb-4 leading-tight">
            Manual Logs: Why We Used Them, and Why Most Labs Should Stop
          </h1>
          <p className="text-muted-foreground text-lg leading-relaxed mb-6">
            Manual logs are one of those things in the laboratory that everyone uses, nobody questions, and almost nobody could explain the original reason for. They are a fix for a problem most modern labs no longer have.
          </p>
          <div className="flex items-center gap-5 text-xs text-muted-foreground border-t border-border pt-4">
            <span className="flex items-center gap-1.5"><User size={12} /> Michael Veri, MS, MBA, MLS(ASCP), CPHQ</span>
            <span className="flex items-center gap-1.5"><Clock size={12} /> 6 min read</span>
            <span>May 2026</span>
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
                "Manual logs exist to solve a memory problem from an era when computers were scarce in the lab",
                "Every time a result moves from the bench to a log to the computer, a new error mode is introduced: the transcription event",
                "The 24-hour transcribed-result review requirement exists specifically to catch the errors the log itself creates",
                "In a modern lab with a computer on every counter, direct entry from the analyzer to the LIS eliminates both the memory risk and the transcription risk",
                "Removing the log removes the administrative review burden that comes with it",
              ].map((t) => (
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

          <h2 className="font-serif text-2xl font-bold mt-4 mb-3">Why the manual log exists</h2>

          <p>
            Long ago in the clinical laboratory, computers were a luxury. A department might have one terminal at the front bench and another at the supervisor's desk, and that was it. Everywhere else, you had paper.
          </p>

          <p>
            So picture the tech at three in the morning. They run a urine hCG. The result is in their head. Before they can get to a terminal, the phone rings. They answer it. The ED is calling about a different patient. Two minutes of conversation. Then a nurse walks up about a third patient. Two more minutes. By the time the tech sits down at the terminal, the original result is either gone or, worse, has quietly become a different result. They remember positive instead of negative. They remember the result from the patient before this one.
          </p>

          <p>
            That is the problem the manual log was invented to solve. Write it down at the bench, the moment you generate it, before anything else can happen. Then walk it to the terminal. The log is a memory aid, and in that era, it was the safer of the available choices.
          </p>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">The hidden cost of the log</h2>

          <p>
            The log fixed the memory problem. It also created a new one.
          </p>

          <p>
            Think about the error modes carefully. If you read a result off the analyzer and enter it directly into the LIS, you can still misread it. That error exists no matter what method you use. It is a function of human perception, and it is irreducible.
          </p>

          <p>
            But the moment you write the result on a log and then later move it to the computer, a second error mode appears. You can read it correctly off the analyzer, write it correctly on the log, and then transcribe it incorrectly from the log into the LIS. That mis-copy from log to computer is the new error the log introduces. It cannot happen without the log, because without the log there is nothing to copy from.
          </p>

          <p>
            This is not a theoretical concern. It is the reason CAP, TJC, and CLIA all require documented review of manually transcribed results within 24 hours. That requirement does not exist to fix bench error. It exists to catch the error the log itself introduces.
          </p>

          <p>
            When you take a hard look at the regulation, you see it for what it is. The 24-hour review is the laboratory paying back, in administrative work, the convenience the log provided at the bench. Every manual log carries a hidden tax in the form of mandatory secondary review.
          </p>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">What changed</h2>

          <p>
            The lab of 1985 had one computer. The lab of 2026 has a computer on every counter, an interface on every analyzer that supports one, and a terminal within arm's reach of every bench station. The memory problem the log was invented to solve no longer exists at the same scale. When the tech reads the result, the terminal is right there.
          </p>

          <p>
            This changes the math. In 1985 the risk of misremembering a result while walking across the lab was higher than the risk of a transcription mistake, so the log was the safer choice. Today the risk of misremembering is near zero because there is no walk. The transcription risk, however, is unchanged. The log no longer protects against a real risk, but it still introduces one.
          </p>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">What direct entry buys you</h2>

          <p>
            Move to direct entry from the test to the LIS and three things happen, in this order.
          </p>

          <p>
            You eliminate the transcription event. There is no second copy of the result for someone to mis-copy. There is the analyzer reading, and there is the LIS value, and they are produced by the same act of entry.
          </p>

          <p>
            You eliminate the regulatory requirement under CAP, TJC, and CLIA to perform 24-hour review of transcribed results, because there are no transcribed results to review. The administrative time that requirement consumed is now available for other work.
          </p>

          <p>
            You shorten the path between result generation and result availability in the patient record. The provider sees the value sooner. In a STAT environment that matters.
          </p>

          <p>
            The misread error from the analyzer is still there. It will always be there, because it is a human perception risk that no system can engineer out. But it is the only error mode left.
          </p>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">When the log still earns its place</h2>

          <p>
            There are still narrow cases where a manual log is the right answer. A waived test cartridge or instrument that does not interface with the LIS and produces a printed strip or visual read is one. Send-out workflows where a paper requisition is required by the reference lab for chain-of-custody or specimen-tracking purposes are another.
          </p>

          <p>
            In each of these cases the log is solving a real problem that direct entry cannot. That is the test for whether to keep a log: is it solving a problem that exists today, or is it solving a problem from 1985?
          </p>

          <p>
            If the latter, retire it. The log is not free. It costs you a 24-hour review cycle, an additional opportunity for error on every result, and the staff hours required to perform both. Every result that bypasses the log is a result that the surveyor cannot ask you to demonstrate review on, because there was nothing to review.
          </p>

          <p>
            In the modern laboratory, the safer method is the one with fewer hands on the data. Most of the time, that is direct entry, no log, no transcription, no administrative review. A win on quality, a win on speed, a win on staff time.
          </p>

          <p className="italic text-muted-foreground text-center pt-4">
            Learn more at <Link href="/" className="text-primary hover:underline">veritaslabservices.com</Link>, your partner in clinical compliance.
          </p>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">Frequently Asked Questions</h2>
          {MANUAL_LOGS_FAQ.map(({ q, a }) => (
            <div key={q} className="border-b border-border py-5 last:border-0">
              <h3 className="font-semibold text-base mb-2">{q}</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">{a}</p>
            </div>
          ))}

          {/* Newsletter */}
          <NewsletterSignup variant="inline" source="article-manual-logs" />

          {/* Author bio */}
          <div className="mt-8 pt-6 border-t border-border flex items-start gap-4">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <User size={20} className="text-primary" />
            </div>
            <div>
              <div className="font-semibold text-sm">Michael Veri</div>
              <div className="text-xs text-muted-foreground mb-1">Owner, Veritas Lab Services, LLC · Former Joint Commission Laboratory Surveyor · CPHQ</div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Michael Veri is a US Army veteran with 22 years of military leadership, former Joint Commission Laboratory Surveyor with 200+ facility inspections, and CPHQ-certified healthcare quality professional. He founded Veritas Lab Services to provide expert consulting and accessible compliance tools to clinical laboratories nationwide, and is the developer of VeritaCheck™, VeritaScan™, VeritaMap™, and VeritaComp™.
              </p>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
