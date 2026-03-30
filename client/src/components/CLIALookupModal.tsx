import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Building2, CheckCircle2, Search, ArrowRight } from "lucide-react";
import { authHeaders } from "@/lib/auth";

const API_BASE = "https://www.veritaslabservices.com";

interface LabData {
  clia_number: string;
  facility_name: string;
  address: string;
  lab_director: string;
  certificate_type: string;
  specialty_count: number;
  tier: string;
  base_price: number;
}

const TIER_LABELS: Record<string, string> = {
  waived: "Waived",
  community: "Community",
  hospital: "Hospital",
  large_hospital: "Large Hospital",
};

interface CLIALookupModalProps {
  open: boolean;
  onClose: () => void;
  onCheckout: (priceType: string) => void;
  discountCode?: string;
}

export default function CLIALookupModal({ open, onClose, onCheckout, discountCode }: CLIALookupModalProps) {
  const [cliaInput, setCliaInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [labData, setLabData] = useState<LabData | null>(null);

  const reset = () => {
    setCliaInput("");
    setLabData(null);
    setError("");
    setLoading(false);
    setConfirming(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const lookupCLIA = async () => {
    const num = cliaInput.trim();
    if (!num || num.length < 5) {
      setError("Please enter a valid CLIA number (at least 5 characters).");
      return;
    }
    setLoading(true);
    setError("");
    setLabData(null);

    try {
      const res = await fetch(`${API_BASE}/api/clia/lookup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clia_number: num }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "CLIA number not found. Please verify and try again.");
        return;
      }
      setLabData(data);
    } catch {
      setError("Could not reach the lookup service. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const confirmLab = async () => {
    if (!labData) return;
    setConfirming(true);
    try {
      const res = await fetch(`${API_BASE}/api/clia/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          clia_number: labData.clia_number,
          facility_name: labData.facility_name,
          address: labData.address,
          lab_director: labData.lab_director,
          specialty_count: labData.specialty_count,
          certificate_type: labData.certificate_type,
          tier: labData.tier,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to confirm lab. Please try again.");
        setConfirming(false);
        return;
      }
      // Proceed to Stripe checkout with the correct tier
      onCheckout(labData.tier);
    } catch {
      setError("Could not confirm lab. Please try again.");
      setConfirming(false);
    }
  };

  const handleVeritaCheckOnly = () => {
    onCheckout("veritacheck_only");
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) handleClose(); }}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 size={20} className="text-primary" />
            Laboratory Verification
          </DialogTitle>
          <DialogDescription>
            Enter your CLIA number to determine your plan and pricing.
          </DialogDescription>
        </DialogHeader>

        {!labData ? (
          /* ── CLIA Input Step ── */
          <div className="space-y-4 pt-2">
            <div>
              <Label htmlFor="clia-input" className="text-sm font-medium">
                CLIA Number
              </Label>
              <div className="flex gap-2 mt-1.5">
                <Input
                  id="clia-input"
                  placeholder="e.g. 05D0668542"
                  value={cliaInput}
                  onChange={(e) => { setCliaInput(e.target.value.toUpperCase()); setError(""); }}
                  onKeyDown={(e) => { if (e.key === "Enter") lookupCLIA(); }}
                  className="font-mono"
                  maxLength={20}
                  disabled={loading}
                />
                <Button onClick={lookupCLIA} disabled={loading || !cliaInput.trim()}>
                  {loading ? (
                    <><Loader2 size={14} className="mr-2 animate-spin" />Looking up...</>
                  ) : (
                    <><Search size={14} className="mr-2" />Look Up My Lab</>
                  )}
                </Button>
              </div>
              {error && <p className="text-sm text-red-500 mt-2">{error}</p>}
            </div>

            <div className="pt-2 border-t">
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-primary underline cursor-pointer"
                onClick={handleVeritaCheckOnly}
              >
                Subscribing to VeritaCheck&#8482; only? Click here -- no CLIA number required.
              </button>
            </div>
          </div>
        ) : (
          /* ── Lab Confirmation Step ── */
          <div className="space-y-4 pt-2">
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="pt-4 pb-4 space-y-2">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle2 size={16} className="text-green-600" />
                  <span className="text-sm font-semibold text-green-700 dark:text-green-400">We found your laboratory:</span>
                </div>
                <div className="space-y-1.5 text-sm">
                  <p className="font-semibold text-base">{labData.facility_name}</p>
                  <p className="text-muted-foreground">{labData.address}</p>
                  <p className="text-muted-foreground">CLIA: <span className="font-mono">{labData.clia_number}</span></p>
                  <p className="text-muted-foreground">Certificate Type: {labData.certificate_type || "N/A"}</p>
                  {labData.lab_director && (
                    <p className="text-muted-foreground">Laboratory Director: {labData.lab_director}</p>
                  )}
                  <p className="text-muted-foreground">Certified Specialties: {labData.specialty_count}</p>
                </div>
                <div className="pt-3 mt-3 border-t border-primary/20">
                  <p className="text-sm font-semibold">
                    Your plan: {TIER_LABELS[labData.tier] || labData.tier} -- ${labData.base_price}/yr (includes first user)
                  </p>
                </div>
              </CardContent>
            </Card>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <div className="flex gap-3">
              <Button
                onClick={confirmLab}
                disabled={confirming}
                className="flex-1"
              >
                {confirming ? (
                  <><Loader2 size={14} className="mr-2 animate-spin" />Confirming...</>
                ) : (
                  <><ArrowRight size={14} className="mr-2" />This is my lab -- Continue to Payment</>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => { setLabData(null); setCliaInput(""); setError(""); }}
                disabled={confirming}
              >
                Search again
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
