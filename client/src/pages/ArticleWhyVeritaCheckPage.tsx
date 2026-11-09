import { useState } from "react";
import { useSEO } from "@/hooks/useSEO";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, DollarSign, Timer, Layers, ShieldCheck, ChevronRight, FileDown } from "lucide-react";
import { API_BASE } from "@/lib/queryClient";
import { downloadPdfToken } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

function Panel(props: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <Card className="border-primary/20 h-full">
      <CardContent className="p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
            {props.icon}
          </div>
          <h3 className="font-serif text-xl font-semibold leading-tight">{props.title}</h3>
        </div>
        <div className="prose-styles space-y-3 text-[15px] leading-relaxed">{props.children}</div>
      </CardContent>
    </Card>
  );
}

export default function ArticleWhyVeritaCheckPage() {
  const { toast } = useToast();
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  useSEO({
    title: "VeritaCheck® vs Legacy Verification | Veritas Lab Services",
    description: "How VeritaCheck® improves on legacy EP15, EP09, calibration verification, and method comparison workflows. CFR-cited PDF output, director sign-off.",
  });

  async function handleDownloadPdf() {
    setDownloadingPdf(true);
    try {
      const res = await fetch(`${API_BASE}/api/why-veritacheck-pdf`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { token } = await res.json();
      if (!token) throw new Error("No token returned");
      // Anchor download via the token endpoint (no popup / about:blank tab; parking lot #63).
      downloadPdfToken(token, "Why_VeritaCheck_vs_Legacy_Verification.pdf");
      toast({ title: "PDF generated" });
    } catch (e: any) {
      toast({ title: "PDF generation failed", description: e?.message || "Unknown error", variant: "destructive" });
    } finally {
      setDownloadingPdf(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <section className="border-b border-border bg-gradient-to-br from-primary/5 via-transparent to-transparent">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
            <Link href="/resources" className="hover:text-primary transition-colors">Resources</Link>
            <span>/</span>
            <span>Why VeritaCheck</span>
          </div>
          <Badge variant="outline" className="mb-4 text-primary border-primary/30 bg-primary/5">VeritaCheck® Positioning</Badge>
          <h1 className="font-serif text-3xl sm:text-4xl font-bold tracking-tight mb-4 leading-tight">
            Why VeritaCheck® vs. Legacy Verification Software
          </h1>
          <p className="text-base text-muted-foreground leading-relaxed mb-6">
            A side-by-side comparison authored for lab directors evaluating a tool change. Four dimensions: cost, time-to-first-study, integration breadth, and compliance defensibility.
          </p>
          <Button onClick={handleDownloadPdf} disabled={downloadingPdf} className="bg-primary hover:bg-primary/90">
            <FileDown size={14} className="mr-1.5" />
            {downloadingPdf ? "Generating..." : "Download PDF"}
          </Button>
        </div>
      </section>

      {/* Lede */}
      <section className="py-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <div className="prose-styles space-y-4 text-[15px] leading-relaxed mb-10">
            <p>
              Most clinical laboratories that run method verification studies today use a legacy desktop verification tool that has been the de facto standard for the better part of two decades. The tool works. It is also installed Windows software, priced for an era before browser-based clinical software, with its statistics kept apart from the rest of the laboratory's compliance records.
            </p>
            <p>
              VeritaCheck® is a browser-based alternative that produces the verification studies most CLIA laboratories need, under the CLSI standards named below, at a cost that is closer to a consumer SaaS subscription than a per-seat enterprise license, integrated into a broader VeritaAssure® platform that handles policy, mapping, competency, lab certificates, and cost-per-reportable-test in one login. This page lays out the four dimensions a lab director should compare before switching.
            </p>
          </div>

          {/* Four panels */}
          <div className="grid sm:grid-cols-2 gap-4 mb-12">
            <Panel icon={<DollarSign size={20} />} title="Cost">
              <p>
                VeritaCheck® Unlimited is $299 in Year 1, $499 per year after, for a single user. Per-study pricing for occasional users is $25 per study, one-time. A laboratory with more than one person running studies uses a suite plan: Clinic is $999 per year with 2 active seats, and additional active seats are $500 each. Suite plans include one free medical director seat for the lab's named director, which does not count against your active seats. Other reviewers, such as the technical consultant and technical supervisor, use active seats.
              </p>
              <p>
                Legacy verification software is typically licensed per seat at $800 to $3,000 per analyst per year, with the medical director sometimes counted as a billable seat. A community-hospital laboratory with three testing technologists and one reviewer pays the legacy tool between $2,400 and $9,000 per year before any tech time is spent on a study.
              </p>
              <p>
                The cost differential is most visible at the point of capital justification. On VeritaAssure®, a laboratory with three testing technologists and one reviewer pays $1,499 per year on Clinic if the reviewer is the named medical director, or $1,999 if the reviewer uses an active seat, with the full suite included.
              </p>
            </Panel>

            <Panel icon={<Timer size={20} />} title="Time to first study">
              <p>
                VeritaCheck® opens in a browser. There is no install, no driver, no IT ticket. A technologist with a fresh login can complete a method comparison study end-to-end (data entry, calculation, PDF download) in under 20 minutes. The first study is the slowest; the second is faster, and by the third the form is muscle memory.
              </p>
              <p>
                Legacy verification software is installed on a Windows workstation or network, which brings installation, activation, and IT involvement. A technologist new to the tool typically spends a half-day to a full day before producing a first defensible report.
              </p>
              <p>
                The time differential matters most when the lab is onboarding a new analyzer or a new analyte: the verification studies are on the critical path to going live. Cutting them from days to hours moves the go-live date.
              </p>
            </Panel>

            <Panel icon={<Layers size={20} />} title="Integration breadth">
              <p>
                VeritaCheck® runs fourteen study types under one tool: Precision Verification (EP15-A3), Method Comparison / Multi-Instrument Correlation (EP09), Calibration Verification (EP06), Linearity (EP06), Reagent Lot Verification (EP26), QC Lot Verification (C24-Ed4), PT/INR Geometric Mean Calculator (H47), Multi-Analyte Lot Comparison, Coag (EP26), Reference Range Verification (EP28), Sensitivity Verification (EP17-A2), Carryover Verification (EP10-A3), Accuracy / Bias (EP15-A3), Reportable Range / AMR Verification (42 CFR §493.1253(b)(1)(i)(C)), and Manual Differential (CLSI H20). One login, one billing line, one signature workflow.
              </p>
              <p>
                Around VeritaCheck® in the same VeritaAssure® platform: VeritaDC™ for the lab's document control, VeritaMap® for the test menu and critical value reference, VeritaComp™ for staff competency, VeritaLab™ for certificate tracking and CMS-116 application support, VeritaOps™ for cost-per-reportable-test studies, VeritaStock™ for inventory. A director who logs in to VeritaAssure® sees all of them.
              </p>
              <p>
                Legacy verification software covers the statistical studies well, and more of them than VeritaCheck® does. What its public materials do not show is a tie from those studies to the test menu, the regulation, and the rest of the laboratory's compliance records, so that work tends to stay in separate systems and spreadsheets. Lab director time is the cost the customer rarely tallies but always pays.
              </p>
            </Panel>

            <Panel icon={<ShieldCheck size={20} />} title="Compliance defensibility">
              <p>
                Every VeritaCheck® PDF has the laboratory director or designee signature block on page 1, alongside the study results, the narrative, and the 42 CFR §493 citation. The signature is not on a back page where it can be lost. The CFR citation is specialty-correct (Chemistry §493.931, Hematology §493.941, etc.).
              </p>
              <p>
                Once signed, a study is locked. Any change goes through an amendment, and the signed original is archived rather than overwritten. The signer and timestamp are recorded on the study, and deletions and notes go to the lab's audit log. The lab name and CLIA number are in the report header on page 1, alongside the results and the signature block.
              </p>
              <p>
                Legacy verification software produces a printable report. Some legacy reports do not cite the CFR at all, others cite an outdated section, and the signature placement varies. A surveyor reviewing the report has to do their own regulatory cross-reference.
              </p>
            </Panel>
          </div>

          {/* Closing */}
          <Card className="bg-primary/5 border-primary/20 mb-8">
            <CardContent className="p-6">
              <h2 className="font-serif text-xl font-semibold mb-3">When to switch</h2>
              <div className="prose-styles space-y-3 text-[15px] leading-relaxed">
                <p>
                  The strongest case for switching is at a natural inflection point: a license renewal coming due, an analyzer being added or replaced, a new lab director taking over, or a survey approaching. The verification studies that need to be done at any of those moments are the studies VeritaCheck® was designed to streamline.
                </p>
                <p>
                  The weakest case for switching is mid-project. If the lab is in the middle of a multi-analyte verification campaign on the legacy tool, finish it on the legacy tool and re-evaluate at the next natural break.
                </p>
                <p>
                  VeritaCheck® is included in every VeritaAssure® paid plan from Clinic ($999 per year) upward; standalone VeritaCheck® Unlimited is $299 in Year 1, $499 per year after. The Per-Study tier at $25 one-time exists specifically for labs that want to test the tool against a single planned study before committing.
                </p>
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                <Button asChild className="bg-primary hover:bg-primary/90">
                  <Link href="/demo/compliance">Open the VeritaCheck® demo</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/pricing">View pricing</Link>
                </Button>
                <Button asChild variant="ghost">
                  <Link href="/resources">More resources <ChevronRight size={14} className="ml-1" /></Link>
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Disclaimer */}
          <div className="text-xs text-muted-foreground leading-relaxed">
            VeritaAssure® is a statistical calculation tool. All results require interpretation by the laboratory director or designee. The figures cited for legacy verification software are typical operator-reported ranges, not a quote from a specific vendor. Lab tier pricing is current as of the most recent Stripe schedule. The Clinical Laboratory Improvement Amendments of 1988 (42 CFR Part 493) and the CLSI EP standards cited above are the regulatory and procedural authorities a laboratory should reference for verification of performance specifications. Final approval and clinical determination must be made by the laboratory director or designee.
          </div>
        </div>
      </section>
    </div>
  );
}
