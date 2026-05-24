import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, CheckCircle2 } from "lucide-react";
import { API_BASE } from "@/lib/queryClient";

export default function FoundingLabApplyPage() {
  const [labName, setLabName] = useState("");
  const [cliaNumber, setCliaNumber] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactTitle, setContactTitle] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [labType, setLabType] = useState("");
  const [tierOfInterest, setTierOfInterest] = useState("");
  const [approximateSeatCount, setApproximateSeatCount] = useState("");
  const [whyFounder, setWhyFounder] = useState("");
  const [marketingLogoApproval, setMarketingLogoApproval] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/api/founding-lab/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          labName, cliaNumber, contactName, contactTitle, contactEmail, contactPhone,
          labType, tierOfInterest, approximateSeatCount, whyFounder, marketingLogoApproval,
        }),
      });
      if (!res.ok) throw new Error((await res.text()) || "Submission failed");
      return res.json();
    },
    onSuccess: () => setSubmitted(true),
  });

  if (submitted) {
    return (
      <div className="max-w-2xl mx-auto p-6 my-12">
        <Card>
          <CardContent className="p-8 text-center space-y-3">
            <CheckCircle2 className="mx-auto text-teal-600" size={48} />
            <h2 className="text-2xl font-bold">Application received</h2>
            <p className="text-sm text-muted-foreground">
              Thank you for applying to the Founding Lab Program. Michael will review and
              reach out within 2 business days at <strong>{contactEmail}</strong>.
            </p>
            <p className="text-xs text-muted-foreground pt-2">
              Questions in the meantime: info@veritaslabservices.com
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const canSubmit = labName.trim().length >= 2
    && contactName.trim().length >= 2
    && contactEmail.includes("@");

  return (
    <div className="max-w-2xl mx-auto p-6 my-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Founding Lab Program</h1>
        <p className="text-muted-foreground mt-3 leading-relaxed">
          Apply to become one of our charter customer cohort. As a Founding Lab you
          receive a discount on your annual subscription, a 24-month price lock,
          your facility name on our Founding Labs page, and priority support during
          your first year. In exchange, you agree to take up to two 30-minute
          reference calls per month from prospective customers. Veritas is not
          present on those calls; you share your honest experience.
        </p>
        <p className="text-sm text-muted-foreground mt-2">
          Limited cohort. Applications are reviewed individually.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle>Application</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="labName">Lab name *</Label>
            <Input id="labName" value={labName} onChange={e => setLabName(e.target.value)} required />
          </div>

          <div>
            <Label htmlFor="cliaNumber">CLIA number (optional)</Label>
            <Input id="cliaNumber" value={cliaNumber} onChange={e => setCliaNumber(e.target.value)}
              placeholder="e.g., 22D1234567" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="contactName">Your name *</Label>
              <Input id="contactName" value={contactName} onChange={e => setContactName(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="contactTitle">Title</Label>
              <Input id="contactTitle" value={contactTitle} onChange={e => setContactTitle(e.target.value)}
                placeholder="e.g., Lab Director" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="contactEmail">Email *</Label>
              <Input id="contactEmail" type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="contactPhone">Phone (optional)</Label>
              <Input id="contactPhone" type="tel" value={contactPhone} onChange={e => setContactPhone(e.target.value)} />
            </div>
          </div>

          <div>
            <Label htmlFor="labType">Lab type</Label>
            <select id="labType" value={labType} onChange={e => setLabType(e.target.value)}
              className="w-full h-10 border border-input bg-background rounded-md px-3 text-sm">
              <option value="">Select...</option>
              <option value="Clinic / Waived">Clinic / Waived</option>
              <option value="Community / Independent">Community / Independent</option>
              <option value="Hospital">Hospital</option>
              <option value="Health System (multi-site)">Health System (multi-site)</option>
              <option value="Reference Lab">Reference Lab</option>
              <option value="Other">Other</option>
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="tierOfInterest">Tier of interest</Label>
              <select id="tierOfInterest" value={tierOfInterest} onChange={e => setTierOfInterest(e.target.value)}
                className="w-full h-10 border border-input bg-background rounded-md px-3 text-sm">
                <option value="">Select...</option>
                <option value="Clinic">Clinic ($999/yr)</option>
                <option value="Community">Community ($2,125/yr)</option>
                <option value="Hospital">Hospital ($4,995/yr)</option>
                <option value="System">System (custom quote)</option>
              </select>
            </div>
            <div>
              <Label htmlFor="approximateSeatCount">Approximate active seats</Label>
              <Input id="approximateSeatCount" type="number" min={1} value={approximateSeatCount}
                onChange={e => setApproximateSeatCount(e.target.value)} placeholder="e.g., 8" />
            </div>
          </div>

          <div>
            <Label htmlFor="whyFounder">Why are you interested in the Founding Lab Program? (optional)</Label>
            <textarea id="whyFounder" value={whyFounder} onChange={e => setWhyFounder(e.target.value)}
              rows={4}
              className="w-full border border-input bg-background rounded-md px-3 py-2 text-sm" />
          </div>

          <div className="flex items-start gap-2">
            <input id="marketingLogoApproval" type="checkbox" checked={marketingLogoApproval}
              onChange={e => setMarketingLogoApproval(e.target.checked)}
              className="mt-1" />
            <Label htmlFor="marketingLogoApproval" className="text-sm font-normal leading-snug">
              I am willing to discuss logo placement on the Founding Labs page (subject to my
              organization's marketing approval). Facility name alone is OK by default.
            </Label>
          </div>

          {submitMutation.isError && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">
              {(submitMutation.error as any)?.message || "Submission failed. Please try again or email info@veritaslabservices.com."}
            </div>
          )}

          <Button
            onClick={() => submitMutation.mutate()}
            disabled={!canSubmit || submitMutation.isPending}
            className="w-full"
            size="lg"
          >
            {submitMutation.isPending && <Loader2 className="animate-spin mr-2" size={16} />}
            Submit application
          </Button>

          <p className="text-xs text-muted-foreground text-center">
            Required fields marked with *. We do not collect patient information; this form
            is for prospective Founding Lab partners only.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
