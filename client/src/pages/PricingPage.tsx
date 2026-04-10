import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, ChevronRight, Building2, Users, CreditCard, FileText } from "lucide-react";

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
    description: "Single user. Method validation suite only. CLIA number required at checkout.",
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
    price: "$799",
    period: "/yr",
    description: "Community hospitals and independent labs.",
    features: [
      "Everything in Clinic",
      "Up to 5 seats",
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
    price: "$1,299",
    period: "/yr",
    description: "Regional and acute care hospital labs.",
    features: [
      "Everything in Community",
      "Up to 15 seats",
      "Higher seat capacity",
      "Complimentary 1-hour onboarding session",
    ],
    buttonLabel: "Subscribe",
    buttonHref: "/login",
    highlight: false,
    badge: null,
  },
  {
    name: "Enterprise",
    price: "$1,999",
    period: "/yr",
    description: "Large hospitals, health systems, and reference labs.",
    features: [
      "Everything in Hospital",
      "Up to 25 seats",
      "Maximum seat capacity",
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
  return (
    <div className="min-h-screen bg-background">

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
            Choose the plan that fits your lab's size and complexity. Certificate of Waiver labs start at the Clinic tier.
          </p>
        </div>
      </section>

      {/* Payment Methods */}
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
                  <Link href={plan.buttonHref}>
                    {plan.buttonLabel} <ChevronRight size={14} className="ml-1" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ))}
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
