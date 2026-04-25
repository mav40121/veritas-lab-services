import { useSEO } from "@/hooks/useSEO";
import { Link } from "wouter";
import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, ChevronRight, Building2, Users, CreditCard, FileText, ShieldCheck, Lock, Quote, Minus, Check, ArrowRight, X } from "lucide-react";
import { trackEvent } from "@/lib/analytics";

// COLA Nashville banner: auto-hides on May 9, 2026 onward
function ColaBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const today = new Date();
    const hideOn = new Date("2026-05-09T00:00:00");
    const dismissed = sessionStorage.getItem("colaBanner_dismissed") === "true";
    if (today < hideOn && !dismissed) {
      setVisible(true);
    }
  }, []);

  const dismiss = () => {
    sessionStorage.setItem("colaBanner_dismissed", "true");
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="bg-primary text-primary-foreground">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3">
        <p className="text-sm sm:text-base text-center sm:text-left flex-1 leading-snug">
          We will be at COLA Lab Enrichment Forum in Nashville, May 6-8. Use code{" "}
          <span className="font-bold">COLA2026</span> for 60-day trial plus 10% off.
        </p>
        <button
          onClick={dismiss}
          aria-label="Dismiss COLA banner"
          className="shrink-0 p-1 hover:bg-white/10 rounded transition-colors"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

const PLANS = [
  {
    name: "Per Study",
    price: "$25",
    period: "one-time",
    description: "Pay as you go. No subscription required.",
    features: [
      "Single study run",
      "Full PDF report",
      "All study types",
      "CLIA pass/fail evaluation",
    ],
    buttonLabel: "Run a Study",
    buttonHref: "/veritacheck",
    highlight: false,
    badge: null,
  },
  {
    name: "VeritaCheck\u2122 Unlimited",
    price: "$299",
    period: "/yr",
    description: "Single user. Method validation suite only. 14-day free trial included.",
    features: [
      "Unlimited studies",
      "All VeritaCheck\u2122 study types",
      "Full PDF reports",
      "Study history dashboard",
    ],
    buttonLabel: "Subscribe",
    buttonHref: "/veritacheck",
    highlight: false,
    badge: null,
  },
  {
    name: "Clinic",
    price: "$499",
    period: "/yr",
    description: "Certificate of Waiver labs and small clinics.",
    features: [
      "Full VeritaAssure\u2122 suite including all future modules",
      "Up to 2 seats",
      "CLIA number on all reports",
      "Complimentary 1-hour onboarding session",
    ],
    buttonLabel: "Subscribe",
    buttonHref: "/login",
    highlight: false,
    badge: "Entry Suite",
  },
  {
    name: "Community",
    price: "$999",
    period: "/yr",
    description: "Community hospitals and independent labs.",
    features: [
      "Everything in Clinic",
      "Up to 5 seats",
      "Complimentary 1-hour onboarding session",
      "VeritaStaff\u2122 personnel management",
      "Named seat support",
      "Priority support",
    ],
    buttonLabel: "Subscribe",
    buttonHref: "/login",
    highlight: true,
    badge: "Most Popular",
  },
  {
    name: "Hospital",
    price: "$1,999",
    period: "/yr",
    description: "Regional and acute care hospital labs.",
    features: [
      "Everything in Community",
      "Up to 15 seats",
      "Higher seat capacity",
      "Complimentary 2-hour onboarding session",
    ],
    buttonLabel: "Subscribe",
    buttonHref: "/login",
    highlight: false,
    badge: null,
  },
  {
    name: "Enterprise",
    price: "$2,999",
    period: "/yr",
    description: "Large hospitals, health systems, and reference labs.",
    features: [
      "Everything in Hospital",
      "Up to 25 seats",
      "Maximum seat capacity",
      "Custom onboarding included",
      "Priority support",
      "Consulting access",
    ],
    buttonLabel: "Subscribe",
    buttonHref: "/login",
    highlight: false,
    badge: null,
  },
];

export default function PricingPage() {
    useSEO({ title: "Pricing | VeritaAssure Lab Compliance Software", description: "Simple annual pricing for clinical laboratory compliance software. Plans for individual labs, community hospitals, regional hospitals, and enterprise health systems." });
return (
    <div className="min-h-screen bg-background">

      <ColaBanner />

      {/* Hero */}
      <section className="border-b border-border bg-gradient-to-br from-primary/10 via-primary/4 to-transparent">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-16 text-center">
          <Badge
            variant="outline"
            className="mb-4 text-primary border-primary/30 bg-primary/5 font-medium"
          >
            Pricing
          </Badge>
          <h1 className="font-serif text-4xl sm:text-5xl font-bold tracking-tight mb-4 leading-tight">
            Simple, Transparent Pricing
          </h1>
          <p className="text-xl text-primary font-semibold mb-3">
            Simple annual pricing based on your lab type. No hidden fees. No long-term contracts.
          </p>
          <p className="text-muted-foreground text-base max-w-2xl mx-auto leading-relaxed">
            Choose the plan that fits your lab's size and complexity. All subscription plans include a 14-day free trial.
          </p>
        </div>
      </section>

      {/* Payment Methods + Stripe Trust */}
      <section className="border-y border-teal-800/40 bg-teal-950/50">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 text-center">
          <div className="flex items-center justify-center gap-10 sm:gap-14 mb-4">
            <div className="flex flex-col items-center gap-1.5">
              <CreditCard size={24} className="text-teal-400" />
              <span className="text-xs text-muted-foreground font-medium">Credit Card</span>
            </div>
            <div className="flex flex-col items-center gap-1.5">
              <Building2 size={24} className="text-teal-400" />
              <span className="text-xs text-muted-foreground font-medium">ACH Transfer</span>
            </div>
            <div className="flex flex-col items-center gap-1.5">
              <FileText size={24} className="text-teal-400" />
              <span className="text-xs text-muted-foreground font-medium">Purchase Order</span>
            </div>
          </div>
          <p className="text-sm text-foreground">
            We accept credit cards, ACH bank transfer, and purchase orders.
          </p>
          <p className="text-sm text-foreground mt-1.5">
            Invoiced billing and purchase orders available for institutions. Contact{" "}
            <a href="mailto:info@veritaslabservices.com" className="text-teal-400 hover:underline">
              info@veritaslabservices.com
            </a>{" "}
            to get started.
          </p>
          <div className="flex items-center justify-center gap-1.5 mt-4 text-xs text-muted-foreground">
            <Lock size={12} />
            <span>Payments secured by Stripe</span>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="border-b border-border bg-muted/20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12">
          <div className="grid md:grid-cols-2 gap-8">
            <div className="text-center px-4">
              <Quote size={24} className="text-primary/40 mx-auto mb-3" />
              <p className="text-base italic leading-relaxed mb-4">
                "I didn't know what questions to ask because I didn't know where my gaps were. VeritaAssure showed me what I was missing before a surveyor found it first."
              </p>
              <p className="text-sm font-semibold">John Hall</p>
              <p className="text-xs text-muted-foreground">Laboratory Director, San Carlos Apache Healthcare Corporation</p>
            </div>
            <div className="text-center px-4">
              <Quote size={24} className="text-primary/40 mx-auto mb-3" />
              <p className="text-base italic leading-relaxed mb-4">
                "VeritaAssure is a suite of tools that will revolutionize the regulatory side of laboratory management. Whether your lab is accredited by CAP, TJC, or COLA, this streamlines your entire compliance workflow."
              </p>
              <p className="text-sm font-semibold">Lisa Veri</p>
              <p className="text-xs text-muted-foreground">Administrative Lab Director, Milford Regional Medical Center</p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Cards */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 space-y-14">

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {PLANS.map((plan) => (
            <Card
              key={plan.name}
              className={`relative h-full flex flex-col transition-all ${
                plan.highlight
                  ? "border-primary shadow-lg ring-1 ring-primary/20"
                  : "hover:border-primary/40 hover:shadow-md"
              }`}
            >
              {plan.badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span
                    className={`text-xs font-semibold px-3 py-1 rounded-full ${
                      plan.highlight
                        ? "bg-primary text-primary-foreground"
                        : "bg-primary/10 text-primary border border-primary/20"
                    }`}
                  >
                    {plan.badge}
                  </span>
                </div>
              )}
              <CardContent className="p-6 flex flex-col flex-1">
                <div className="mb-4">
                  <h3 className="font-semibold text-lg mb-1">{plan.name}</h3>
                  <div className="flex items-baseline gap-1">
                    <span className="font-serif text-3xl font-bold">{plan.price}</span>
                    <span className="text-muted-foreground text-sm">{plan.period}</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{plan.description}</p>
                </div>

                <ul className="space-y-2 mb-6 flex-1">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-sm">
                      <CheckCircle2 size={15} className="text-primary mt-0.5 shrink-0" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>

                <Button
                  asChild
                  className={`w-full font-semibold ${
                    plan.highlight
                      ? "bg-primary hover:bg-primary/90 text-primary-foreground"
                      : ""
                  }`}
                  variant={plan.highlight ? "default" : "outline"}
                >
                  <Link
                    href={plan.buttonHref}
                    onClick={() => {
                      if (plan.period === "/yr") {
                        const numericPrice = parseFloat(plan.price.replace(/[$,]/g, ''));
                        trackEvent('begin_checkout', {
                          currency: 'USD',
                          value: numericPrice,
                          items: [{
                            item_id: plan.name.toLowerCase().replace(/\W+/g, '_'),
                            item_name: plan.name,
                            price: numericPrice,
                            quantity: 1,
                          }],
                        });
                      }
                    }}
                  >
                    {plan.buttonLabel} <ChevronRight size={14} className="ml-1" />
                  </Link>
                </Button>
                {plan.period === "/yr" && (
                  <p className="text-xs text-center text-muted-foreground mt-2">
                    14-day free trial &middot; 30-day money-back guarantee
                  </p>
                )}
                {plan.period === "/yr" && plan.name !== "Per Study" && (() => {
                  const tierSlug: Record<string, string> = {
                    "VeritaCheck\u2122 Unlimited": "veritacheck",
                    "Clinic": "clinic",
                    "Community": "community",
                    "Hospital": "hospital",
                    "Enterprise": "enterprise",
                  };
                  const slug = tierSlug[plan.name] || "";
                  return (
                    <p className="text-xs text-center mt-1">
                      <Link
                        href={`/request-invoice?tier=${slug}`}
                        className="text-[#01696F] hover:underline"
                        onClick={() => trackEvent('invoice_request_card_link_click', { tier: slug })}
                      >
                        or request an invoice
                      </Link>
                    </p>
                  );
                })()}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Invoice CTA */}
        <div className="text-center py-6">
          <h3 className="font-serif text-xl font-medium mb-2">Need to pay by invoice?</h3>
          <Link
            href="/request-invoice"
            className="text-lg text-[#01696F] hover:underline"
            onClick={() => trackEvent('invoice_request_cta_click')}
          >
            Request an invoice
          </Link>
          <p className="text-sm text-gray-600 mt-1">For AP department processing.</p>
        </div>

        {/* Money-Back Guarantee */}
        <div className="border border-primary/20 bg-primary/5 rounded-lg p-6 text-center">
          <ShieldCheck size={28} className="text-primary mx-auto mb-3" />
          <h3 className="font-serif text-lg font-bold mb-2">30-Day Money-Back Guarantee</h3>
          <p className="text-sm text-muted-foreground max-w-lg mx-auto leading-relaxed">
            Subscription plans only. We'll refund your first subscription charge in full if you request a refund within 30 days of that charge. One refund per customer. Applies to the initial charge only, not renewals, seat add-ons, or per-study purchases. See our{" "}
            <Link href="/terms" className="text-primary hover:underline">Terms of Service</Link> for full details.
          </p>
        </div>

        {/* Enterprise+ */}
        <div className="rounded-lg border border-border bg-muted/30 p-6 sm:p-8 text-center">
          <div className="flex items-center justify-center gap-2 mb-3">
            <Building2 size={20} className="text-primary" />
            <h3 className="font-serif text-xl font-bold">Enterprise+</h3>
          </div>
          <p className="text-muted-foreground mb-5 max-w-xl mx-auto">
            Multi-site health systems and national reference labs. Contact us for custom pricing.
          </p>
          <Button asChild variant="outline" size="lg" className="w-full sm:w-auto">
            <Link href="/contact">
              Contact Us <ChevronRight size={14} className="ml-1" />
            </Link>
          </Button>
        </div>

        {/* Guest Study CTA */}
        <div className="bg-muted/30 border border-border rounded-lg p-5 text-center">
          <p className="text-sm text-muted-foreground">
            Not ready to commit? Run a single VeritaCheck&#8482; study for $25, no account required.{" "}
            <Link href="/veritacheck" className="text-primary font-medium hover:underline inline-flex items-center gap-1">
              Try it now <ArrowRight size={13} />
            </Link>
          </p>
        </div>

        {/* Per-Seat Pricing */}
        <section>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4">
            Additional Seats
          </div>
          <div className="rounded-lg border border-border bg-card p-6">
            <div className="flex items-start gap-3 mb-4">
              <Users size={18} className="text-primary mt-0.5 shrink-0" />
              <h3 className="font-semibold text-base">Per-Seat Pricing</h3>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { range: "2-5 total seats", price: "$199/seat", detail: "Seats 2-5" },
                { range: "6-10 total seats", price: "$179/seat", detail: "Seats 2-10" },
                { range: "11-25 total seats", price: "$159/seat", detail: "Seats 2-25" },
                { range: "26+ total seats", price: "$139/seat", detail: "Seats 2+" },
              ].map(({ range, price, detail }) => (
                <div key={range} className="rounded-md border border-border bg-muted/20 p-4 text-center">
                  <div className="font-semibold text-primary text-lg">{price}</div>
                  <div className="text-sm text-foreground font-medium mt-1">{range}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{detail}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Compare Plans */}
        <section>
          <div className="text-center mb-6">
            <h2 className="font-serif text-2xl font-bold">Compare Plans</h2>
            <p className="text-sm text-muted-foreground mt-1">See what's included in each tier.</p>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-left">
                  <th className="sticky left-0 bg-muted/50 px-4 py-3 font-semibold min-w-[200px]">Feature</th>
                  <th className="px-4 py-3 font-semibold text-center whitespace-nowrap">Per Study</th>
                  <th className="px-4 py-3 font-semibold text-center whitespace-nowrap">VC Unlimited</th>
                  <th className="px-4 py-3 font-semibold text-center whitespace-nowrap">Clinic</th>
                  <th className="px-4 py-3 font-semibold text-center whitespace-nowrap">Community</th>
                  <th className="px-4 py-3 font-semibold text-center whitespace-nowrap">Hospital</th>
                  <th className="px-4 py-3 font-semibold text-center whitespace-nowrap">Enterprise</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[
                  { feature: "VeritaCheck\u2122 studies (including CUMSUM)", values: ["1 study", true, true, true, true, true] },
                  { feature: "Full PDF reports with CLIA number", values: [true, true, true, true, true, true] },
                  { feature: "VeritaScan\u2122 inspection readiness", values: [false, false, true, true, true, true] },
                  { feature: "VeritaMap\u2122 test menu mapping", values: [false, false, true, true, true, true] },
                  { feature: "VeritaComp\u2122 competency tracking", values: [false, false, true, true, true, true] },
                  { feature: "VeritaStaff\u2122 personnel management", values: [false, false, false, true, true, true] },
                  { feature: "VeritaTrack\u2122 regulatory calendar", values: [false, false, true, true, true, true] },
                  { feature: "VeritaLab\u2122 certificate management", values: [false, false, true, true, true, true] },
                  { feature: "PI Dashboard", values: [false, false, true, true, true, true] },
                  { feature: "VeritaStock\u2122 inventory management", values: [false, false, true, true, true, true] },
                  { feature: "Seats included", values: ["1", "1", "2", "5", "15", "25"] },
                  { feature: "Onboarding session", values: [false, false, "1 hour", "1 hour", "2 hours", "Custom"] },
                  { feature: "Priority support", values: [false, false, false, true, false, true] },
                  { feature: "Consulting access", values: [false, false, false, false, false, true] },
                ].map((row) => (
                  <tr key={row.feature} className="hover:bg-muted/20">
                    <td className="sticky left-0 bg-background px-4 py-2.5 font-medium">{row.feature}</td>
                    {row.values.map((val, i) => (
                      <td key={i} className="px-4 py-2.5 text-center">
                        {val === true ? (
                          <Check size={16} className="text-primary mx-auto" />
                        ) : val === false ? (
                          <Minus size={16} className="text-muted-foreground/40 mx-auto" />
                        ) : (
                          <span className="text-sm">{val}</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Footer Notes */}
        <div className="space-y-3 text-center pb-4">
          <p className="text-sm text-muted-foreground">
            All plans include 2 years of read-only data access after cancellation.
          </p>
          <p className="text-xs text-muted-foreground max-w-2xl mx-auto">
            Your tier is based on your lab size and complexity. Certificate of Waiver labs are always placed in the Clinic tier. Not sure which tier fits your lab? Contact us at info@veritaslabservices.com.
          </p>
        </div>

      </div>
    </div>
  );
}
