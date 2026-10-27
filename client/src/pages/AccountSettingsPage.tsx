import { useState, useEffect } from "react";
import { useIsStaffLogin } from "@/hooks/useStaffLogin";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/components/AuthContext";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { authHeaders, getUser } from "@/lib/auth";
import { passwordProblem, PASSWORD_RULE_TEXT } from "@shared/passwordRule";
import { TwoFactorSetup, RecoveryCodesPanel } from "@/components/TwoFactorStep";
import { SecuritySettingsCard } from "@/components/SecuritySettingsCard";
import { trackEvent } from "@/lib/analytics";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { useMemberships } from "@/hooks/useMemberships";
import { Save, Tag, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { validateClia, CLIA_FORMAT_HINT } from "@shared/validateClia";
import { isStockHost } from "@/lib/host";

const API_BASE = ""; // same-origin: works on the lab site and the separate VeritaStock deployment

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

type PtVendorPref = "none" | "cap" | "api" | "wslh";

interface AccountSettings {
  clia_number: string;
  clia_lab_name: string;
  preferred_standards: AccreditationBody[]; // legacy, retained for back-compat
  accreditation_choice: AccreditationChoice;
  accreditation_iso?: boolean; // ISO 15189 add-on (#108)
  // Per-lab time zone (2026-10-26)
  time_zone?: string;
  time_zone_set?: string | null;
  time_zone_source?: "set" | "clia" | "clia_main_zone" | "default";
  time_zone_state?: string | null;
  time_zone_needs_confirm?: boolean;
  time_zone_choices?: { value: string; label: string; suggested: boolean }[];
  lab_today?: string;
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
  waived:           { item_name: "Clinic",        price: 999 },
  community:        { item_name: "Community",     price: 2125 },
  hospital:         { item_name: "Hospital",      price: 4995 },
  large_hospital:   { item_name: "Enterprise",    price: 2999 },
  veritacheck_only: { item_name: "VeritaCheck Unlimited", price: 299 },
};

export default function AccountSettingsPage() {
  const { isLoggedIn, user } = useAuth();
  const isStaffLogin = useIsStaffLogin();
  const { toast } = useToast();
  const activeLabId = useActiveLabId();
  const { data: memberships } = useMemberships();
  // The /api/account/seats endpoint dates to the platform's original single-
  // lab era (initial commit 2026-03-26) and filters strictly by
  // owner_user_id. It does NOT respect the active lab from the NavBar
  // switcher. So if the operator is viewing this page while switched into
  // a non-primary lab, the Team Members list still shows seats they invited
  // under their OWN account, not seats for the currently active lab.
  //
  // Until seats become lab-scoped (parking-lot: lab_id column on
  // user_seats + UI rework), we surface a banner and hide the invite UI
  // when the active lab is not the user's primary, so the operator does
  // not accidentally manage account-level seats while thinking they are
  // managing a different lab's team.
  // 2026-06-12 fix: isPrimaryLab FOLLOWS the NavBar switcher (POST
  // /api/labs/me/default flips it on every switch), so comparing it to
  // activeLabId was always equal and this guard NEVER fired — Michael saw his
  // personal account's full seat list, with Remove links, while switched into
  // a customer lab (SCAHC, /labs/6). Key on isAccountHomeLab instead: a
  // STATIC flag derived from users.lab_id, which the switcher never touches.
  // Fallback to the old comparison only when the server predates the flag.
  const homeLab = memberships?.find(m => m.isAccountHomeLab)
    ?? memberships?.find(m => m.isPrimaryLab)
    ?? null;
  const isViewingNonPrimaryLab = !!activeLabId && homeLab != null && homeLab.labId !== activeLabId;
  const activeLab = memberships?.find(m => m.labId === activeLabId) ?? null;
  const [cliaNumber, setCliaNumber] = useState("");
  const [labName, setLabName] = useState("");
  const [accreditationChoice, setAccreditationChoice] = useState<AccreditationChoice>("CLIA");
  const [accreditationIso, setAccreditationIso] = useState(false);
  const [timeZone, setTimeZone] = useState<string>("auto");
  const onStock = isStockHost();  // VeritaStock deployment: hide lab/compliance settings
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
    { key: 'veritaops',    label: 'VeritaOps™' },
    { key: 'veritamaintain', label: 'VeritaMaintain™' },
    { key: 'veritaqc', label: 'VeritaQC™' },
    { key: 'veritapt',     label: 'VeritaPT™' },
    { key: 'veritapolicy', label: 'VeritaDC™' },
    { key: 'veritalab',    label: 'VeritaLab™' },
    { key: 'veritatrack',  label: 'VeritaTrack™' },
    { key: 'veritaresponse', label: 'VeritaResponse™' },
  ];

  const DEFAULT_PERMISSIONS: Record<string, string> = {
    veritacheck: 'view', veritamap: 'view', veritascan: 'view',
    veritacomp: 'view', veritastaff: 'view', veritabench: 'view',
    veritastock: 'view', veritapt: 'view', veritapolicy: 'view',
    veritalab: 'view', veritatrack: 'view', veritaresponse: 'view',
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
  // Billing uses the user's OWN plan, not the active-lab overlay on user.plan.
  const userPriceType = planToPriceType(user?.personalPlan ?? user?.plan) || "community";

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
  // 2026-10-14 (Michael, Q195 = 1): labs are set up by the Veritas team after a short call. An account with no lab
  // (and not a seat on someone else's) sees that instead of a lab form whose save used to create a lab.
  const noLab = !!memberships && memberships.length === 0 && !settings?.is_seat;

  useEffect(() => {
    if (settings) {
      setCliaNumber(settings.clia_number || "");
      setLabName(settings.clia_lab_name || "");
      setAccreditationChoice(settings.accreditation_choice || "CLIA");
      setAccreditationIso(!!settings.accreditation_iso);
      setTimeZone(settings.time_zone_set || "auto");
      setPreferredPtVendor(settings.preferred_pt_vendor || "none");
    }
  }, [settings]);

  useEffect(() => {
    fetchSeats();
  }, []);

  // Only a CLIA number someone has typed is format-checked. The value already on file, including a pending
  // placeholder like "PENDING-UNCNASH-2026", never blocks a save: every card on this page sends the whole form, and
  // labs work without a real CLIA (#1633). The server applies the same rule. (Michael 2026-10-21, UNC Health Nash.)
  const cliaInvalid = cliaNumber.trim().length > 0 && !validateClia(cliaNumber).ok;
  const cliaEdited = cliaNumber.trim() !== String(settings?.clia_number ?? "").trim();
  const cliaNeedsFix = cliaInvalid && cliaEdited;
  const cliaPlaceholderOnFile = cliaInvalid && !cliaEdited;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/api/account/settings`, {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          clia_number: cliaNumber,
          clia_lab_name: labName,
          accreditation_choice: accreditationChoice,
          accreditation_iso: accreditationIso,
          time_zone: timeZone,
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
      // The lab list carries the accreditation flags that filter accreditor pickers (VeritaResponse, VeritaStaff);
      // without this a new accreditor appeared there only after a page reload.
      queryClient.invalidateQueries({ queryKey: ["/api/labs/me"] });
      toast({ title: "Settings saved" });
    },
    onError: (err: Error) => toast({ title: err.message || "Failed to save settings", variant: "destructive" }),
  });

  // NYS CLEP Phase-0: jurisdiction confirm. Resolve the lab to act on (active
  // lab, else the account home lab). Only owner/admin may set it; a NYS lab is
  // dual, so NYS-CLEP requires a national accreditor already selected.
  const jurisLab = memberships?.find(m => m.labId === activeLabId)
    ?? memberships?.find(m => m.isAccountHomeLab)
    ?? memberships?.[0];
  const canSetJurisdiction = !!jurisLab && (jurisLab.role === "owner" || jurisLab.role === "admin");
  const hasNationalAccreditor = !!(jurisLab && (jurisLab.accreditationTjc || jurisLab.accreditationCap || jurisLab.accreditationCola));
  const jurisdictionMutation = useMutation({
    mutationFn: async (regime: "CLIA" | "NYS-CLEP") => {
      if (!jurisLab) throw new Error("No lab selected");
      const res = await fetch(`${API_BASE}/api/labs/${jurisLab.labId}/jurisdiction`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ regime }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to update jurisdiction");
      }
      return res.json();
    },
    onSuccess: (_d, regime) => {
      queryClient.invalidateQueries({ queryKey: ["/api/labs/me"] });
      toast({ title: regime === "NYS-CLEP" ? "Jurisdiction set to NYS DOH / CLEP" : "Jurisdiction set to CLIA" });
    },
    onError: (err: Error) => toast({ title: err.message || "Failed to update jurisdiction", variant: "destructive" }),
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
            {onStock ? "Organization" : "Lab Information"}
            {settings?.clia_locked && settings?.lab_name_locked && !settings?.is_seat && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">Locked for regulatory record integrity</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {noLab && (
            <div className="rounded-md border border-primary/30 bg-primary/5 px-4 py-3 text-sm" data-testid="lab-setup-by-staff">
              <p className="font-medium">Your lab is set up by our team.</p>
              <p className="text-muted-foreground mt-1">
                After a short call we create your lab and its owner account. Until then you can explore the Demo Lab.
              </p>
              <a href="/contact" className="inline-block mt-2 text-primary hover:underline font-medium">Talk to our team</a>
            </div>
          )}
          {settings?.is_seat && settings?.owner_name && (
            <p className="text-sm text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
              {onStock ? "Organization settings" : "Lab settings"} are managed by {settings.owner_name}.
            </p>
          )}
          {!onStock && !noLab && (<div className="space-y-2">
            <Label htmlFor="clia_number">CLIA Number</Label>
            <Input
              id="clia_number"
              value={cliaNumber}
              onChange={(e) => setCliaNumber(e.target.value)}
              placeholder="e.g. 22D0070843"
              disabled={isLoading || !!settings?.is_seat || !!settings?.clia_locked}
              aria-invalid={cliaNeedsFix}
            />
            {cliaNeedsFix && (
              <p className="text-xs text-destructive">{CLIA_FORMAT_HINT}</p>
            )}
            {cliaPlaceholderOnFile && (
              <p className="text-xs text-muted-foreground" data-testid="clia-pending-note">
                Not a CLIA number yet. Enter the lab's 10-character CLIA number when you have it; everything else works without it.
              </p>
            )}
            {!settings?.is_seat && settings?.clia_locked && (
              <p className="text-xs text-muted-foreground" title="Locked once the first report was generated under this lab.">
                Locked - contact support to change
              </p>
            )}
          </div>)}
          {!noLab && (<div className="space-y-2">
            <Label htmlFor="lab_name">{onStock ? "Organization Name" : "Lab Name"}</Label>
            <Input
              id="lab_name"
              value={labName}
              onChange={(e) => setLabName(e.target.value)}
              placeholder={onStock ? "e.g. San Carlos Apache Healthcare" : "e.g. Riverside Regional Medical Center"}
              disabled={isLoading || !!settings?.is_seat || !!settings?.lab_name_locked}
            />
            {!settings?.is_seat && settings?.lab_name_locked && (
              <p className="text-xs text-muted-foreground" title="Locked once the first report was generated under this lab.">
                Locked - contact support to change
              </p>
            )}
          </div>)}
          {/* Per-lab time zone (2026-10-26): the lab's calendar day for dates, due dates and reminders. */}
          {!noLab && settings?.time_zone && (() => {
            const choices = settings.time_zone_choices || [];
            const label = (v?: string | null) => choices.find((c) => c.value === v)?.label || v || "";
            const autoText = settings.time_zone_source === "set"
              ? "Automatic (from the CLIA state)"
              : settings.time_zone_source === "clia"
              ? `Automatic: ${label(settings.time_zone)} (from the CLIA state, ${settings.time_zone_state})`
              : settings.time_zone_source === "clia_main_zone"
              ? `Automatic: ${label(settings.time_zone)} (most of ${settings.time_zone_state}; please confirm)`
              : `Automatic: ${label(settings.time_zone)} (no CLIA state on file; please confirm)`;
            const sorted = [...choices.filter((c) => c.suggested), ...choices.filter((c) => !c.suggested)];
            return (
              <div className="space-y-2">
                <Label htmlFor="lab_time_zone">Time zone</Label>
                <Select value={timeZone} onValueChange={setTimeZone} disabled={isLoading || !!settings?.is_seat}>
                  <SelectTrigger id="lab_time_zone" className="h-9 text-sm" data-testid="lab-time-zone"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">{autoText}</SelectItem>
                    {sorted.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Dates, due dates and reminders use the lab's calendar day in this zone. Today in the lab: <span data-testid="lab-today">{settings.lab_today}</span>.
                </p>
                {settings.time_zone_needs_confirm && !settings.time_zone_set && (
                  <p className="text-xs text-amber-700 dark:text-amber-400" data-testid="lab-time-zone-confirm">
                    {settings.time_zone_state
                      ? `${settings.time_zone_state} spans more than one time zone. Pick yours and save.`
                      : "Pick your lab's time zone and save."}
                  </p>
                )}
              </div>
            );
          })()}
          {!settings?.is_seat && !noLab && (
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={
                saveMutation.isPending ||
                isLoading ||
                cliaNeedsFix
              }
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              <Save size={14} className="mr-1.5" />
              {saveMutation.isPending ? "Saving..." : "Save"}
            </Button>
          )}
        </CardContent>
      </Card>

      <ChangePasswordCard />

      <TwoFactorCard />
      <SecuritySettingsCard />

      <SignedInDevicesCard />

      {!onStock && (<>
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
          {/* ISO 15189 (#108): an add-on to the choice above, never a replacement. A lab accredited to ISO 15189 still
              holds its CLIA certificate through the accreditor (or state survey) selected above. */}
          <label
            className={[
              "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
              accreditationIso ? "border-primary bg-primary/5" : "border-border",
              settings?.is_seat ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:border-primary/50",
            ].join(" ")}
          >
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 accent-[#01696F]"
              checked={accreditationIso}
              disabled={isLoading || !!settings?.is_seat}
              onChange={(e) => setAccreditationIso(e.target.checked)}
              data-testid="accreditation-iso"
            />
            <div>
              <div className="text-sm font-semibold">Also accredited to ISO 15189</div>
              <div className="text-xs text-muted-foreground">
                Medical laboratory quality and competence standard (for example through CAP 15189). This is in addition to
                the accreditation selected above, which still covers your CLIA certificate. Adds ISO 15189 to VeritaResponse™
                findings and VeritaStaff™. ISO clause references are not yet on reports.
              </div>
            </div>
          </label>
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

      {jurisLab && (
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Laboratory Jurisdiction</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            New York laboratories are regulated by NYS DOH / CLEP (10 NYCRR Part 58), not by CLIA. A New York lab is dual: CLEP plus a national accreditor (TJC, CAP, or COLA). This setting affects only a New York lab; it never changes anything for a CLIA lab.
          </p>
          {jurisLab.primaryRegime !== "NYS-CLEP" && jurisLab.nysSuggested && (
            <p className="text-sm bg-blue-500/10 text-blue-800 dark:text-blue-300 rounded-md px-3 py-2">
              This lab appears to be in New York. Switch to NYS DOH / CLEP to enable New York specific requirements.
            </p>
          )}
          {jurisLab.primaryRegime !== "NYS-CLEP" && !hasNationalAccreditor && (
            <p className="text-sm text-muted-foreground">
              Select a national accreditor (TJC, CAP, or COLA) above before setting this lab to NYS DOH / CLEP.
            </p>
          )}
          {/* Two-state segmented control: active regime highlighted; switching
              opens a confirm dialog (jurisdiction re-frames the lab's compliance
              context). The NYS segment stays gated on a national accreditor, and
              the whole control is read-only unless the user can set jurisdiction. */}
          {(() => {
            const isClep = jurisLab.primaryRegime === "NYS-CLEP";
            const accSuffix = jurisLab.accreditationTjc ? " + TJC" : jurisLab.accreditationCap ? " + CAP" : jurisLab.accreditationCola ? " + COLA" : "";
            const seg = "px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";
            return (
              <div className="inline-flex rounded-md border border-input overflow-hidden" role="group" aria-label="Laboratory jurisdiction">
                {/* CLIA (federal) */}
                {!isClep ? (
                  <span className={`${seg} bg-primary text-primary-foreground`} aria-current="true">CLIA (federal)</span>
                ) : canSetJurisdiction ? (
                  <ConfirmDialog
                    title="Switch jurisdiction to CLIA?"
                    message="This lab will be regulated under CLIA (federal), and New York specific requirements will be turned off. You can switch back to NYS DOH / CLEP at any time."
                    confirmLabel="Switch to CLIA"
                    onConfirm={() => jurisdictionMutation.mutate("CLIA")}
                  >
                    <button type="button" disabled={jurisdictionMutation.isPending} className={`${seg} bg-background text-muted-foreground hover:bg-muted`}>CLIA (federal)</button>
                  </ConfirmDialog>
                ) : (
                  <span className={`${seg} bg-background text-muted-foreground`}>CLIA (federal)</span>
                )}
                <div className="w-px bg-input" aria-hidden="true" />
                {/* NYS DOH / CLEP */}
                {isClep ? (
                  <span className={`${seg} bg-blue-600 text-white`} aria-current="true">{`NYS DOH / CLEP${accSuffix}`}</span>
                ) : canSetJurisdiction && hasNationalAccreditor ? (
                  <ConfirmDialog
                    title="Switch jurisdiction to NYS DOH / CLEP?"
                    message="This lab will be regulated under New York State DOH / CLEP (10 NYCRR Part 58); CLIA oversight no longer applies, and New York specific requirements are enabled. You can revert to CLIA at any time."
                    confirmLabel="Switch to NYS DOH / CLEP"
                    onConfirm={() => jurisdictionMutation.mutate("NYS-CLEP")}
                  >
                    <button type="button" disabled={jurisdictionMutation.isPending} className={`${seg} bg-background text-muted-foreground hover:bg-muted`}>NYS DOH / CLEP</button>
                  </ConfirmDialog>
                ) : (
                  <span className={`${seg} bg-background text-muted-foreground/60 cursor-not-allowed`} title={!hasNationalAccreditor ? "Select a national accreditor first" : undefined}>NYS DOH / CLEP</span>
                )}
              </div>
            );
          })()}
          {!canSetJurisdiction && (
            <p className="text-sm text-muted-foreground">Only the laboratory director or designee (owner or admin) can set jurisdiction.</p>
          )}
        </CardContent>
      </Card>
      )}

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
              {(["none", "cap", "api", "wslh"] as const).map((val) => (
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
      </>)}

      {/* #84 Phase 3: buying or discounting the lab's subscription is the
          owner's job; a Staff login never sees it. */}
      {!isStaffLogin && <Card className="mt-6">
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
      </Card>}

      {/* Team Members */}
      {seatCount > 1 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Team Members</CardTitle>
            {isViewingNonPrimaryLab && (
              <div className="mt-2 rounded-md border border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 flex items-start gap-2">
                <AlertTriangle size={14} className="text-amber-600 mt-0.5 shrink-0" />
                <div className="text-xs text-amber-900 dark:text-amber-200">
                  These are seats on your account ({user?.email}). They are not tied to the lab you have selected above ({activeLab?.labName || "this lab"}).{" "}
                  {(activeLab?.role === "owner" || activeLab?.role === "admin") ? (
                    <>You are {activeLab.role === "admin" ? "an admin" : "the owner"} of that lab, so you can manage its team on the{" "}
                      <a href={`/labs/${activeLabId}/members`} className="underline font-medium">Lab Members page</a>.</>
                  ) : (
                    <>To manage team members for that lab, contact its owner or an admin.</>
                  )}
                </div>
              </div>
            )}
            {!isViewingNonPrimaryLab && (
              <>
                <p className="text-sm text-muted-foreground">
                  Invite staff to access your {onStock ? "VeritaStock™" : "VeritaAssure™"} account. {usedSeats - 1} of {seatCount - 1} additional seat{seatCount - 1 !== 1 ? "s" : ""} used.
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  Some hospital and corporate email systems quarantine outside invitations before they reach the inbox. If a teammate hasn&apos;t received their email after a few minutes, click &quot;Copy invite link&quot; on their row and send the link to them directly through email, Teams, Slack, or text.
                </p>
              </>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {/* On a non-home lab, the banner in the header is the whole story:
                these are ACCOUNT seats, not this lab's team. Hide the
                management list so Remove/Edit cannot be clicked in the wrong
                mental context (2026-06-12 fix). */}
            {!isViewingNonPrimaryLab && activeSeats.length > 0 && (
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
            {!isViewingNonPrimaryLab && activeSeats.length === 0 && (
              <p className="text-sm text-muted-foreground">No team members added yet.</p>
            )}
            {/* On a non-home lab, render neither the invite form NOR the
                "all seats in use" warning — both are account-seat UI. */}
            {!isViewingNonPrimaryLab && (usedSeats < seatCount ? (
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
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// Change Password card. Self-serve: verifies current password against the
// server, then sets a new one. Server enforces the password rule
// (shared/passwordRule.ts) and that new != current, and signs out every other
// device. UI also enforces that the two new-password fields match before
// submit, so users see the validation client-side too.
function ChangePasswordCard() {
  const { toast } = useToast();
  const { login } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const pwProblem = passwordProblem(newPassword);
    if (pwProblem) {
      toast({ title: "Pick a stronger password", description: pwProblem, variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "Passwords do not match", description: "Re-enter the new password to confirm.", variant: "destructive" });
      return;
    }
    if (newPassword === currentPassword) {
      toast({ title: "Pick a different password", description: "Your new password must be different from your current password.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/change-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        toast({ title: "Could not change password", description: data?.error || "Please try again.", variant: "destructive" });
      } else {
        // A sign-in from before session binding gets a fresh session back; keep this tab signed in on it.
        const me = getUser();
        if (data.token && me) {
          login(data.token, me);
          if (data.session_token) { try { localStorage.setItem("veritas_session_token", data.session_token); } catch {} }
        }
        const others = Number(data.signedOutOthers || 0);
        toast({ title: "Password updated", description: others > 0 ? "Your password has been changed. Your other devices were signed out." : "Your password has been changed." });
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        queryClient.invalidateQueries({ queryKey: ["/api/auth/sessions"] });
      }
    } catch (err: any) {
      toast({ title: "Network error", description: String(err?.message || err), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="text-base">Change Password</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="current-password">Current password</Label>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={8}
              required
            />
            <p className="text-xs text-muted-foreground">{PASSWORD_RULE_TEXT} Changing it signs out your other devices.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm new password</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              minLength={8}
              required
            />
          </div>
          <Button type="submit" disabled={submitting || !currentPassword || !newPassword || !confirmPassword}>
            {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Update password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}


// Two-factor sign-in (Stage 2, mock Q171 = 1). Turn it on (authenticator app or email codes),
// new recovery codes, move to a new phone, and turn it off when no lab requires it.
// A lab owner's switch covers their whole system (Michael 2026-10-15, recording 1): turning it on
// here also requires it for everyone in every lab they own; turning it off lifts that.
interface TwoFactorStatus {
  enabled: boolean; method: "totp" | "email" | null; enabledAt: string | null; recoveryCodesLeft: number;
  email: string | null; required: boolean; requiredBy: string; canTurnOff: boolean; isDemo: boolean;
  systemLabs: { id: number; name: string }[]; systemPeople: number; systemRequired: boolean;
}

function systemText(s: TwoFactorStatus): string {
  const names = s.systemLabs.map((l) => l.name).join(", ");
  const people = s.systemPeople === 1 ? "1 other person" : `${s.systemPeople} other people`;
  return `${s.systemLabs.length === 1 ? "your lab" : `all ${s.systemLabs.length} of your labs`} (${names}; ${people})`;
}

function TwoFactorCard() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<TwoFactorStatus>({ queryKey: ["/api/auth/mfa"], staleTime: 0 });
  const [mode, setMode] = useState<"idle" | "setup" | "move" | "codes" | "off">("idle");
  const [password, setPassword] = useState("");
  const [passwordOk, setPasswordOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/auth/mfa"] });
  const reset = () => { setMode("idle"); setPassword(""); setPasswordOk(false); setCodes(null); };

  if (isLoading || !data || data.isDemo) return null;

  async function withPassword(path: string, done: (body: any) => void) {
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ password }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { toast({ title: body?.error || "That didn't work", variant: "destructive" }); return; }
      done(body);
    } finally { setBusy(false); }
  }

  async function requireSystem() {
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/mfa/require-system`, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: "{}" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { toast({ title: body?.error || "That didn't work", variant: "destructive" }); return; }
      toast({ title: "Two-factor sign-in is now required for everyone in your labs" });
      refresh();
    } finally { setBusy(false); }
  }

  const methodText = data.method === "email" ? "Email codes" : "Authenticator app";
  const on = data.enabled;
  const owner = (data.systemLabs || []).length > 0;
  const needsPassword = (mode === "move" || mode === "codes" || mode === "off") && !passwordOk && !codes;

  return (
    <Card className="mt-6" data-testid="two-factor-card">
      <CardHeader>
        <CardTitle className="text-base flex items-center justify-between">
          Two-factor sign-in
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${on ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" : "bg-muted text-muted-foreground"}`}>{on ? "ON" : "OFF"}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {mode === "setup" || (mode === "move" && passwordOk) ? (
          <TwoFactorSetup
            password={mode === "move" ? password : undefined}
            requireSystem={mode === "setup" && owner}
            onDone={() => { toast({ title: mode === "setup" && owner ? "Two-factor sign-in is on, and required for everyone in your labs" : "Two-factor sign-in is on" }); reset(); refresh(); }}
            onCancel={reset}
          />
        ) : codes ? (
          <RecoveryCodesPanel codes={codes} continueLabel="Done" onContinue={() => { reset(); refresh(); }} />
        ) : needsPassword ? (
          <div className="space-y-2">
            <Label htmlFor="mfa-password">Enter your current password to continue</Label>
            {mode === "off" && data.systemRequired && (
              <p className="text-xs text-muted-foreground" data-testid="mfa-off-system-note">
                Turning it off also stops requiring it for everyone in {systemText(data)}.
              </p>
            )}
            <Input id="mfa-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <div className="flex gap-2">
              <Button size="sm" disabled={!password || busy} onClick={() => {
                if (mode === "move") { setPasswordOk(true); return; }
                if (mode === "codes") void withPassword("/api/auth/mfa/recovery-codes", (b) => setCodes(b.recovery_codes || []));
                if (mode === "off") void withPassword("/api/auth/mfa/turn-off", () => { toast({ title: "Two-factor sign-in is off" }); reset(); refresh(); });
              }}>
                {busy ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : null}
                {mode === "off" ? "Turn off" : "Continue"}
              </Button>
              <Button size="sm" variant="outline" onClick={reset}>Cancel</Button>
            </div>
          </div>
        ) : on ? (
          <>
            <div className="text-sm space-y-0.5">
              <p>{methodText}, turned on {data.enabledAt ? new Date(data.enabledAt).toLocaleDateString("en-US") : ""}</p>
              <p>Recovery codes: {data.recoveryCodesLeft} of 10 left</p>
              {data.email && <p>Backup: email codes to {data.email}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setMode("codes")}>New recovery codes</Button>
              <Button size="sm" variant="outline" onClick={() => setMode("move")}>{data.method === "email" ? "Use an authenticator app" : "Move to a new phone"}</Button>
              {data.canTurnOff && <Button size="sm" variant="outline" onClick={() => setMode("off")}>Turn off</Button>}
            </div>
            {owner && (data.systemRequired ? (
              <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs" data-testid="mfa-system-on">
                Required for everyone in {systemText(data)}. People without it set it up at their next sign-in.
              </p>
            ) : (
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs space-y-2" data-testid="mfa-system-off">
                <p>Not yet required for the people in {systemText(data)}.</p>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void requireSystem()} data-testid="mfa-require-system">
                  Require it for everyone in my labs
                </Button>
              </div>
            ))}
            {data.required && (
              <p className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                {data.requiredBy === "Veritas Lab Services" ? "Veritas Lab Services accounts require two-factor sign-in" : `${data.requiredBy || "Your lab"} requires two-factor sign-in`}, so it cannot be turned off here.
              </p>
            )}
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              After your password, enter a 6-digit code from an app on your phone, or one we email you. {data.required ? `${data.requiredBy} requires it, so you'll set it up at your next sign-in, or now.` : owner ? "" : "Anyone can turn it on for their own account."}
            </p>
            {owner && (
              <p className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200" data-testid="mfa-system-warning">
                As the lab owner, turning it on here also requires it for everyone in {systemText(data)}. Each person sets it up at their next sign-in.
              </p>
            )}
            <Button size="sm" onClick={() => setMode("setup")}>Turn on</Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// Signed-in devices (two-factor sign-in Stage 1, mock Q171 = 1). Every active
// sign-in for this person; "Sign out" on another device ends it at once, and
// "Sign out all other devices" ends every one but this.
interface SignedInSession { id: number; device: string; signedInAt: string; lastActive: string; current: boolean }

function lastActiveText(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  if (Date.now() - t < 5 * 60 * 1000) return "active now";
  return `last active ${new Date(t).toLocaleDateString("en-US")}`;
}

function SignedInDevicesCard() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<{ sessions: SignedInSession[]; currentKnown: boolean }>({
    queryKey: ["/api/auth/sessions"],
    staleTime: 0,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const sessions = data?.sessions || [];
  const others = sessions.filter((s) => !s.current);

  async function post(url: string, key: string, done: string) {
    setBusy(key);
    try {
      const res = await apiRequest("POST", url);
      await res.json().catch(() => ({}));
      toast({ title: done });
    } catch (err: any) {
      toast({ title: "Could not sign out", description: String(err?.message || err).replace(/^\d+:\s*/, ""), variant: "destructive" });
    } finally {
      setBusy(null);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/sessions"] });
    }
  }

  return (
    <Card className="mt-6" data-testid="signed-in-devices">
      <CardHeader>
        <CardTitle className="text-base">Signed-in devices</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No signed-in devices to show.</p>
        ) : (
          <ul className="space-y-2">
            {sessions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2" data-testid={`session-${s.id}`}>
                <div className="text-sm min-w-0">
                  <span className={s.current ? "font-semibold" : ""}>{s.current ? "This computer" : s.device}</span>
                  <span className="text-xs text-muted-foreground">
                    {s.current ? ` · ${s.device} · active now` : ` · ${lastActiveText(s.lastActive)}`}
                  </span>
                </div>
                {s.current ? (
                  <span className="text-xs text-muted-foreground">current</span>
                ) : (
                  <Button size="sm" variant="outline" disabled={!!busy} onClick={() => post(`/api/auth/sessions/${s.id}/sign-out`, `one-${s.id}`, `${s.device} signed out`)}>
                    {busy === `one-${s.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Sign out"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {others.length > 0 && data?.currentKnown && (
          <Button variant="outline" size="sm" disabled={!!busy} onClick={() => post("/api/auth/sessions/sign-out-others", "others", "Your other devices were signed out")}>
            {busy === "others" ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : null}
            Sign out all other devices
          </Button>
        )}
        {data && !data.currentKnown && (
          <p className="text-xs text-muted-foreground">Sign out and sign in again to manage your other devices from here.</p>
        )}
      </CardContent>
    </Card>
  );
}
