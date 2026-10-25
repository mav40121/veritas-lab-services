// System security settings (server/securityPolicy.ts; Michael Q27 = 1, 2026-10-25). A lab owner sets
// these for their whole system: every lab they own and every lab in an organization they are billing
// owner of. Everything is off until they turn it on. Saving asks for their current password.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient, API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

interface Settings {
  idleMinutes: number | null;
  passwordExpiryDays: number | null;
  passwordHistory: number | null;
  lockoutAttempts: number | null;
  inactiveDays: number | null;
  requireSymbol: boolean;
}
interface Status {
  canManage: boolean;
  settings: Settings & { updatedAt: string | null };
  systemLabs: { id: number; name: string }[];
  systemPeople: number;
}

const FIELDS: { key: keyof Omit<Settings, "requireSymbol">; label: string; help: string; options: [number, string][] }[] = [
  { key: "idleMinutes", label: "Sign out after inactivity", help: "Ends a session after this long with no activity. A one-minute warning appears first.",
    options: [[0, "Off"], [15, "15 minutes"], [30, "30 minutes"], [60, "1 hour"]] },
  { key: "passwordExpiryDays", label: "Password expires after", help: "People choose a new password at their next sign-in once theirs is older than this.",
    options: [[0, "Off"], [90, "90 days"], [180, "180 days"], [365, "1 year"]] },
  { key: "passwordHistory", label: "Block reuse of recent passwords", help: "A new password can't match the current one or this many before it.",
    options: [[0, "Off"], [4, "Last 4"], [8, "Last 8"], [12, "Last 12"]] },
  { key: "lockoutAttempts", label: "Lock the account after wrong passwords", help: "Unlocked by Forgot password, or by a lab owner or admin on the Members page.",
    options: [[0, "Off"], [3, "3 in a row"], [5, "5 in a row"], [10, "10 in a row"]] },
  { key: "inactiveDays", label: "Turn off accounts not used for", help: "A lab owner or admin turns an account back on from the Members page.",
    options: [[0, "Off"], [90, "90 days"], [180, "180 days"], [365, "1 year"]] },
];

const toForm = (s: Settings): Settings => ({ ...s });

export function SecuritySettingsCard() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<Status>({ queryKey: ["/api/auth/security-settings"], staleTime: 0 });
  const [form, setForm] = useState<Settings | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (data?.settings) setForm(toForm(data.settings)); }, [data?.settings]);
  if (isLoading || !data || !data.canManage || !form) return null;

  const labs = data.systemLabs;
  const reach = `${labs.length === 1 ? "your lab" : `all ${labs.length} of your labs`} (${labs.map((l) => l.name).join(", ")}; ${data.systemPeople === 1 ? "1 other person" : `${data.systemPeople} other people`})`;
  const changed = JSON.stringify(form) !== JSON.stringify(toForm(data.settings));

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/security-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ password, settings: form }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { toast({ title: body?.error || "That didn't work", variant: "destructive" }); return; }
      toast({ title: "Security settings saved", description: `They apply to everyone in ${labs.length === 1 ? "your lab" : `your ${labs.length} labs`}.` });
      setPassword("");
      queryClient.invalidateQueries({ queryKey: ["/api/auth/security-settings"] });
    } finally { setBusy(false); }
  }

  return (
    <Card className="mt-6" data-testid="security-settings-card">
      <CardHeader>
        <CardTitle className="text-base">Security settings for your system</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          These apply to everyone in {reach}, including you. People who sign in with your organization's single sign-on follow your
          identity provider's password rules instead. Everything is off until you turn it on.
        </p>
        {FIELDS.map((f) => (
          <div key={f.key} className="space-y-1">
            <Label htmlFor={`sec-${f.key}`}>{f.label}</Label>
            <select
              id={`sec-${f.key}`}
              data-testid={`sec-${f.key}`}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={String(form[f.key] ?? 0)}
              onChange={(e) => setForm({ ...form, [f.key]: Number(e.target.value) || null })}
            >
              {f.options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              {form[f.key] && !f.options.some(([v]) => v === form[f.key]) ? <option value={String(form[f.key])}>{form[f.key]}</option> : null}
            </select>
            <p className="text-[11px] text-muted-foreground">{f.help}</p>
          </div>
        ))}
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" data-testid="sec-requireSymbol" className="mt-1" checked={form.requireSymbol} onChange={(e) => setForm({ ...form, requireSymbol: e.target.checked })} />
          <span>
            Require a symbol in new passwords
            <span className="block text-[11px] text-muted-foreground">On top of the standard rule (at least 8 characters, 3 of 4 character types). Applies when a password is next set.</span>
          </span>
        </label>
        {changed && (
          <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3">
            <Label htmlFor="sec-password">Enter your current password to save</Label>
            <Input id="sec-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <div className="flex gap-2">
              <Button size="sm" disabled={!password || busy} onClick={() => void save()} data-testid="sec-save">
                {busy ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : null}Save security settings
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setForm(toForm(data.settings)); setPassword(""); }}>Cancel</Button>
            </div>
          </div>
        )}
        {data.settings.updatedAt && !changed && (
          <p className="text-[11px] text-muted-foreground">Last changed {new Date(data.settings.updatedAt).toLocaleDateString("en-US")}.</p>
        )}
      </CardContent>
    </Card>
  );
}
