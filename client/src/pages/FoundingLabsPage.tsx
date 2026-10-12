// client/src/pages/FoundingLabsPage.tsx
//
// Public Founding Labs page (2026-10-12): the page the Pricing page's Founding Lab Program card promises ("Your
// facility name on our Founding Labs page"). Lists the labs in client/src/lib/foundingLabs.ts and restates the
// program terms word for word from the Pricing card, so the two never disagree.
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowRight, Building2, CheckCircle2, MapPin } from "lucide-react";
import { FOUNDING_LABS } from "@/lib/foundingLabs";

export default function FoundingLabsPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12 space-y-10">
      <header className="space-y-3">
        <Badge variant="outline" className="border-primary/40 text-primary">Founding Lab Program</Badge>
        <h1 className="font-serif text-3xl sm:text-4xl font-bold">Founding Labs</h1>
        <p className="text-base text-muted-foreground leading-relaxed max-w-2xl">
          The charter customers of VeritaAssure™. Founding labs share their experience on reference calls with
          laboratories that are evaluating the platform.
        </p>
      </header>

      <section aria-labelledby="founding-labs-list" className="space-y-3">
        <h2 id="founding-labs-list" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Our founding labs</h2>
        <div className="grid gap-3 sm:grid-cols-2" data-testid="founding-labs-list">
          {FOUNDING_LABS.map((lab) => (
            <Card key={lab.name} data-testid="founding-lab-card">
              <CardContent className="p-5 flex items-start gap-3">
                <Building2 size={22} className="text-primary mt-0.5 shrink-0" />
                <div>
                  <div className="font-semibold leading-snug">{lab.name}</div>
                  <div className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                    <MapPin size={13} className="shrink-0" /> {lab.location}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">Founding lab since {lab.since}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="rounded-lg border-2 border-primary/40 bg-gradient-to-br from-primary/10 to-transparent p-6 sm:p-8">
        <h2 className="font-serif text-2xl font-bold flex items-center gap-2 mb-3">
          <span className="text-primary">★</span>
          Join the Founding Lab Program
        </h2>
        <p className="text-base mb-4 leading-relaxed">Become a charter customer of VeritaAssure™.</p>
        <ul className="space-y-2 mb-5">
          <li className="flex items-start gap-2 text-sm">
            <CheckCircle2 size={16} className="text-primary mt-0.5 shrink-0" />
            <span><strong>Discount</strong> on your annual subscription</span>
          </li>
          <li className="flex items-start gap-2 text-sm">
            <CheckCircle2 size={16} className="text-primary mt-0.5 shrink-0" />
            <span><strong>Locked rate, annual at-will mutual renewal</strong>: Year 1 minimum commitment, then 60 days' written notice to decline at any anniversary</span>
          </li>
          <li className="flex items-start gap-2 text-sm">
            <CheckCircle2 size={16} className="text-primary mt-0.5 shrink-0" />
            <span><strong>Your facility name</strong> on this page (logo placement with your marketing approval)</span>
          </li>
          <li className="flex items-start gap-2 text-sm">
            <CheckCircle2 size={16} className="text-primary mt-0.5 shrink-0" />
            <span><strong>Priority support</strong> throughout your first year</span>
          </li>
        </ul>
        <div className="border-t border-primary/20 pt-4 mb-5">
          <p className="text-sm text-muted-foreground italic leading-relaxed">
            In exchange: up to 2 reference calls per month, 30 minutes each, scheduled through our calendar tool. You and the prospect on the line; Veritas is not present. You share your honest experience.
          </p>
        </div>
        <div className="text-center">
          <Button asChild size="lg" className="font-semibold">
            <Link href="/founding-lab/apply">
              Apply to the Founding Lab Program <ArrowRight size={14} className="ml-1" />
            </Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
