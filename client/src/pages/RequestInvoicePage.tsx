import { useSEO } from "@/hooks/useSEO";
import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, FileText, ShieldCheck, CreditCard } from "lucide-react";
import { trackEvent } from "@/lib/analytics";

const TIER_OPTIONS = [
  { value: "clinic", label: "Clinic - $499/yr" },
  { value: "community", label: "Community - $999/yr" },
  { value: "hospital", label: "Hospital - $1,999/yr" },
  { value: "enterprise", label: "Enterprise - $2,999/yr" },
];

export default function RequestInvoicePage() {
  useSEO({
    title: "Request an Invoice | VeritaAssure\u2122",
    description: "Request an invoice for VeritaAssure\u2122. For AP departments that need to process an invoice before payment.",
  });

  const search = useSearch();
  const params = new URLSearchParams(search);
  const tierParam = params.get("tier") || "";
  const codeParam = params.get("code") || "";

  const [submitted, setSubmitted] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const [form, setForm] = useState({
    lab_name: "",
    clia_number: "",
    billing_contact_name: "",
    billing_contact_email: "",
    ap_email: "",
    billing_address: "",
    tax_id: "",
    tier: TIER_OPTIONS.some(t => t.value === tierParam) ? tierParam : "",
    seats: "1",
    promo_code: codeParam,
    po_number: "",
    notes: "",
    company_website: "",
    authorization: false,
  });

  const setField = (field: string, value: string | boolean) => {
    setForm(prev => ({ ...prev, [field]: value }));
    if (errorMsg) setErrorMsg("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg("");

    try {
      const res = await fetch("/api/invoice/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          seats: parseInt(form.seats, 10) || 1,
        }),
      });

      if (res.status === 429) {
        setErrorMsg("You've submitted several requests recently. Please email info@veritaslabservices.com directly or try again in an hour.");
        setLoading(false);
        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setErrorMsg(data?.error || "Something went wrong. Please email info@veritaslabservices.com and we'll handle it manually.");
        setLoading(false);
        return;
      }

      trackEvent("invoice_request_submitted", {
        tier: form.tier,
        seats: parseInt(form.seats, 10) || 1,
        has_promo: !!form.promo_code,
      });

      setSubmittedEmail(form.billing_contact_email);
      setSubmitted(true);
    } catch {
      setErrorMsg("Something went wrong. Please email info@veritaslabservices.com and we'll handle it manually.");
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div>
        <section className="border-b border-border bg-secondary/20">
          <div className="container-default py-14">
            <Badge variant="outline" className="mb-4 text-primary border-primary/30">Invoice</Badge>
            <h1 className="font-serif text-4xl font-bold mb-3">Request an Invoice</h1>
          </div>
        </section>
        <section className="section-padding">
          <div className="container-default max-w-2xl">
            <Card className="border-primary/20">
              <CardContent className="flex flex-col items-center justify-center py-16 text-center gap-4">
                <CheckCircle2 size={48} className="text-primary" />
                <h2 className="font-serif text-2xl font-bold">Request received</h2>
                <p className="text-muted-foreground max-w-md leading-relaxed">
                  We will send your invoice within 1 business day. Check {submittedEmail} for a link to set your password.
                </p>
              </CardContent>
            </Card>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div>
      <section className="border-b border-border bg-secondary/20">
        <div className="container-default py-14">
          <Badge variant="outline" className="mb-4 text-primary border-primary/30">Invoice</Badge>
          <h1 className="font-serif text-4xl font-bold mb-3">Request an Invoice</h1>
          <p className="text-muted-foreground text-lg max-w-xl">
            For AP departments that need to process an invoice before payment. We will email your invoice within 1 business day via Stripe.
          </p>
        </div>
      </section>

      <section className="section-padding">
        <div className="container-default max-w-2xl">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Lab name */}
            <div>
              <Label htmlFor="lab_name">Lab name *</Label>
              <Input
                id="lab_name"
                value={form.lab_name}
                onChange={e => setField("lab_name", e.target.value)}
                required
              />
            </div>

            {/* CLIA number */}
            <div>
              <Label htmlFor="clia_number">CLIA number</Label>
              <Input
                id="clia_number"
                value={form.clia_number}
                onChange={e => setField("clia_number", e.target.value)}
                placeholder="e.g. 22D1234567"
              />
            </div>

            {/* Billing contact name */}
            <div>
              <Label htmlFor="billing_contact_name">Billing contact name *</Label>
              <Input
                id="billing_contact_name"
                value={form.billing_contact_name}
                onChange={e => setField("billing_contact_name", e.target.value)}
                required
              />
            </div>

            {/* Billing contact email */}
            <div>
              <Label htmlFor="billing_contact_email">Billing contact email *</Label>
              <Input
                id="billing_contact_email"
                type="email"
                value={form.billing_contact_email}
                onChange={e => setField("billing_contact_email", e.target.value)}
                required
              />
            </div>

            {/* AP email */}
            <div>
              <Label htmlFor="ap_email">Accounts payable email (if different)</Label>
              <Input
                id="ap_email"
                type="email"
                value={form.ap_email}
                onChange={e => setField("ap_email", e.target.value)}
              />
            </div>

            {/* Billing address */}
            <div>
              <Label htmlFor="billing_address">Billing address *</Label>
              <Textarea
                id="billing_address"
                rows={3}
                value={form.billing_address}
                onChange={e => setField("billing_address", e.target.value)}
                required
              />
            </div>

            {/* Tax ID */}
            <div>
              <Label htmlFor="tax_id">Tax ID / EIN</Label>
              <Input
                id="tax_id"
                value={form.tax_id}
                onChange={e => setField("tax_id", e.target.value)}
              />
            </div>

            {/* Tier */}
            <div>
              <Label htmlFor="tier">Plan *</Label>
              <select
                id="tier"
                value={form.tier}
                onChange={e => setField("tier", e.target.value)}
                required
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="">Select a plan</option>
                {TIER_OPTIONS.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            {/* Seats */}
            <div>
              <Label htmlFor="seats">Seats *</Label>
              <Input
                id="seats"
                type="number"
                min={1}
                max={100}
                value={form.seats}
                onChange={e => setField("seats", e.target.value)}
                required
              />
            </div>

            {/* Promo code */}
            <div>
              <Label htmlFor="promo_code">Promo code</Label>
              <Input
                id="promo_code"
                value={form.promo_code}
                onChange={e => setField("promo_code", e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                COLA2026 members: use code COLA2026 for 60 day trial plus 10% off first year.
              </p>
            </div>

            {/* PO number */}
            <div>
              <Label htmlFor="po_number">PO number</Label>
              <Input
                id="po_number"
                value={form.po_number}
                onChange={e => setField("po_number", e.target.value)}
              />
            </div>

            {/* Notes */}
            <div>
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                rows={3}
                value={form.notes}
                onChange={e => setField("notes", e.target.value)}
                placeholder="Anything else we should know about invoicing or AP process?"
              />
            </div>

            {/* Honeypot - hidden from humans, bots fill it */}
            <div style={{ display: "none" }} aria-hidden="true">
              <label htmlFor="company_website">Company website</label>
              <input
                type="text"
                id="company_website"
                name="company_website"
                tabIndex={-1}
                autoComplete="off"
                value={form.company_website}
                onChange={e => setField("company_website", e.target.value)}
              />
            </div>

            {/* Authorization */}
            <div className="flex items-start gap-3 pt-2">
              <input
                type="checkbox"
                id="authorization"
                checked={form.authorization}
                onChange={e => setField("authorization", e.target.checked)}
                required
                className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <Label htmlFor="authorization" className="text-sm leading-relaxed cursor-pointer">
                I am authorized to request an invoice on behalf of this organization and confirm the information above is accurate. *
              </Label>
            </div>

            {errorMsg && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3">
                {errorMsg}
              </div>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-[#01696F] hover:bg-[#015558] text-white"
              size="lg"
            >
              {loading ? "Submitting..." : "Submit invoice request"}
            </Button>
          </form>

          {/* Trust signals */}
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-6 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <CreditCard size={16} className="text-primary" />
              <span>We never charge your card for this request.</span>
            </div>
            <div className="flex items-center gap-2">
              <ShieldCheck size={16} className="text-primary" />
              <span>Your account activates once the invoice is paid.</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
