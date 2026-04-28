import { useSEO } from "@/hooks/useSEO";
import { useState, useMemo } from "react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Search, FlaskConical, ExternalLink, Info, ChevronRight, AlertTriangle, CheckCircle2 } from "lucide-react";
import { teaData, specialties, searchTea, type TeaSpecialty } from "@/lib/cliaTeaData";

const specialtyColors: Record<string, string> = {
  "Routine Chemistry": "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-300",
  "General Immunology": "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/30 dark:text-purple-300",
  "Endocrinology": "bg-pink-50 text-pink-700 border-pink-200 dark:bg-pink-950/30 dark:text-pink-300",
  "Toxicology": "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-300",
  "Hematology": "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-300",
  "Coagulation": "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300",
  "Immunohematology": "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300",
  "Urinalysis": "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/30 dark:text-teal-300",
};

export default function TeaLookupPage() {
  const [query, setQuery] = useState("");
  const [selectedSpecialty, setSelectedSpecialty] = useState<TeaSpecialty | undefined>(undefined);
  const [selectedAnalyte, setSelectedAnalyte] = useState<typeof teaData[0] | null>(null);

  const results = useMemo(() => searchTea(query, selectedSpecialty), [query, selectedSpecialty]);

  const stats = useMemo(() => ({
    total: teaData.length,
    bySpecialty: specialties.map(s => ({ specialty: s, count: teaData.filter(a => a.specialty === s).length })),
  }), []);

  useSEO({ title: "CLIA TEa Lookup Tool | Total Allowable Error by Analyte | Veritas Lab Services", description: "Look up total allowable error (TEa) limits by analyte for CLIA compliance. Reference values from CLIA proficiency testing criteria and RCPA quality specifications." });

  return (
    <div className="min-h-screen bg-background">

      {/* Hero */}
      <section className="border-b border-border bg-gradient-to-br from-primary/8 via-transparent to-transparent">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
            <Link href="/resources" className="hover:text-primary transition-colors">Resources</Link>
            <span>/</span>
            <span>CLIA TEa Lookup</span>
          </div>
          <Badge variant="outline" className="mb-4 text-primary border-primary/30 bg-primary/5 font-medium">
            Free Tool
          </Badge>
          <h1 className="font-serif text-3xl sm:text-4xl font-bold tracking-tight mb-4 leading-tight">
            CLIA Allowable Error (TEa) Lookup
          </h1>
          <p className="text-muted-foreground text-lg max-w-2xl leading-relaxed mb-4">
            The complete 2025 CLIA acceptable performance criteria for {stats.total} analytes, directly from 42 CFR Part 493. Search any analyte and get the exact regulatory standard in seconds.
          </p>
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><CheckCircle2 size={12} className="text-primary" /> Updated July 2024 (2025 CLIA Final Rule)</span>
            <span className="flex items-center gap-1"><CheckCircle2 size={12} className="text-primary" /> Public domain: 42 CFR Part 493</span>
            <span className="flex items-center gap-1"><CheckCircle2 size={12} className="text-primary" /> No login required</span>
          </div>
        </div>
      </section>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">

        {/* Important notice */}
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900 p-4 mb-6 flex gap-3 text-sm">
          <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
          <div className="text-amber-800 dark:text-amber-300">
            <strong>Important:</strong> CLIA TEa values are federally published as the PT acceptable performance criterion. Most labs (with medical director or designee approval under §493.1253(b)(2) and §493.1255(b)(3)) adopt the same value as the calibration verification acceptance criterion. Your lab may adopt tighter internal criteria (ADLM recommends half of CLIA PT TEa for enhanced quality). Always verify against the current{" "}
            <a href="https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493" target="_blank" rel="noopener noreferrer" className="underline hover:text-amber-900">eCFR</a> before use in compliance decisions.
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">

          {/* Left — Search + filters */}
          <div className="lg:col-span-1 space-y-4">
            {/* Search */}
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search analyte (e.g. glucose, troponin...)"
                value={query}
                onChange={e => { setQuery(e.target.value); setSelectedAnalyte(null); }}
                className="pl-9"
              />
            </div>

            {/* Specialty filters */}
            <div>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">Filter by Specialty</div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => { setSelectedSpecialty(undefined); setSelectedAnalyte(null); }}
                  className={`text-xs px-2.5 py-1 rounded-md border font-medium transition-colors ${
                    !selectedSpecialty ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
                  }`}
                >
                  All ({stats.total})
                </button>
                {stats.bySpecialty.map(({ specialty, count }) => (
                  <button
                    key={specialty}
                    onClick={() => { setSelectedSpecialty(specialty); setSelectedAnalyte(null); }}
                    className={`text-xs px-2.5 py-1 rounded-md border font-medium transition-colors ${
                      selectedSpecialty === specialty
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
                    }`}
                  >
                    {specialty.replace("Routine ", "").replace("General ", "")} ({count})
                  </button>
                ))}
              </div>
            </div>

            {/* VeritaCheck CTA */}
            <div className="rounded-xl border-2 border-primary/20 bg-primary/5 p-4">
              <div className="flex items-start gap-2.5">
                <FlaskConical size={16} className="text-primary shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-sm mb-1">VeritaCheck™ applies these automatically</div>
                  <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
                    Every CLIA TEa value in this table is built into VeritaCheck™. Select your analyte, enter your data, and the pass/fail evaluation is done for you, with the CFR citation in the report.
                  </p>
                  <Button asChild size="sm" className="w-full bg-primary text-primary-foreground text-xs">
                    <Link href="/veritacheck">Run a Free Study <ChevronRight size={11} className="ml-1" /></Link>
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* Right — Results */}
          <div className="lg:col-span-2">
            {/* Result count */}
            <div className="text-xs text-muted-foreground mb-3">
              {results.length === teaData.length
                ? `Showing all ${results.length} analytes`
                : `${results.length} result${results.length !== 1 ? "s" : ""}${query ? ` for "${query}"` : ""}${selectedSpecialty ? ` in ${selectedSpecialty}` : ""}`
              }
            </div>

            {results.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">
                No analytes found for "{query}". Try a different search term.
              </div>
            ) : (
              <div className="space-y-2">
                {results.map(analyte => (
                  <Card
                    key={`${analyte.analyte}-${analyte.specialty}`}
                    className={`cursor-pointer transition-all ${
                      selectedAnalyte?.analyte === analyte.analyte && selectedAnalyte?.specialty === analyte.specialty
                        ? "border-primary/40 bg-primary/5 shadow-sm"
                        : "hover:border-primary/20 hover:shadow-sm"
                    }`}
                    onClick={() => setSelectedAnalyte(
                      selectedAnalyte?.analyte === analyte.analyte && selectedAnalyte?.specialty === analyte.specialty
                        ? null : analyte
                    )}
                  >
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="font-semibold text-sm">{analyte.analyte}</span>
                            {analyte.qualitative && (
                              <span className="text-[10px] font-medium bg-muted text-muted-foreground rounded px-1.5 py-0.5">Qualitative</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-xs font-semibold border rounded px-2 py-0.5 ${specialtyColors[analyte.specialty] || "bg-muted text-muted-foreground"}`}>
                              {analyte.specialty}
                            </span>
                            <span className="text-xs text-muted-foreground font-mono">{analyte.cfr}</span>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-sm font-bold text-primary">{analyte.criteria}</div>
                        </div>
                      </div>

                      {/* Expanded detail */}
                      {selectedAnalyte?.analyte === analyte.analyte && selectedAnalyte?.specialty === analyte.specialty && (
                        <div className="mt-3 pt-3 border-t border-border space-y-2">
                          <div className="grid sm:grid-cols-2 gap-2 text-xs">
                            <div className="bg-muted/40 rounded p-2">
                              <div className="text-muted-foreground mb-0.5">Acceptable Performance</div>
                              <div className="font-semibold">Target value {analyte.criteria}</div>
                            </div>
                            <div className="bg-muted/40 rounded p-2">
                              <div className="text-muted-foreground mb-0.5">CFR Citation</div>
                              <div className="font-mono font-semibold">42 CFR {analyte.cfr}</div>
                            </div>
                            <div className="bg-muted/40 rounded p-2">
                              <div className="text-muted-foreground mb-0.5">Specialty Section</div>
                              <div className="font-semibold">{analyte.specialty}</div>
                            </div>
                            <div className="bg-muted/40 rounded p-2">
                              <div className="text-muted-foreground mb-0.5">Effective</div>
                              <div className="font-semibold">July 11, 2024 (2025 Final Rule)</div>
                            </div>
                          </div>
                          {analyte.notes && (
                            <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 rounded p-2">
                              <Info size={12} className="shrink-0 mt-0.5" />
                              <span>{analyte.notes}</span>
                            </div>
                          )}
                          <div className="flex gap-2 pt-1">
                            <Button asChild size="sm" variant="outline" className="text-xs h-7 gap-1">
                              <a href="https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493" target="_blank" rel="noopener noreferrer">
                                View in eCFR <ExternalLink size={10} />
                              </a>
                            </Button>
                            <Button asChild size="sm" className="text-xs h-7 bg-primary text-primary-foreground gap-1">
                              <Link href="/veritacheck">
                                Run Study in VeritaCheck™ <ChevronRight size={10} />
                              </Link>
                            </Button>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Bottom context section */}
        <div className="mt-12 pt-8 border-t border-border grid sm:grid-cols-3 gap-6 text-sm">
          <div>
            <div className="font-semibold mb-2">What is CLIA TEa?</div>
            <p className="text-muted-foreground text-xs leading-relaxed">
              CLIA Total Allowable Error (TEa) is the maximum permissible difference between a laboratory's result and the target value for each analyte, as defined for proficiency testing acceptable performance in 42 CFR Part 493, Subpart I. It directly governs PT grading. We recommend it as the calibration verification acceptance criterion because it is federally published and well documented; under §493.1253(b)(2) and §493.1255(b)(3) the lab adopts this through medical director or designee approval.
            </p>
          </div>
          <div>
            <div className="font-semibold mb-2">Why use CLIA TEa for cal ver?</div>
            <p className="text-muted-foreground text-xs leading-relaxed">
              Many labs use manufacturer-stated allowable error for calibration verification instead of CLIA PT TEa. CLIA PT TEa is the federally published value for PT acceptable performance; adopting the same value (with medical director or designee approval) gives your cal ver acceptance criterion a published, defensible anchor. Manufacturer claims may be more or less stringent depending on the analyte.
            </p>
          </div>
          <div>
            <div className="font-semibold mb-2">ADLM recommendation</div>
            <p className="text-muted-foreground text-xs leading-relaxed">
              The Association for Diagnostics & Laboratory Medicine (ADLM) recommends using half of the CLIA TEa as internal quality goals, providing a safety margin that keeps results well within acceptable performance even under normal analytical variation.
            </p>
          </div>
        </div>

        {/* Read the article CTA */}
        <div className="mt-8 rounded-xl bg-primary text-primary-foreground p-6 text-center">
          <h2 className="font-serif text-xl font-bold mb-2">Want to understand how TEa applies to your studies?</h2>
          <p className="text-primary-foreground/80 text-sm max-w-lg mx-auto mb-4">
            Read our in-depth guide on CLIA calibration verification requirements, including how TEa is applied, what your lab is probably doing wrong, and how to fix it.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button asChild size="sm" className="bg-white text-primary hover:bg-white/90 font-semibold">
              <Link href="/resources/clia-tea-what-lab-directors-dont-know">Read the Article <ChevronRight size={13} className="ml-1" /></Link>
            </Button>
            <Button asChild size="sm" variant="outline" className="border-white/40 text-white hover:bg-white/10">
              <Link href="/veritacheck">Run a Free Study in VeritaCheck™ <FlaskConical size={13} className="ml-1" /></Link>
            </Button>
          </div>
        </div>

        {/* Source attribution */}
        <p className="text-xs text-muted-foreground text-center mt-6">
          Source: <a href="https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493" target="_blank" rel="noopener noreferrer" className="hover:text-primary underline">42 CFR Part 493, Subpart I</a>. U.S. Government publication, public domain. Last updated per the 2025 CLIA Final Rule (effective July 11, 2024). Always verify against the current eCFR before use in compliance decisions.
        </p>
      </div>
    </div>
  );
}
