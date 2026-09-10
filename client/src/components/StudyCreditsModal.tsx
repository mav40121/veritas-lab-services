import { useState, useEffect, useCallback } from "react";
import { Sparkles } from "lucide-react";

// Global event bus for the free-study credit-exhaustion moment. A new account
// gets 2 free study credits; when they run out the server blocks study and
// verification creation with { code: "STUDY_CREDITS_EXHAUSTED" }. Before this
// modal that block surfaced as a dead-end red toast with no way to act. Now the
// create handlers dispatch this event, and the modal turns the block into a
// one-click upgrade at the exact moment of intent.
const STUDY_CREDITS_EVENT = "study-credits-exhausted";

export function triggerStudyCreditsExhausted(message?: string) {
  window.dispatchEvent(new CustomEvent(STUDY_CREDITS_EVENT, { detail: { message } }));
}

export function StudyCreditsModal() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleEvent = useCallback((e: Event) => {
    const detail = (e as CustomEvent).detail || {};
    setMessage(detail.message || null);
    setOpen(true);
  }, []);

  useEffect(() => {
    window.addEventListener(STUDY_CREDITS_EVENT, handleEvent);
    return () => window.removeEventListener(STUDY_CREDITS_EVENT, handleEvent);
  }, [handleEvent]);

  if (!open) return null;

  const upgrade = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("veritas_token") || "";
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ priceType: "veritacheck_only" }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || "Checkout failed");
      window.location.href = data.url; // to Stripe Checkout
    } catch {
      // If checkout cannot start, fall back to the full plans page rather than
      // leaving the user stuck on a spinner.
      window.location.href = "/pricing";
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setOpen(false)}>
      <div className="bg-card border border-border rounded-xl shadow-xl max-w-md w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-full bg-primary/10">
            <Sparkles size={20} className="text-primary" />
          </div>
          <h3 className="font-bold text-lg">You have used your 2 free studies</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-2">
          {message || "Your account includes two free studies to start, and both are now used."}
        </p>
        <p className="text-sm text-muted-foreground mb-6">
          Upgrade to VeritaCheck&#8482; Unlimited for unlimited studies and instrument verifications, every one with a
          full signed PDF report and saved to your study history. $299 for the first year, then $499 per year.
        </p>
        <div className="flex flex-col gap-2">
          <button
            onClick={upgrade}
            disabled={loading}
            className="w-full px-4 py-2.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors font-medium disabled:opacity-60"
          >
            {loading ? "Starting checkout..." : "Upgrade to VeritaCheck™ Unlimited"}
          </button>
          <div className="flex gap-2">
            <a
              href="/pricing"
              onClick={() => setOpen(false)}
              className="flex-1 px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted transition-colors text-center"
            >
              See all plans
            </a>
            <button
              onClick={() => setOpen(false)}
              className="flex-1 px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted transition-colors"
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
