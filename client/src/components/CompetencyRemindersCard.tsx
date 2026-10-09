// client/src/components/CompetencyRemindersCard.tsx
//
// VeritaComp "Reminders and escalation" settings (2026-10-08). Michael's design:
// a weekly digest to supervisors of who is coming due (lead days, default 30)
// and who is overdue; escalation to the director the day a competency goes
// overdue, then weekly until it is done; and a monthly 90/60/30 report. Settings
// are VeritaComp setup (read-only for view-only logins). "Preview today's
// emails" shows exactly what the nightly run would send, without sending.

import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { useIsReadOnly } from "@/components/SubscriptionBanner";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { DecimalInput } from "@/components/ui/decimal-input";
import { BellRing, ChevronDown, ChevronUp } from "lucide-react";

interface Recipient { email: string; name?: string }
interface Config {
  enabled: boolean;
  lead_days: number;
  cadence_days: number;
  monthly_report: boolean;
  supervisor_recipients: Recipient[];
  escalation_recipients: Recipient[];
  medical_director_email: string | null;
  configured: boolean;
}
interface PreviewEmail {
  kind: "digest" | "escalation" | "monthly";
  send: boolean;
  why: string;
  recipients: Recipient[];
  recipientsSource: string;
  subject: string;
  text: string;
  items: unknown[];
}

const KIND_LABEL: Record<PreviewEmail["kind"], string> = {
  digest: "Weekly digest to supervisors",
  escalation: "Escalation to the director",
  monthly: "Monthly 90/60/30 report",
};

const toList = (s: string): Recipient[] =>
  s.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean).map((email) => ({ email }));
const toText = (r: Recipient[]) => r.map((x) => x.email).join(", ");

export function CompetencyRemindersCard() {
  const activeLabId = useActiveLabId();
  const readOnly = useIsReadOnly("veritacomp");
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [supervisors, setSupervisors] = useState("");
  const [directors, setDirectors] = useState("");
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<PreviewEmail[] | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const base = activeLabId ? `${API_BASE}/api/labs/${activeLabId}/competency` : null;

  useEffect(() => {
    if (!base) return;
    fetch(`${base}/reminder-config`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((c: Config | null) => {
        if (!c) return;
        setCfg(c);
        setSupervisors(toText(c.supervisor_recipients));
        setDirectors(toText(c.escalation_recipients));
      })
      .catch(() => {});
  }, [base]);

  if (!cfg) return null;

  async function save() {
    if (!base || !cfg) return;
    setSaving(true);
    try {
      const r = await fetch(`${base}/reminder-config`, {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: cfg.enabled, lead_days: cfg.lead_days, cadence_days: cfg.cadence_days, monthly_report: cfg.monthly_report,
          supervisor_recipients: toList(supervisors), escalation_recipients: toList(directors),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { toast({ title: j.error || "Could not save", variant: "destructive" }); return; }
      setCfg({ ...cfg, ...j });
      setSupervisors(toText(j.supervisor_recipients || []));
      setDirectors(toText(j.escalation_recipients || []));
      setPreview(null);
      toast({ title: "Reminder settings saved" });
    } finally { setSaving(false); }
  }

  async function loadPreview() {
    if (!base) return;
    setPreviewing(true);
    try {
      const r = await fetch(`${base}/reminder-preview`, { headers: authHeaders() });
      const j = await r.json().catch(() => ({}));
      if (r.ok) setPreview(j.emails || []);
    } finally { setPreviewing(false); }
  }

  return (
    <Card className="mt-4" data-testid="competency-reminders-card">
      <CardContent className="p-4">
        <button type="button" className="w-full flex items-center justify-between gap-2 text-left" onClick={() => setOpen((o) => !o)} data-testid="competency-reminders-toggle">
          <span className="flex items-center gap-2">
            <BellRing className="h-4 w-4 text-primary" />
            <span className="font-semibold">Reminders and escalation</span>
            <span className={`text-xs px-2 py-0.5 rounded ${cfg.enabled ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`} data-testid="competency-reminders-status">
              {cfg.enabled ? "On" : "Off"}
            </span>
          </span>
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {open && (
          <div className="mt-3 space-y-3">
            <p className="text-xs text-muted-foreground">
              Supervisors get a weekly digest of who is coming due and who is overdue. The day a competency goes overdue it is escalated to the
              director, then weekly until it is done. On the first of each month everyone listed gets the 90/60/30 report.
            </p>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={cfg.enabled} disabled={readOnly} onCheckedChange={(v) => setCfg({ ...cfg, enabled: !!v })} data-testid="competency-reminders-enabled" />
              Send competency reminders and escalations for this lab
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Supervisors (weekly digest)</Label>
                <Input value={supervisors} disabled={readOnly} onChange={(e) => setSupervisors(e.target.value)} placeholder="Emails, comma-separated. Blank = lab owner" data-testid="competency-reminders-supervisors" />
              </div>
              <div>
                <Label className="text-xs">Director (escalations)</Label>
                <Input value={directors} disabled={readOnly} onChange={(e) => setDirectors(e.target.value)}
                  placeholder={cfg.medical_director_email ? `Blank = medical director (${cfg.medical_director_email})` : "Emails, comma-separated. Blank = lab owner"}
                  data-testid="competency-reminders-directors" />
              </div>
              <div>
                <Label className="text-xs">Coming-due window (days)</Label>
                <DecimalInput integer min={1} max={90} value={cfg.lead_days} fallback={30} disabled={readOnly}
                  onChangeNumber={(n) => setCfg({ ...cfg, lead_days: Math.max(1, Math.min(90, n)) })} data-testid="competency-reminders-lead" />
              </div>
              <div>
                <Label className="text-xs">Repeat every (days)</Label>
                <DecimalInput integer min={1} max={30} value={cfg.cadence_days} fallback={7} disabled={readOnly}
                  onChangeNumber={(n) => setCfg({ ...cfg, cadence_days: Math.max(1, Math.min(30, n)) })} data-testid="competency-reminders-cadence" />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={cfg.monthly_report} disabled={readOnly} onCheckedChange={(v) => setCfg({ ...cfg, monthly_report: !!v })} data-testid="competency-reminders-monthly" />
              Monthly 90/60/30 report on the first of the month
            </label>
            <div className="flex flex-wrap gap-2">
              {!readOnly && <Button size="sm" onClick={save} disabled={saving} data-testid="competency-reminders-save">{saving ? "Saving..." : "Save"}</Button>}
              <Button size="sm" variant="outline" onClick={loadPreview} disabled={previewing} data-testid="competency-reminders-preview">
                {previewing ? "Loading..." : "Preview today's emails"}
              </Button>
            </div>
            {preview && (
              <div className="space-y-2" data-testid="competency-reminders-preview-list">
                {preview.map((p) => (
                  <div key={p.kind} className="rounded-md border border-border p-3 text-sm" data-testid={`competency-preview-${p.kind}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{KIND_LABEL[p.kind]}</span>
                      <span className={`text-xs px-2 py-0.5 rounded ${p.send ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" : "bg-muted text-muted-foreground"}`}>
                        {p.send ? (cfg.enabled ? "Sends tonight" : "Would send if turned on") : "Not sending today"}
                      </span>
                      <span className="text-xs text-muted-foreground">{p.why}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">To: {p.recipients.map((r) => r.email).join(", ") || "nobody"} ({p.recipientsSource})</div>
                    <div className="text-xs mt-1"><span className="text-muted-foreground">Subject:</span> {p.subject}</div>
                    <pre className="mt-2 whitespace-pre-wrap text-xs bg-muted/40 rounded p-2 max-h-64 overflow-auto">{p.text}</pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
