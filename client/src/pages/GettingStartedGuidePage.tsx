// client/src/pages/GettingStartedGuidePage.tsx
//
// Public Resources page: "Getting Started with VeritaAssure" (requested
// 2026-10-06). A navigable training guide built from the shared content module
// (client/src/lib/gettingStartedContent.ts): the system onboarding path plus a
// per-module getting-started checklist for all 18 modules. Printable, with a
// per-visitor check-off saved in the browser. Copy lives in the content module
// (no em dashes, TM marks, "medical director or designee").
import { useSEO } from "@/hooks/useSEO";
import { Link } from "wouter";
import { useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Printer, ChevronDown, ChevronRight, CheckCircle2, Circle } from "lucide-react";
import { SYSTEM_PHASES, MODULE_GUIDES } from "@/lib/gettingStartedContent";

const LS_KEY = "va_getting_started_checks";

function useChecks() {
  const [checks, setChecks] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch { return {}; }
  });
  const toggle = useCallback((id: string) => {
    setChecks((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);
  return { checks, toggle };
}

function CheckRow({ id, text, meta, checks, toggle }: {
  id: string; text: string; meta?: string; checks: Record<string, boolean>; toggle: (id: string) => void;
}) {
  const done = !!checks[id];
  return (
    <button type="button" onClick={() => toggle(id)}
      className="flex w-full items-start gap-2.5 text-left py-2 px-1 rounded hover:bg-muted/40 transition-colors">
      {done
        ? <CheckCircle2 size={16} className="shrink-0 mt-0.5 text-emerald-600" />
        : <Circle size={16} className="shrink-0 mt-0.5 text-muted-foreground/50" />}
      <span className={`text-sm leading-relaxed ${done ? "text-muted-foreground line-through" : "text-foreground"}`}>
        {text}
        {meta && <span className="text-xs text-muted-foreground"> {" · "} {meta}</span>}
      </span>
    </button>
  );
}

export default function GettingStartedGuidePage() {
  useSEO({
    title: "Getting Started with VeritaAssure™: Setup and Per-Module Checklists",
    description: "A step-by-step guide to set up a laboratory on VeritaAssure™: the system onboarding path plus a getting-started checklist for all eighteen modules. Printable, with progress you can check off.",
  });
  const { checks, toggle } = useChecks();
  const [openModule, setOpenModule] = useState<string | null>(null);
  const compliance = MODULE_GUIDES.filter((m) => m.stream === "Compliance");
  const operations = MODULE_GUIDES.filter((m) => m.stream === "Operations");

  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <section className="border-b border-border bg-gradient-to-br from-primary/5 via-transparent to-transparent print:border-0">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4 print:hidden">
            <Link href="/resources" className="hover:text-primary transition-colors">Resources</Link>
            <span>/</span>
            <span>Getting Started</span>
          </div>
          <Badge variant="outline" className="mb-4 text-primary border-primary/30 bg-primary/5">Getting Started</Badge>
          <h1 className="font-serif text-3xl sm:text-4xl font-bold tracking-tight mb-4 leading-tight">
            Getting Started with VeritaAssure&trade;
          </h1>
          <p className="text-muted-foreground text-lg leading-relaxed mb-6">
            A clear path to get a laboratory set up and running: first the system onboarding path, then a short getting-started checklist for each of the eighteen modules. Check items off as you go, or print the whole guide.
          </p>
          <div className="flex flex-wrap items-center gap-3 print:hidden">
            <Button variant="outline" size="sm" className="gap-2" onClick={() => window.print()}>
              <Printer size={15} /> Print or save as PDF
            </Button>
            <Link href="/getting-started">
              <Button size="sm" className="gap-1">Open the in-app setup wizard <ChevronRight size={14} /></Button>
            </Link>
          </div>
        </div>
      </section>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 space-y-10">
        {/* System path */}
        <section>
          <h2 className="font-serif text-2xl font-bold mb-1">The setup path</h2>
          <p className="text-sm text-muted-foreground mb-5">Work top to bottom. Phases 1 and 2 set up the account and the lab foundation; everything else builds on them.</p>
          <div className="space-y-4">
            {SYSTEM_PHASES.map((phase, pi) => (
              <Card key={pi} className="border-border">
                <CardContent className="p-4 sm:p-5">
                  <h3 className="text-sm font-semibold text-primary mb-2">{phase.title}</h3>
                  <div className="divide-y divide-border/60">
                    {phase.steps.map((s, si) => (
                      <CheckRow key={si} id={`p${pi}.${si}`} text={s.task} meta={s.who} checks={checks} toggle={toggle} />
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Per-module checklists */}
        <section>
          <h2 className="font-serif text-2xl font-bold mb-1">By module</h2>
          <p className="text-sm text-muted-foreground mb-5">A getting-started checklist for each module. Open the ones your lab uses; skip the rest.</p>

          {[["Compliance", compliance], ["Operations", operations]].map(([label, mods]) => (
            <div key={label as string} className="mb-6">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{label as string}</div>
              <div className="space-y-2">
                {(mods as typeof MODULE_GUIDES).map((m) => {
                  const open = openModule === m.name;
                  return (
                    <Card key={m.name} className="border-border">
                      <button type="button" onClick={() => setOpenModule(open ? null : m.name)}
                        className="w-full flex items-start justify-between gap-3 p-4 text-left print:cursor-auto">
                        <div>
                          <div className="font-semibold text-foreground">{m.name}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">{m.what}</div>
                        </div>
                        <span className="print:hidden shrink-0 mt-1 text-muted-foreground">
                          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </span>
                      </button>
                      <div className={`${open ? "block" : "hidden"} print:block px-4 pb-4`}>
                        <div className="divide-y divide-border/60 border-t border-border/60 pt-1">
                          {m.steps.map((step, si) => (
                            <CheckRow key={si} id={`m:${m.name}:${si}`} text={step} checks={checks} toggle={toggle} />
                          ))}
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}
        </section>

        <section className="border-t border-border pt-6 text-sm text-muted-foreground">
          Questions as you set up? Email <a href="mailto:info@veritaslabservices.com" className="text-primary hover:underline">info@veritaslabservices.com</a>.
        </section>
      </div>
    </div>
  );
}
