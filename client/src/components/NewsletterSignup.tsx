import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle2, Mail, Loader2 } from "lucide-react";

interface NewsletterSignupProps {
  variant?: "inline" | "card" | "banner";
  source?: string;
}

export function NewsletterSignup({ variant = "card", source = "website" }: NewsletterSignupProps) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error" | "exists">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus("loading");
    try {
      const res = await fetch("/api/newsletter/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), name: name.trim() || undefined, source }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || "Something went wrong.");
        setStatus("error");
        return;
      }
      if (data.message === "already_subscribed") {
        setStatus("exists");
      } else {
        setStatus("success");
      }
    } catch {
      setErrorMsg("Network error. Please try again.");
      setStatus("error");
    }
  };

  // ── Success state ──
  if (status === "success") {
    return (
      <div className={`${variant === "banner" ? "text-center" : ""} py-2`}>
        <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-semibold text-sm mb-1">
          <CheckCircle2 size={16} /> You're subscribed.
        </div>
        <p className="text-xs text-muted-foreground">
          Welcome to The Lab Director's Briefing. Check your inbox for a welcome email with two free resources.
        </p>
      </div>
    );
  }

  if (status === "exists") {
    return (
      <div className={`${variant === "banner" ? "text-center" : ""} py-2`}>
        <div className="flex items-center gap-2 text-primary font-semibold text-sm mb-1">
          <CheckCircle2 size={16} /> Already subscribed.
        </div>
        <p className="text-xs text-muted-foreground">You're already on the list. Check your inbox for past issues.</p>
      </div>
    );
  }

  // ── Banner variant ── (used in footer / homepage section)
  if (variant === "banner") {
    return (
      <div className="rounded-2xl bg-primary text-primary-foreground px-6 py-8 sm:py-10 text-center">
        <Mail size={28} className="mx-auto mb-3 opacity-80" />
        <h2 className="font-serif text-xl sm:text-2xl font-bold mb-2">The Lab Director's Briefing</h2>
        <p className="text-primary-foreground/80 text-sm max-w-md mx-auto mb-6 leading-relaxed">
          Regulatory clarity, surveyor callouts, and practical tools — from a former Joint Commission surveyor with 200+ inspections. Free. No spam. Unsubscribe anytime.
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2 max-w-md mx-auto">
          <Input
            type="email"
            placeholder="your@lab.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            className="bg-white/10 border-white/20 text-white placeholder:text-white/50 focus:bg-white/15"
          />
          <Button
            type="submit"
            disabled={status === "loading"}
            className="bg-white text-primary hover:bg-white/90 font-semibold shrink-0"
          >
            {status === "loading" ? <Loader2 size={14} className="animate-spin" /> : "Subscribe Free"}
          </Button>
        </form>
        {status === "error" && <p className="text-red-300 text-xs mt-2">{errorMsg}</p>}
        <p className="text-xs text-primary-foreground/50 mt-3">Join lab directors and quality managers across the country.</p>
      </div>
    );
  }

  // ── Inline variant ── (used in article footers)
  if (variant === "inline") {
    return (
      <div className="border border-primary/20 rounded-xl bg-primary/5 p-5">
        <div className="flex items-start gap-3">
          <Mail size={18} className="text-primary shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="font-semibold text-sm mb-0.5">The Lab Director's Briefing</div>
            <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
              Regulatory clarity and practical tools from a former Joint Commission surveyor. Free, no spam.
            </p>
            <form onSubmit={handleSubmit} className="flex gap-2">
              <Input
                type="email"
                placeholder="your@lab.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="text-sm h-8"
              />
              <Button type="submit" size="sm" disabled={status === "loading"} className="bg-primary text-primary-foreground shrink-0 h-8 text-xs">
                {status === "loading" ? <Loader2 size={12} className="animate-spin" /> : "Subscribe"}
              </Button>
            </form>
            {status === "error" && <p className="text-red-500 text-xs mt-1">{errorMsg}</p>}
          </div>
        </div>
      </div>
    );
  }

  // ── Card variant ── (default, used on Resources page)
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex items-center gap-2 mb-2">
        <Mail size={18} className="text-primary" />
        <span className="font-serif font-bold text-base">The Lab Director's Briefing</span>
      </div>
      <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
        Regulatory clarity, surveyor callouts, and practical tools from a former Joint Commission surveyor with 200+ inspections. Free. No spam. Unsubscribe anytime.
      </p>
      <form onSubmit={handleSubmit} className="space-y-2">
        <Input
          type="text"
          placeholder="Your name (optional)"
          value={name}
          onChange={e => setName(e.target.value)}
          className="text-sm"
        />
        <Input
          type="email"
          placeholder="your@lab.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          className="text-sm"
        />
        <Button type="submit" disabled={status === "loading"} className="w-full bg-primary text-primary-foreground">
          {status === "loading" ? <><Loader2 size={14} className="animate-spin mr-2" /> Subscribing...</> : "Subscribe Free"}
        </Button>
      </form>
      {status === "error" && <p className="text-red-500 text-xs mt-2">{errorMsg}</p>}
      <p className="text-xs text-muted-foreground text-center mt-2">Join lab directors and quality managers across the country.</p>
    </div>
  );
}
