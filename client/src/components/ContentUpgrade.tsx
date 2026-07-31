import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle2, Download, FileText } from "lucide-react";
import { trackEvent } from "@/lib/analytics";

// Contextual, page-specific email-gated content upgrade (lead-capture
// experiment, handoff 2026-07-29). Reuses the existing /api/newsletter/subscribe
// pipeline with a distinct `source` per page so each is measurable, delivers the
// PDF immediately (plus the existing welcome email), and fires a GA4
// `lead_capture` event. Deliberately NOT a forced modal; a clean inline offer.
interface ContentUpgradeProps {
  source: string;       // distinct per page, e.g. "upgrade-tea-table"
  assetUrl: string;     // public PDF path, e.g. "/clia-tea-reference-2026.pdf"
  assetName: string;    // download filename
  title: string;
  description: string;
  buttonLabel?: string;
}

export function ContentUpgrade({
  source, assetUrl, assetName, title, description, buttonLabel = "Get the free PDF",
}: ContentUpgradeProps) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");

  const triggerDownload = () => {
    const a = document.createElement("a");
    a.href = assetUrl;
    a.download = assetName;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes("@")) { setStatus("error"); return; }
    setStatus("loading");
    try {
      const res = await fetch("/api/newsletter/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), source }),
      });
      if (!res.ok) throw new Error("subscribe failed");
      trackEvent("lead_capture", { source });
      triggerDownload();
      setStatus("done");
    } catch {
      setStatus("error");
    }
  };

  if (status === "done") {
    return (
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 my-6" data-testid="content-upgrade-done">
        <p className="flex items-center gap-2 text-sm font-semibold text-primary">
          <CheckCircle2 size={16} /> Your download is starting.
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          If it did not begin,{" "}
          <a href={assetUrl} download={assetName} className="text-primary underline">click here to download the PDF</a>.
          We also emailed you a short welcome with a couple more free resources.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 my-6" data-testid={`content-upgrade-${source}`}>
      <p className="flex items-center gap-2 text-sm font-bold text-primary">
        <FileText size={16} /> {title}
      </p>
      <p className="text-sm text-muted-foreground mt-1 mb-3">{description}</p>
      <form onSubmit={submit} className="flex flex-col sm:flex-row gap-2">
        <Input
          type="email"
          required
          placeholder="Work email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="sm:max-w-xs"
          aria-label="Work email"
        />
        <Button type="submit" disabled={status === "loading"} className="shrink-0">
          <Download size={14} className="mr-1.5" /> {status === "loading" ? "Sending…" : buttonLabel}
        </Button>
      </form>
      {status === "error" && (
        <p className="text-xs text-destructive mt-2">Please enter a valid email and try again.</p>
      )}
      <p className="text-[11px] text-muted-foreground mt-2">Free. No spam. Unsubscribe anytime.</p>
    </div>
  );
}
