import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/components/AuthContext";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { trackEvent } from "@/lib/analytics";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Save, Tag, Loader2, CheckCircle2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";

const API_BASE = "https://www.veritaslabservices.com";

type AccreditationBody = "CAP" | "TJC" | "COLA" | "AABB";
type AccreditationChoice = "TJC" | "CAP" | "AABB" | "COLA" | "CAP+AABB" | "CLIA";

// Phase 1 (2026-05-01): single-radio accreditation. Six choices.
// CAP+AABB is the only valid multi-accreditor combination (reciprocal
// agreement between CAP and AABB). CLIA is the default for labs with no
// accreditor; CFR/CLIA citations still appear on every report regardless.
const ACCREDITATION_CHOICES: { value: AccreditationChoice; label: string; description: string }[] = [
  { value: "TJC",      label: "TJC",            description: "The Joint Commission" },
  { value: "CAP",      label: "CAP",            description: "College of American Pathologists" },
  { value: "AABB",     label: "AABB",           description: "Blood banking and transfusion services" },
  { value: "COLA",     label: "COLA",           description: "Commission on Office Laboratory Accreditation" },
  { value: "CAP+AABB", label: "CAP + AABB",     description: "For labs holding both under the CAP/AABB reciprocal agreement" },
  { value: "CLIA",     label: "CLIA only",      description: "No accreditor; CLIA-certified only. Federal CFR citations only." },
];

type PtVendorPref = "none" | "cap" | "api";

interface AccountSettings {
  clia_number: string;
  clia_lab_name: string;
  preferred_standards: AccreditationBody[]; // legacy, retained for back-compat
  accreditation_choice: AccreditationChoice;
  preferred_pt_vendor: PtVendorPref;
  // Lab role context from server
  is_seat: boolean;
  owner_name: string | null;
  clia_locked: boolean;
  lab_name_locked: boolean;
  lab_id: number | null;
}

// Map a user's stored plan key to the priceType expected by /api/stripe/checkout
// and /api/discount/validate. Returns null if the user has not selected a paid
// plan that can be activated through this surface.
function planToPriceType(plan: string | undefined | null): string | null {
  if (!plan) return null;
  const map: Record<string, string> = {
    clinic: "waived",
    waived: "waived",
    community: "community",
    hospital: "hospital",
    enterprise: "large_hospital",
    large_hospital: "large_hospital",
    veritacheck_only: "veritacheck_only",
  };
  return map[plan] || null;
}

// GA4 begin_checkout metadata keyed by the actual Stripe priceType the user is
// charged. Used by goToCheckout() to fire the analytics event with the correct
// item_name and value at the moment the Stripe session is created.
const PRICE_TYPE_GA4: Record<string, { item_name: string; price: number }> = {
  waived:           { item_name: "Clinic",        price: 499 },
  community:        { item_name: "Community",     price: 999 },
  hospital:         { item_name: "Hospital",      price: 1999 },
  large_hospital:   { item_name: "Enterprise",    price: 2999 },
  veritacheck_only: { item_name: "VeritaCheck Unlimited", price: 299 },
};

export default function AccountSettingsPage() {
  const { isLoggedIn, user } = useAuth();
  const { toast } = useToast();
  const [cliaNumber, setCliaNumber] = useState("");
  const [labName, setLabName] = useState("");
  const [accreditationChoice, setAccreditationChoice] = useState<AccreditationChoice>("CLIA");
  const [preferredPtVendor, setPreferredPtVendor] = useState<PtVendorPref>("none");

  // Module permission constants. Keys MUST match SEAT_MODULE_KEYS in
  // shared/schema.ts (the resolver and server middleware key off that list).
  // Display order here drives the per-module list when Custom mode is picked.
  const MODULE_LIST = [
    { key: 'veritacheck',  label: 'VeritaCheck™' },
    { key: 'veritamap',    label: 'VeritaMap™' },
    { key: 'veritascan',   label: 'VeritaScan™' },
    { key: 'veritacomp',   label: 'VeritaComp™' },
    { key: 'veritastaff',  label: 'VeritaStaff™' },
    { key: 'veritabench',  label: 'VeritaQA™ Suite' }, // VeritaPace, VeritaShift, VeritaQA
    { key: 'veritastock',  label: 'VeritaStock™' },
    { key: 'veritapt',     label: 'VeritaPT™' },
    { key: 'veritapolicy', label: 'VeritaPolicy™' },
    { key: 'veritalab',    label: 'VeritaLab™' },
    { key: 'veritatrack',  label: 'VeritaTrack™' },
  ];

  const DEFAULT_PERMISSIONS: Record<string, string> = {
    veritacheck: 'view', veritamap: 'view', veritascan: 'view',
    veritacomp: 'view', veritastaff: 'view', veritabench: 'view',
    veritastock: 'view', veritapt: 'view', veritapolicy: 'view',
    veritalab: 'view', veritatrack: 'view',
  };

  // Permission mode -- selected before invite is sent or when editing a seat.
  // null = no mode picked yet (Send Invite is disabled in this state).
  type PermMode = 'edit_all' | 'view_all' | 'custom';

  // Team Members / Seats state
  const [seats, setSeats] = useState<any[]>([]);
  const [seatCount, setSeatCount] = useState(1);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState(false);
  // No default mode at invite -- owner must explicitly pick edit_all,
  // view_all, or custom. Send Invite stays disabled until they do.
  const [inviteMode, setInviteMode] = useState<PermMode | null>(null);
  const [invitePermissions, setInvitePermissions] = useState<Record<string, string>>({ ...DEFAULT_PERMISSIONS });
  const [editingSeatId, setEditingSeatId] = useState<number | null>(null);
  const [editingMode, setEditingMode] = useState<PermMode>('view_all');
  const [editingPermissions, setEditingPermissions] = useState<Record<string, string>>({});
  const [savingPermissions, setSavingPermissions] = useState(false);
  const [copiedSeatId, setCopiedSeatId] = useState<number | null>(null);
  const [copyingSeatId, setCopyingSeatId] = useState<number | null>(null);

  // Infer the current mode from a seat's stored permissions object so the
  // edit dialog opens on the right radio. Mirrors resolveSeatPermission()
  // in shared/schema.ts:
  //   * new mode shape -- read perms.mode directly
  //   * legacy flat map with at least one key AND every present key 'edit'
  //     -> edit_all (auto-upgrade signal; this is what David's seat hits)
  //   * legacy flat map with at least one key AND every present key 'view'
  //     (or missing) -> view_all
  //   * anything mixed -> custom
  function inferModeFromPerms(perms: any): PermMode {
    if (perms && typeof perms.mode === 'string') {
      if (perms.mode === 'edit_all' || perms.mode === 'view_all' || perms.mode === 'custom') {
        return perms.mode;
      }
    }
    if (!perms || typeof perms !== 'object') return 'view_all';
    const presentKeys = Object.keys(perms);
    if (presentKeys.length === 0) return 'view_all';
    const allEdit = presentKeys.every(k => perms[k] === 'edit');
    if (allEdit) return 'edit_all';
    const allView = presentKeys.every(k => perms[k] === 'view');
    if (allView) return 'view_all';
    return 'custom';
  }

  const activeSeats = seats.filter(s => s.status !== "deactivated");
  const usedSeats = activeSeats.length + 1; // +1 for owner

  async function fetchSeats() {
    try {
      const res = await fetch(`${API_BASE}/api/account/seats`, { headers: authHeaders() });
      const data = await res.json();
      setSeats(data.seats || []);
      setSeatCount(data.seat_count || 1);
    } catch {}
  }

  // Build the permissions payload from current mode state. New shape:
  //   { mode: 'edit_all' | 'view_all' }                  -- inherits future modules
  //   { mode: 'custom', overrides: { key: 'view'|'edit', ... } }
  // Server resolver handles both this and the legacy flat map.
  function buildPermPayload(mode: PermMode, custom: Record<string, string>) {
    if (mode === 'custom') return { mode: 'custom', overrides: custom };
    return { mode };
  }

  async function handleInviteSeat(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteMode) {
      setInviteError("Pick a permission level (Edit all, View all, or Custom).");
      return;
    }
    setInviteLoading(true);
    setInviteError("");
    setInviteSuccess(false);
    try {
      const res = await fetch(`${API_BASE}/api/account/seats`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          email: inviteEmail,
          permissions: buildPermPayload(inviteMode, invitePermissions),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setInviteError(data.error || "Failed to send invite.");
      } else {
        setInviteSuccess(true);
        setInviteEmail("");
        setInviteMode(null);
        setInvitePermissions({ ...DEFAULT_PERMISSIONS });
        await fetchSeats();
      }
    } catch {
      setInviteError("Network error. Please try again.");
    } finally {
      setInviteLoading(false);
    }
  }

  async function handleDeactivateSeat(seatId: number) {
    await fetch(`${API_BASE}/api/account/seats/${seatId}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    await fetchSeats();
  }

  async function handleSaveSeatPermissions(seatId: number) {
    setSavingPermissions(true);
    try {
      const res = await fetch(`${API_BASE}/api/account/seats/${seatId}/permissions`, {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          permissions: buildPermPayload(editingMode, editingPermissions),
        }),
      });
      if (res.ok) {
        setEditingSeatId(null);
        await fetchSeats();
      }
    } catch {}
    setSavingPermissions(false);
  }

  // Discount code state
  const [discountCode, setDiscountCode] = useState("");
  const [discountLoading, setDiscountLoading] = useState(false);
  const [discountApplied, setDiscountApplied] = useState<{ code: string; pct: number; partnerName: string; trialDays?: number } | null>(null);
  const [discountError, setDiscountError] = useState("");
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  // Resolve the user's current plan to the Stripe priceType. Used for both
  // discount validation and checkout. If the user is on free/per_study, the
  // Activate Subscription flow falls back to community so the discount panel
  // still works for legacy demo accounts; this should be rare in practice.
  const userPriceType = planToPriceType(user?.plan) || "community";

  async function applyDiscount() {
    if (!discountCode.trim()) return;
    setDiscountLoading(true);
    setDiscountError("");
    try {
      const res = await fetch(`${API_BASE}/api/discount/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ code: discountCode.trim(), priceType: userPriceType }),
      });
      const data = await res.json();
      if (!res.ok || !data.valid) {
        setDiscountError(data.message || data.error || "Invalid discount code.");
      } else {
        setDiscountApplied({ code: discountCode.trim().toUpperCase(), pct: data.discountPct, partnerName: data.partnerName, trialDays: data.trialDays });
        setDiscountError("");
      }
    } catch {
      setDiscountError("Could not validate code. Please try again.");
    } finally {
      setDiscountLoading(false);
    }
  }

  async function goToCheckout() {
    if (!discountApplied) return;
    setCheckoutLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/stripe/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ priceType: userPriceType, discountCode: discountApplied.code }),
      });
      const data = await res.json();
      if (data.url) {
        // Fire GA4 begin_checkout at the moment the Stripe session is actually
        // created, with the real priceType the user is being charged for. This
        // replaces the earlier Subscribe-click event on PricingPage which fired
        // before any checkout existed and could mismatch the actual tier.
        const meta = PRICE_TYPE_GA4[userPriceType];
        if (meta) {
          trackEvent("begin_checkout", {
            currency: "USD",
            value: meta.price,
            items: [{
              item_id: userPriceType,
              item_name: meta.item_name,
              price: meta.price,
              quantity: 1,
            }],
          });
        }
        window.location.href = data.url;
      } else {
        toast({ title: "Checkout error", description: data.error || "Could not start checkout.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Checkout error", description: "Could not start checkout.", variant: "destructive" });
    } finally {
      setCheckoutLoading(false);
    }
  }

  const { data: settings, isLoading } = useQuery<AccountSettings>({
    queryKey: ["/api/account/settings"],
    enabled: isLoggedIn,
  });

  useEffect(() => {
    if (settings) {
      setCliaNumber(settings.clia_number || "");
      setLabName(settings.clia_lab_name || "");
      setAccreditationChoice(settings.accreditation_choice || "CLIA");
      setPreferredPtVendor(settings.preferred_pt_vendor || "none");
    }
  }, [settings]);

  useEffect(() => {
    fetchSeats();
  }, []);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/api/account/settings`, {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          clia_number: cliaNumber,
          clia_lab_name: labName,
          accreditation_choice: accreditationChoice,
          preferredPtVendor,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save settings");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/account/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/status"] });
      toast({ title: "Settings saved" });
    },
    onError: (err: Error) => toast({ title: err.message || "Failed to save settings", variant: "destructive" }),
  });

  if (!isLoggedIn) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-20 text-center">
        <h1 className="text-2xl font-bold mb-4">Account Settings</h1>
        <p className="text-muted-foreground">Sign in to access your account settings.</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="text-xl font-bold mb-6">Account Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Lab Information
            {settings?.clia_locked && settings?.lab_name_locked && !settings?.is_seat && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">Locked for regulatory record integrity</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {settings?.is_seat && settings?.owner_name && (
            <p className="text-sm text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
              Lab settings are managed by {settings.owner_name}.
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor="clia_number">CLIA Number</Label>
            <Input
              id="clia_number"
              value={cliaNumber}
              onChange={(e) => setCliaNumber(e.target.value)}
              placeholder="e.g. 05D2187634"
              disabled={isLoading || !!settings?.is_seat || !!settings?.clia_locked}
            />
            {!settings?.is_seat && settings?.clia_locked && (
              <p className="text-xs text-muted-foreground" title="Locked once the first report was generated under this lab.">
                Locked - contact support to change
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="lab_name">Lab Name</Label>
            <Input
              id="lab_name"
              value={labName}
              onChange={(e) => setLabName(e.target.value)}
              placeholder="e.g. Riverside Regional Medical Center"
              disabled={isLoading || !!settings?.is_seat || !!settings?.lab_name_locked}
            />
            {!settings?.is_seat && settings?.lab_name_locked && (
              <p className="text-xs text-muted-foreground" title="Locked once the first report was generated under this lab.">
                Locked - contact support to change
              </p>
            )}
          </div>
          {!settings?.is_seat && (
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || isLoading}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              <Save size={14} className="mr-1.5" />
              {saveMutation.isPending ? "Saving..." : "Save"}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Accreditation &amp; Standards</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Select your laboratory's accreditation. The corresponding standard references will appear on all VeritaCheck™ and VeritaScan™ reports. CLIA/CFR citations are always included regardless of selection.
          </p>
          {settings?.is_seat && settings?.owner_name && (
            <p className="text-sm text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
              Accreditation settings are managed by {settings.owner_name}.
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {ACCREDITATION_CHOICES.map((opt) => {
              const isSelected = accreditationChoice === opt.value;
              const isSeatDisabled = !!settings?.is_seat;
              return (
                <button
                  key={opt.value}
                  type="button"
                  disabled={isLoading || isSeatDisabled}
                  onClick={() => {
                    if (isSeatDisabled) return;
                    setAccreditationChoice(opt.value);
                  }}
                  className={[
                    "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                    isSelected
                      ? "border-primary bg-primary/5"
                      : isSeatDisabled
                      ? "border-muted bg-muted/30 opacity-50 cursor-not-allowed"
                      : "border-border hover:border-primary/50 hover:bg-muted/30",
                  ].join(" ")}
                >
                  <div className={[
                    "mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 flex items-center justify-center",
                    isSelected ? "border-primary" : "border-muted-foreground",
                  ].join(" ")}>
                    {isSelected && (
                      <div className="h-2 w-2 rounded-full bg-primary" />
                    )}
                  </div>
                  <div>
                    <div className="text-sm font-semibold">{opt.label}</div>
                    <div className="text-xs text-muted-foreground">{opt.description}</div>
                  </div>
                </button>
              );
            })}
          </div>
          {!settings?.is_seat && (
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || isLoading}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              <Save size={14} className="mr-1.5" />
              {saveMutation.isPending ? "Saving..." : "Save"}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Proficiency Testing Preferences</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-2">Preferred PT Vendor</h3>
            <p className="text-xs text-muted-foreground mb-3">
              Your preferred vendor's programs will appear first in PT recommendations.
            </p>
            <div className="flex gap-3">
              {(["none", "cap", "api"] as const).map((val) => (
                <button
                  key={val}
                  onClick={() => !settings?.is_seat && setPreferredPtVendor(val)}
                  disabled={!!settings?.is_seat}
                  className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                    preferredPtVendor === val
                      ? "bg-blue-600 text-white border-blue-600"
                      : settings?.is_seat
                      ? "bg-muted text-muted-foreground border-muted cursor-not-allowed"
                      : "bg-background text-foreground border-border hover:border-blue-400"
                  }`}
                >
                  {val === "none" ? "No Preference" : val.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          {!settings?.is_seat && (
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || isLoading}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              <Save size={14} className="mr-1.5" />
              {saveMutation.isPending ? "Saving..." : "Save"}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Discount Code</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Have a discount code? Enter it below to apply it to your subscription.
          </p>
          {!discountApplied ? (
            <div className="flex gap-2">
              <Input
                value={discountCode}
                onChange={(e) => { setDiscountCode(e.target.value); setDiscountError(""); }}
                onKeyDown={(e) => e.key === "Enter" && applyDiscount()}
                placeholder="Enter code"
                className="max-w-xs"
              />
              <Button
                onClick={applyDiscount}
                disabled={discountLoading || !discountCode.trim()}
                variant="outline"
              >
                {discountLoading ? <Loader2 size={14} className="animate-spin" /> : <Tag size={14} className="mr-1.5" />}
                {discountLoading ? "Checking..." : "Apply"}
              </Button>
            </div>
          ) : (
            <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 flex items-start gap-3">
              <CheckCircle2 size={16} className="text-green-600 mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-green-800">
                  <strong>{discountApplied.code}</strong>: {[discountApplied.trialDays ? `${discountApplied.trialDays}-day free trial` : "", discountApplied.pct ? `${discountApplied.pct}% off` : ""].filter(Boolean).join(" + ")} via {discountApplied.partnerName}
                </p>
                {discountApplied.trialDays ? (
                  <p className="text-xs text-green-700 mt-0.5">{discountApplied.trialDays}-day free trial{discountApplied.pct ? ` + ${discountApplied.pct}% off first year` : ""} - card required</p>
                ) : discountApplied.pct === 100 ? (
                  <p className="text-xs text-green-700 mt-0.5">No payment method required.</p>
                ) : null}
              </div>
              <button
                className="text-xs text-muted-foreground underline"
                onClick={() => { setDiscountApplied(null); setDiscountCode(""); }}
              >
                Remove
              </button>
            </div>
          )}
          {discountError && (
            <p className="text-sm text-red-500">{discountError}</p>
          )}
          {discountApplied && (
            <Button
              onClick={goToCheckout}
              disabled={checkoutLoading}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {checkoutLoading ? <Loader2 size={14} className="animate-spin mr-1.5" /> : null}
              {checkoutLoading ? "Redirecting..." : "Activate Subscription"}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Team Members */}
      {seatCount > 1 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Team Members</CardTitle>
            <p className="text-sm text-muted-foreground">
              Invite staff to access your VeritaAssure™ account. {usedSeats - 1} of {seatCount - 1} additional seat{seatCount - 1 !== 1 ? "s" : ""} used.
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Some hospital and corporate email systems quarantine outside invitations before they reach the inbox. If a teammate hasn&apos;t received their email after a few minutes, click &quot;Copy invite link&quot; on their row and send the link to them directly through email, Teams, Slack, or text.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {activeSeats.length > 0 && (
              <div className="space-y-2">
                {activeSeats.map((seat: any) => {
                  const seatPerms = (() => { try { return typeof seat.permissions === 'string' ? JSON.parse(seat.permissions || '{}') : (seat.permissions || {}); } catch { return {}; } })();
                  const isEditing = editingSeatId === seat.id;
                  return (
                    <div key={seat.id} className="py-2 border-b border-border last:border-0">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-foreground">{seat.seat_email}</p>
                          <p className="text-xs text-muted-foreground capitalize">{seat.status === "active" ? "Active" : "Invite pending"}</p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              if (isEditing) { setEditingSeatId(null); }
                              else {
                                setEditingSeatId(seat.id);
                                // Seed the per-module overrides from the
                                // legacy flat map (or the new overrides
                                // object) so flipping into Custom shows
                                // current values; mode is inferred so the
                                // chooser opens on the right radio.
                                const overrides = (seatPerms && seatPerms.overrides) ? seatPerms.overrides : seatPerms;
                                setEditingPermissions({ ...DEFAULT_PERMISSIONS, ...overrides });
                                setEditingMode(inferModeFromPerms(seatPerms));
                              }
                            }}
                            className="text-xs text-blue-600 hover:text-blue-800 underline"
                          >
                            {isEditing ? "Cancel" : "Edit Permissions"}
                          </button>
                          {seat.status === 'pending' && (
                            <button
                              type="button"
                              disabled={copyingSeatId === seat.id}
                              onClick={async () => {
                                setCopyingSeatId(seat.id);
                                try {
                                  const res = await fetch(`${API_BASE}/api/account/seats/${seat.id}/invite-link`, { headers: authHeaders() });
                                  if (!res.ok) {
                                    const body = await res.json().catch(() => ({}));
                                    throw new Error(body?.error || `Failed to fetch invite link (${res.status})`);
                                  }
                                  const data = await res.json();
                                  const url = data?.url as string;
                                  if (!url) throw new Error('No invite URL returned');
                                  let copied = false;
                                  try {
                                    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                                      await navigator.clipboard.writeText(url);
                                      copied = true;
                                    }
                                  } catch {}
                                  if (!copied) {
                                    // Fallback for browsers without async clipboard API
                                    const ta = document.createElement('textarea');
                                    ta.value = url;
                                    ta.setAttribute('readonly', '');
                                    ta.style.position = 'fixed';
                                    ta.style.left = '-9999px';
                                    document.body.appendChild(ta);
                                    ta.select();
                                    try { copied = document.execCommand('copy'); } catch { copied = false; }
                                    document.body.removeChild(ta);
                                  }
                                  if (copied) {
                                    setCopiedSeatId(seat.id);
                                    setTimeout(() => setCopiedSeatId(prev => (prev === seat.id ? null : prev)), 2000);
                                  } else {
                                    toast({ title: 'Copy failed', description: 'Your browser blocked clipboard access. Long-press or right-click to copy from a prompt.', variant: 'destructive' });
                                    window.prompt('Copy this invite link and send it to your teammate:', url);
                                  }
                                } catch (err: any) {
                                  toast({ title: 'Could not get invite link', description: err?.message || 'Please try again.', variant: 'destructive' });
                                } finally {
                                  setCopyingSeatId(null);
                                }
                              }}
                              className="text-xs underline"
                              style={{ color: '#01696F' }}
                            >
                              {copiedSeatId === seat.id ? 'Copied' : (copyingSeatId === seat.id ? 'Copying...' : 'Copy invite link')}
                            </button>
                          )}
                          <ConfirmDialog
                            title="Remove Team Member?"
                            message="Remove this team member? They will lose access immediately."
                            confirmLabel="Remove"
                            onConfirm={() => handleDeactivateSeat(seat.id)}
                          >
                            <button className="text-xs text-red-600 hover:text-red-800 underline">
                              Remove
                            </button>
                          </ConfirmDialog>
                        </div>
                      </div>
                      {!isEditing && (() => {
                        const summaryMode = inferModeFromPerms(seatPerms);
                        if (summaryMode === 'edit_all') {
                          return (
                            <div className="mt-1">
                              <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">Edit access to all modules</span>
                            </div>
                          );
                        }
                        if (summaryMode === 'view_all') {
                          return (
                            <div className="mt-1">
                              <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">View-only access to all modules</span>
                            </div>
                          );
                        }
                        // Custom -- show per-module chips like before
                        const overrides = (seatPerms && seatPerms.overrides) ? seatPerms.overrides : seatPerms;
                        return (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {MODULE_LIST.map(mod => (
                              <span key={mod.key} className={`text-xs px-1.5 py-0.5 rounded ${(overrides?.[mod.key] || 'view') === 'edit' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' : 'bg-muted text-muted-foreground'}`}>
                                {mod.label.replace('(TM)', '')}: {(overrides?.[mod.key] || 'view') === 'edit' ? 'Edit' : 'View'}
                              </span>
                            ))}
                          </div>
                        );
                      })()}
                      {isEditing && (
                        <div className="mt-2 space-y-2">
                          <div className="flex flex-col gap-1">
                            <p className="text-xs font-medium text-muted-foreground">Permission level</p>
                            <div className="grid grid-cols-3 gap-2">
                              {([
                                { value: 'edit_all', label: 'Edit all', sub: 'Inherits future modules' },
                                { value: 'view_all', label: 'View all', sub: 'Inherits future modules' },
                                { value: 'custom',   label: 'Custom',   sub: 'Per module' },
                              ] as const).map(opt => (
                                <button
                                  key={opt.value}
                                  type="button"
                                  onClick={() => setEditingMode(opt.value)}
                                  className={`text-left p-2 rounded border text-xs transition-colors ${editingMode === opt.value ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40' : 'border-border bg-background hover:border-foreground'}`}
                                >
                                  <div className="font-medium text-foreground">{opt.label}</div>
                                  <div className="text-muted-foreground">{opt.sub}</div>
                                </button>
                              ))}
                            </div>
                          </div>
                          {editingMode === 'custom' && MODULE_LIST.map(mod => (
                            <div key={mod.key} className="flex items-center justify-between py-1">
                              <span className="text-sm text-foreground">{mod.label}</span>
                              <div className="flex gap-1">
                                <button type="button" onClick={() => setEditingPermissions(p => ({ ...p, [mod.key]: 'view' }))}
                                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${editingPermissions[mod.key] === 'view' ? 'bg-muted text-foreground' : 'bg-background border border-border text-muted-foreground hover:border-foreground'}`}>View</button>
                                <button type="button" onClick={() => setEditingPermissions(p => ({ ...p, [mod.key]: 'edit' }))}
                                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${editingPermissions[mod.key] === 'edit' ? 'bg-blue-600 text-white' : 'bg-background border border-border text-muted-foreground hover:border-foreground'}`}>Edit</button>
                              </div>
                            </div>
                          ))}
                          <Button size="sm" onClick={() => handleSaveSeatPermissions(seat.id)} disabled={savingPermissions} className="w-full mt-1">
                            {savingPermissions ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
                            {savingPermissions ? "Saving..." : "Save Permissions"}
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {activeSeats.length === 0 && (
              <p className="text-sm text-muted-foreground">No team members added yet.</p>
            )}
            {usedSeats < seatCount ? (
              <form onSubmit={handleInviteSeat} className="space-y-4">
                <div>
                  <p className="text-sm font-medium text-foreground mb-2">Invite a team member</p>
                  <Input
                    type="email"
                    value={inviteEmail}
                    onChange={e => { setInviteEmail(e.target.value); setInviteSuccess(false); setInviteError(""); }}
                    placeholder="colleague@lab.com"
                    required
                  />
                </div>

                {/* Mode chooser -- owner must pick before Send Invite enables */}
                <div>
                  <p className="text-sm font-medium text-foreground mb-2">Permission level</p>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      { value: 'edit_all', label: 'Edit all', sub: 'Edit every module, including ones added later.' },
                      { value: 'view_all', label: 'View all', sub: 'Read-only across every module.' },
                      { value: 'custom',   label: 'Custom',   sub: 'Choose per module below.' },
                    ] as const).map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => { setInviteMode(opt.value); setInviteError(""); }}
                        className={`text-left p-3 rounded-lg border text-xs transition-colors ${inviteMode === opt.value ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40' : 'border-border bg-background hover:border-foreground'}`}
                      >
                        <div className="font-medium text-foreground text-sm">{opt.label}</div>
                        <div className="text-muted-foreground mt-0.5">{opt.sub}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Per-module permission toggles -- only when Custom is picked */}
                {inviteMode === 'custom' && (
                  <div>
                    <p className="text-sm font-medium text-foreground mb-2">Module Access</p>
                    <div className="space-y-2">
                      {MODULE_LIST.map(mod => (
                        <div key={mod.key} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                          <span className="text-sm text-foreground">{mod.label}</span>
                          <div className="flex gap-1">
                            <button
                              type="button"
                              onClick={() => setInvitePermissions(p => ({ ...p, [mod.key]: 'view' }))}
                              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                                invitePermissions[mod.key] === 'view'
                                  ? 'bg-muted text-foreground'
                                  : 'bg-background border border-border text-muted-foreground hover:border-foreground'
                              }`}
                            >
                              View
                            </button>
                            <button
                              type="button"
                              onClick={() => setInvitePermissions(p => ({ ...p, [mod.key]: 'edit' }))}
                              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                                invitePermissions[mod.key] === 'edit'
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-background border border-border text-muted-foreground hover:border-foreground'
                              }`}
                            >
                              Edit
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <Button type="submit" disabled={inviteLoading || !inviteMode} size="sm" className="w-full">
                  {inviteLoading ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
                  {inviteLoading ? "Sending..." : "Send Invite"}
                </Button>
                {inviteError && <p className="text-xs text-red-500 mt-1">{inviteError}</p>}
                {inviteSuccess && <p className="text-xs text-green-600 mt-1">Invite sent. If they don&apos;t receive the email within a few minutes, use &quot;Copy invite link&quot; to send it directly.</p>}
              </form>
            ) : (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                All seats are in use. Remove a team member to invite someone new.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
