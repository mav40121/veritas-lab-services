// Shared sample-reports section for the demo surfaces (Pfizer demo follow-up
// 2026-05-19). Renders five downloadable VeritaCheck PDFs covering the EP-
// study families customers most often evaluate. Each fixture is hand-tuned
// realistic data and runs through the production PDF generator so a prospect
// sees the actual report format, not a screenshot.
//
// Used by:
//   - DemoSelectorPage (the /demo landing page)
//   - DemoLabPage (/demo/compliance — inspection-readiness demo)
//   - DemoPage (/demo/operations — operations calculators)

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileDown, Loader2 } from "lucide-react";
import { API_BASE } from "@/lib/queryClient";
import { DEMO_SAMPLES } from "@/lib/demoSampleReports";
import { downloadPdfToken } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface SampleReportsSectionProps {
  /** Optional heading shown above the grid; pass null/undefined to skip. */
  heading?: string;
  /** Optional subheading paragraph. */
  subheading?: string;
}

export function SampleReportsSection({ heading, subheading }: SampleReportsSectionProps = {}) {
  const { toast } = useToast();
  const [loadingKey, setLoadingKey] = useState<string | null>(null);

  const handleDownload = async (sample: typeof DEMO_SAMPLES[number]) => {
    setLoadingKey(sample.key);
    try {
      const { study, results } = sample.build();
      const res = await fetch(`${API_BASE}/api/generate-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ study, results }),
      });
      if (!res.ok) {
        throw new Error(await res.text() || `HTTP ${res.status}`);
      }
      const { token } = await res.json();
      downloadPdfToken(token, sample.filename);
    } catch (err: any) {
      toast({
        title: "Could not generate sample report",
        description: "Please try again. If the problem persists, contact info@veritaslabservices.com.",
        variant: "destructive",
      });
      console.error("[sample report]", err);
    } finally {
      setLoadingKey(null);
    }
  };

  return (
    <div>
      {(heading || subheading) && (
        <div className="text-center mb-8">
          {heading && (
            <div className="inline-flex items-center gap-2 text-sm font-medium px-3 py-1 rounded-full mb-4" style={{ backgroundColor: "#01696F15", color: "#01696F" }}>
              <FileDown size={14} />
              {heading}
            </div>
          )}
          {subheading && (
            <p className="text-muted-foreground max-w-2xl mx-auto">{subheading}</p>
          )}
        </div>
      )}
      <div className="grid sm:grid-cols-2 gap-4">
        {DEMO_SAMPLES.map(sample => (
          <Card key={sample.key} className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{sample.label}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium" style={{ backgroundColor: "#01696F15", color: "#01696F" }}>
                  {sample.clsi}
                </span>
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground">
                  {sample.cfr}
                </span>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">{sample.blurb}</p>
              <Button
                onClick={() => handleDownload(sample)}
                disabled={loadingKey === sample.key}
                className="w-full"
                style={{ backgroundColor: "#01696F" }}
                data-testid={`button-sample-${sample.key}`}
              >
                {loadingKey === sample.key ? (
                  <><Loader2 size={14} className="mr-1.5 animate-spin" />Generating PDF…</>
                ) : (
                  <><FileDown size={14} className="mr-1.5" />Download sample PDF</>
                )}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
