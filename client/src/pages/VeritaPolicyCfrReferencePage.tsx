// VeritaPolicyCfrReferencePage.tsx
//
// Read-only "CFR Reference" view inside VeritaDC (parking-lot #30). Surfaces the
// 42 CFR / related verbatim regulatory text that already backs the compliance
// crosswalk, with the operator-approved plain-language summary shown beside the
// verbatim text for the high-traffic sections that have one.
//
// Scope discipline (the two prior attempts were reverted for scope mismatch):
//   - CFR ROWS ONLY. Accreditor rows (CAP/TJC/COLA) are paraphrases of
//     copyrighted manuals and must never be shown under a "verbatim" label, so
//     this view filters to source === 'cfr' and never renders accreditor text.
//   - The plain-language summary is CFR-section-scoped (it lives on the CFR
//     requirement), shown on its own citation only, never mapped onto a
//     policy-scoped Master List row.
// The `summary` field is already served by GET /api/veritapolicy/requirements
// (it spreads the full requirement object), so this is a client-only surface.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { VeritaPolicyTabs } from "@/components/VeritaPolicyTabs";
import { Input } from "@/components/ui/input";
import { Loader2, BookOpen, Sparkles } from "lucide-react";

type Requirement = {
  id: number;
  standard: string;
  name: string;
  description: string;
  chapter_label: string;
  source: string;
  summary?: string | null;
};

export default function VeritaPolicyCfrReferencePage() {
  const labId = useActiveLabId();
  const [q, setQ] = useState("");

  const { data, isLoading } = useQuery<Requirement[]>({
    queryKey: ["/api/veritapolicy/requirements"],
    enabled: !!labId,
  });

  // CFR rows only, deduped by citation (the dataset repeats a section across
  // many rows). Keep the first row's text; attach a summary from whichever row
  // of that section carries one.
  const sections = useMemo(() => {
    const byStandard = new Map<string, Requirement>();
    for (const r of data ?? []) {
      if (r.source !== "cfr") continue;
      const key = `${r.standard}\u0000${r.name}`;
      const existing = byStandard.get(key);
      if (!existing) {
        byStandard.set(key, { ...r });
      } else if (!existing.summary && r.summary) {
        existing.summary = r.summary;
      }
    }
    return Array.from(byStandard.values());
  }, [data]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = needle
      ? sections.filter(
          (r) =>
            r.standard.toLowerCase().includes(needle) ||
            r.name.toLowerCase().includes(needle) ||
            (r.summary || "").toLowerCase().includes(needle) ||
            (r.description || "").toLowerCase().includes(needle)
        )
      : sections;
    // Group by chapter_label, preserving first-seen chapter order.
    const groups = new Map<string, Requirement[]>();
    for (const r of rows) {
      const g = groups.get(r.chapter_label) || [];
      g.push(r);
      groups.set(r.chapter_label, g);
    }
    return Array.from(groups.entries());
  }, [sections, q]);

  const summaryCount = useMemo(
    () => sections.filter((r) => r.summary && r.summary.trim()).length,
    [sections]
  );

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-1">
        <BookOpen className="text-primary" size={22} />
        <h1 className="text-2xl font-bold text-foreground">CFR Reference</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        The federal regulatory text (42 CFR Part 493 and related parts) behind the
        compliance crosswalk, shown verbatim. Where a section carries a
        plain-language summary, it appears beside the official text to help you read
        faster. The verbatim text is always the authority.
      </p>

      <VeritaPolicyTabs active="cfr-reference" />

      <div className="mt-4 mb-3 flex items-center justify-between gap-3 flex-wrap">
        <Input
          placeholder="Search by citation, title, or text..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-md"
          data-testid="cfr-search"
        />
        {summaryCount > 0 && (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Sparkles size={13} className="text-primary" />
            {summaryCount} section{summaryCount === 1 ? "" : "s"} with a plain-language summary
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-10">
          <Loader2 className="animate-spin" size={16} /> Loading regulatory text...
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-muted-foreground py-10">
          No CFR sections match your search.
        </div>
      ) : (
        <div className="space-y-6" data-testid="cfr-sections">
          {filtered.map(([chapter, rows]) => (
            <section key={chapter}>
              <h2 className="text-sm font-semibold text-foreground/80 border-b border-border pb-1 mb-3">
                {chapter}
              </h2>
              <div className="space-y-3">
                {rows.map((r) => (
                  <div key={r.id} className="rounded-lg border border-border p-3" data-testid="cfr-row">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="font-semibold text-foreground">{r.standard}</span>
                      <span className="text-sm text-muted-foreground">{r.name}</span>
                    </div>
                    {r.summary && r.summary.trim() && (
                      <div className="mt-2 rounded-md bg-primary/5 border border-primary/20 px-3 py-2">
                        <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-primary mb-1">
                          <Sparkles size={12} /> In plain language
                        </div>
                        <p className="text-sm text-foreground/90">{r.summary}</p>
                      </div>
                    )}
                    <p className="mt-2 text-sm text-muted-foreground whitespace-pre-line leading-relaxed">
                      {r.description}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
