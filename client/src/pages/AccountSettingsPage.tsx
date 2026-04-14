import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/components/AuthContext";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Save, Tag, Loader2, CheckCircle2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";

const API_BASE = "https://www.veritaslabservices.com";

type AccreditationBody = "CAP" | "TJC" | "COLA" | "AABB";
const ACCREDITATION_OPTIONS: { value: AccreditationBody; label: string; description: string }[] = [
  { value: "CAP",  label: "CAP",  description: "College of American Pathologists" },
  { value: "TJC",  label: "TJC",  description: "The Joint Commission" },
  { value: "COLA", label: "COLA", description: "Commission on Office Laboratory Accreditation" },
  { value: "AABB", label: "AABB", description: "AABB (blood banking / transfusion)" },
];

type PtVendorPref = "none" | "cap" | "api";

interface AccountSettings {
  clia_number: string;
  clia_lab_name: string;
  preferred_standards: AccreditationBody[];
  preferred_pt_vendor: PtVendorPref;
}

export default function AccountSettingsPage() {
  const { isLoggedIn } = useAuth();
  const { toast } = useToast();
  const [cliaNumber, setCliaNumber] = useState("");
  const [labName, setLabName] = useState("");
  const [preferredStandards, setPreferredStandards] = useState<AccreditationBody[]>([]);
  const [preferredPtVendor, setPreferredPtVendor] = useState<PtVendorPref>("none");

  // Module permission constants
  const MODULE_LIST = [
    { key: 'veritacheck',  label: 'VeritaCheck™' },
    { key: 'veritamap',    label: 'VeritaMap™' },
    { key: 'veritascan',   label: 'VeritaScan™' },
    { key: 'veritacomp',   label: 'VeritaComp™' },
    { key: 'veritastaff',  label: 'VeritaStaff™' },
    { key: 'veritapt',     label: 'VeritaPT™' },
    { key: 'veritapolicy', label: 'VeritaPolicy™' },
    { key: 'veritalab',    label: 'VeritaLab™' },
    { key: 'veritatrack',  label: 'VeritaTrack™' },
  ];

  const DEFAULT_PERMISSIONS: Record<string, string> = {
    veritacheck: 'view', veritamap: 'view', veritascan: 'view',
    veritacomp: 'view', veritastaff: 'view', veritapt: 'view',
    veritapolicy: 'view', veritalab: 'view', veritatrack: 'view',
  };

  // Team Members / Seats state
  const [seats, setSeats] = useState<any[]>([]);
  const [seatCount, setSeatCount] = useState(1);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState(false);
  const [invitePermissions, setInvitePermissions] = useState<Record<string, string>>({ ...DEFAULT_PERMISSIONS });
  const [editingSeatId, setEditingSeatId] = useState<number | null>(null);
  const [editingPermissions, setEditingPermissions] = useState<Record<string, string>>({});
  const [savingPermissions, setSavingPermissions] = useState(false);

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

  async function handleInviteSeat(e: React.FormEvent) {
    e.preventDefault();
    setInviteLoading(true);
    setInviteError("");
    setInviteSuccess(false);
    try {
      const res = await fetch(`${API_BASE}/api/account/seats`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, permissions: invitePermissions }),
      });
      const data = await res.json();
      if (!res.ok) {
        setInviteError(data.error || "Failed to send invite.");
      } else {
        setInviteSuccess(true);
        setInviteEmail("");
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
        body: JSON.stringify({ permissions: editingPermissions }),
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

  async function applyDiscount() {
    if (!discountCode.trim()) return;
    setDiscountLoading(true);
    setDiscountError("");
    try {
      const res = await fetch(`${API_BASE}/api/discount/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ code: discountCode.trim(), priceType: "community" }),
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
        body: JSON.stringify({ priceType: "community", discountCode: discountApplied.code }),
      });
      const data = await res.json();
      if (data.url) {
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
      setPreferredStandards(settings.preferred_standards || []);
      setPreferredPtVendor(settings.preferred_pt_vendor || "none");
    }
  }, [settings]);

  useEffect(() => {
    fetchSeats();
  }, []);

  const saveMutation = useMutation({
    mutationFn: () => apiRequest("PUT", "/api/account/settings", {
      clia_number: cliaNumber,
      clia_lab_name: labName,
      preferred_standards: preferredStandards,
      preferredPtVendor,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/account/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/status"] });
      toast({ title: "Settings saved" });
    },
    onError: () => toast({ title: "Failed to save settings", variant: "destructive" }),
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
          <CardTitle className="text-base">Lab Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="clia_number">CLIA Number</Label>
            <Input
              id="clia_number"
              value={cliaNumber}
              onChange={(e) => setCliaNumber(e.target.value)}
              placeholder="e.g. 05D2187634"
              disabled={isLoading}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lab_name">Lab Name</Label>
            <Input
              id="lab_name"
              value={labName}
              onChange={(e) => setLabName(e.target.value)}
              placeholder="e.g. Riverside Regional Medical Center"
              disabled={isLoading}
            />
          </div>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || isLoading}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            <Save size={14} className="mr-1.5" />
            {saveMutation.isPending ? "Saving..." : "Save"}
          </Button>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Accreditation &amp; Standards</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Select up to 2 accreditation bodies. Their standard references will appear on all VeritaCheck and VeritaScan reports. CLSI guidelines and CLIA/CFR citations are always included.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {ACCREDITATION_OPTIONS.map((opt) => {
              const isSelected = preferredStandards.includes(opt.value);
              const isDisabled = !isSelected && preferredStandards.length >= 2;
              return (
                <button
                  key={opt.value}
                  type="button"
                  disabled={isDisabled || isLoading}
                  onClick={() => {
                    if (isSelected) {
                      setPreferredStandards(preferredStandards.filter(s => s !== opt.value));
                    } else if (preferredStandards.length < 2) {
                      setPreferredStandards([...preferredStandards, opt.value]);
                    }
                  }}
                  className={[
                    "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                    isSelected
                      ? "border-primary bg-primary/5"
                      : isDisabled
                      ? "border-muted bg-muted/30 opacity-50 cursor-not-allowed"
                      : "border-border hover:border-primary/50 hover:bg-muted/30",
                  ].join(" ")}
                >
                  <div className={[
                    "mt-0.5 h-4 w-4 shrink-0 rounded border-2 flex items-center justify-center",
                    isSelected ? "border-primary bg-primary" : "border-muted-foreground",
                  ].join(" ")}>
                    {isSelected && (
                      <svg viewBox="0 0 10 8" className="h-2.5 w-2.5 fill-primary-foreground">
                        <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
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
          {preferredStandards.length === 2 && (
            <p className="text-xs text-muted-foreground">Maximum of 2 selected. Deselect one to choose another.</p>
          )}
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || isLoading}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            <Save size={14} className="mr-1.5" />
            {saveMutation.isPending ? "Saving..." : "Save"}
          </Button>
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
                  onClick={() => setPreferredPtVendor(val)}
                  className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                    preferredPtVendor === val
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-background text-foreground border-border hover:border-blue-400"
                  }`}
                >
                  {val === "none" ? "No Preference" : val.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || isLoading}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            <Save size={14} className="mr-1.5" />
            {saveMutation.isPending ? "Saving..." : "Save"}
          </Button>
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
                  <strong>{discountApplied.code}</strong>: {discountApplied.trialDays ? `${discountApplied.trialDays}-day free trial` : `${discountApplied.pct}% off`} via {discountApplied.partnerName}
                </p>
                {discountApplied.trialDays ? (
                  <p className="text-xs text-green-700 mt-0.5">{discountApplied.trialDays}-day free trial - card required</p>
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
              Invite staff to access your VeritaAssure(TM) account. {usedSeats - 1} of {seatCount - 1} additional seat{seatCount - 1 !== 1 ? "s" : ""} used.
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
                              else { setEditingSeatId(seat.id); setEditingPermissions({ ...DEFAULT_PERMISSIONS, ...seatPerms }); }
                            }}
                            className="text-xs text-blue-600 hover:text-blue-800 underline"
                          >
                            {isEditing ? "Cancel" : "Edit Permissions"}
                          </button>
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
                      {!isEditing && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {MODULE_LIST.map(mod => (
                            <span key={mod.key} className={`text-xs px-1.5 py-0.5 rounded ${(seatPerms[mod.key] || 'view') === 'edit' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' : 'bg-muted text-muted-foreground'}`}>
                              {mod.label.replace('(TM)', '')}: {(seatPerms[mod.key] || 'view') === 'edit' ? 'Edit' : 'View'}
                            </span>
                          ))}
                        </div>
                      )}
                      {isEditing && (
                        <div className="mt-2 space-y-2">
                          {MODULE_LIST.map(mod => (
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

                {/* Per-module permission toggles */}
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

                <Button type="submit" disabled={inviteLoading} size="sm" className="w-full">
                  {inviteLoading ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
                  {inviteLoading ? "Sending..." : "Send Invite"}
                </Button>
                {inviteError && <p className="text-xs text-red-500 mt-1">{inviteError}</p>}
                {inviteSuccess && <p className="text-xs text-green-600 mt-1">Invite sent. They will receive an email to create their account.</p>}
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
