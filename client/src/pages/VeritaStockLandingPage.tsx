import { Link } from "wouter";
import { useSEO } from "@/hooks/useSEO";
import { Button } from "@/components/ui/button";
import { Boxes, ArrowLeftRight, BellRing } from "lucide-react";

// Public front door for the veritastock.com host (App.tsx routes "/" here when
// isStockHost()). No auth: this is the unauthenticated landing a first-time
// visitor sees. Copy is grounded only in shipped VeritaStock capabilities
// (cross-location roll-up, batch transfers, burn-rate reorder, PDF/Excel order
// export) and follows the public-copy rules (no em dashes, trademark marks).

const FEATURES = [
  {
    icon: Boxes,
    title: "One view, every location",
    body: "On-hand counts for every item across all your sites, rolled up in a single grid.",
  },
  {
    icon: ArrowLeftRight,
    title: "Transfers that reconcile",
    body: "Move items from the warehouse to any stockroom in one reviewed batch, with a tracked entry recorded on both locations.",
  },
  {
    icon: BellRing,
    title: "Reorder before you run out",
    body: "Burn-rate reorder points and low-stock alerts, exported as a ready-to-send order list in PDF or Excel.",
  },
];

export default function VeritaStockLandingPage() {
  useSEO({
    title: "VeritaStock™ | Multi-Location Inventory",
    description:
      "VeritaStock tracks inventory across your warehouse and every stockroom, flags low stock, and moves items between locations with a recorded entry on both ends.",
  });

  return (
    <div className="bg-background" data-testid="veritastock-landing">
      <section className="max-w-5xl mx-auto px-4 sm:px-6 pt-16 pb-12 sm:pt-24 sm:pb-16">
        <div className="inline-flex items-center gap-2 mb-6">
          <span className="text-xs font-semibold tracking-wide uppercase px-2.5 py-1 rounded-full bg-primary/10 text-primary">
            VeritaStock&trade;
          </span>
          <span className="text-xs text-muted-foreground">Multi-Location Inventory</span>
        </div>

        <h1 className="font-serif font-bold tracking-tight text-4xl sm:text-5xl lg:text-6xl text-foreground max-w-3xl">
          Know what you have, everywhere.
        </h1>

        <p className="mt-5 text-lg text-muted-foreground max-w-2xl leading-relaxed">
          VeritaStock&trade; tracks inventory across your warehouse and every stockroom, flags what is
          running low, and moves stock between locations with a recorded entry on both ends.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button asChild size="lg" className="bg-primary text-primary-foreground">
            <Link href="/login" data-testid="landing-signin">Sign in</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <a href="mailto:info@veritaslabservices.com?subject=VeritaStock%20demo">Request a demo</a>
          </Button>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 pb-24">
        <div className="grid gap-6 sm:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border bg-card p-6">
              <f.icon className="h-6 w-6 text-primary" aria-hidden="true" />
              <h3 className="mt-4 font-semibold text-foreground">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
