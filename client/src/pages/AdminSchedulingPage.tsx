// client/src/pages/AdminSchedulingPage.tsx
//
// Admin-secret-gated page for managing recurring availability rules,
// one-off blackouts, and viewing bookings on the scoping-call calendar.
//
// Auth: x-admin-secret header. Operator types the secret once and it's
// kept in sessionStorage for the page's life.

import { useEffect, useState } from "react";
import { useSEO } from "@/hooks/useSEO";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, RefreshCw } from "lucide-react";

const DOW_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Rule { id: number; day_of_week: number; start_time: string; end_time: string; active: number }
interface Blackout { id: number; blackout_date: string; start_time: string | null; end_time: string | null; reason: string | null }
interface Booking {
  id: number; slot_date: string; slot_start: string; slot_end: string;
  booker_name: string; booker_email: string; lab_name: string | null;
  role: string | null; topic: string | null; status: string; created_at: string;
}

export default function AdminSchedulingPage() {
  useSEO({ title: "Admin Scheduling | Veritas Lab Services", description: "Internal scheduling admin." });

  const [secret, setSecret] = useState(() => sessionStorage.getItem("vls_admin_secret") || "");
  const [authed, setAuthed] = useState(!!sessionStorage.getItem("vls_admin_secret"));
  const [rules, setRules] = useState<Rule[]>([]);
  const [blackouts, setBlackouts] = useState<Blackout[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const [newRule, setNewRule] = useState({ day_of_week: "2", start_time: "14:00", end_time: "16:00" });
  const [newBlackout, setNewBlackout] = useState({ blackout_date: "", start_time: "", end_time: "", reason: "" });

  function adminHeaders() { return { "x-admin-secret": secret, "Content-Type": "application/json" }; }

  async function loadAll() {
    setErr(null);
    try {
      const [r, b, k] = await Promise.all([
        fetch("/api/admin/scheduling/rules?event=scoping-call", { headers: adminHeaders() }),
        fetch("/api/admin/scheduling/blackouts", { headers: adminHeaders() }),
        fetch("/api/admin/scheduling/bookings", { headers: adminHeaders() }),
      ]);
      if (r.status === 403 || b.status === 403 || k.status === 403) {
        setAuthed(false);
        sessionStorage.removeItem("vls_admin_secret");
        return;
      }
      const rd = await r.json();
      const bd = await b.json();
      const kd = await k.json();
      setRules(rd.rules || []);
      setBlackouts(bd.blackouts || []);
      setBookings(kd.bookings || []);
    } catch (e: any) {
      setErr(e?.message || "Could not load.");
    }
  }

  useEffect(() => {
    if (authed) loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  async function addRule() {
    setErr(null);
    const r = await fetch("/api/admin/scheduling/rules", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        event_slug: "scoping-call",
        day_of_week: parseInt(newRule.day_of_week, 10),
        start_time: newRule.start_time,
        end_time: newRule.end_time,
      }),
    });
    if (!r.ok) { const d = await r.json().catch(() => ({})); setErr(d.error || "Could not add rule."); return; }
    setNewRule({ day_of_week: "2", start_time: "14:00", end_time: "16:00" });
    loadAll();
  }
  async function deleteRule(id: number) {
    if (!confirm("Delete this availability rule?")) return;
    await fetch(`/api/admin/scheduling/rules/${id}`, { method: "DELETE", headers: adminHeaders() });
    loadAll();
  }
  async function addBlackout() {
    setErr(null);
    if (!newBlackout.blackout_date) { setErr("Date is required."); return; }
    const body: any = { blackout_date: newBlackout.blackout_date, reason: newBlackout.reason };
    if (newBlackout.start_time && newBlackout.end_time) {
      body.start_time = newBlackout.start_time;
      body.end_time = newBlackout.end_time;
    }
    const r = await fetch("/api/admin/scheduling/blackouts", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify(body),
    });
    if (!r.ok) { const d = await r.json().catch(() => ({})); setErr(d.error || "Could not add blackout."); return; }
    setNewBlackout({ blackout_date: "", start_time: "", end_time: "", reason: "" });
    loadAll();
  }
  async function deleteBlackout(id: number) {
    if (!confirm("Delete this blackout?")) return;
    await fetch(`/api/admin/scheduling/blackouts/${id}`, { method: "DELETE", headers: adminHeaders() });
    loadAll();
  }

  if (!authed) {
    return (
      <div className="container-default py-16 max-w-md">
        <Card>
          <CardContent className="p-6 space-y-4">
            <h1 className="font-serif text-xl font-bold">Admin sign-in</h1>
            <Label htmlFor="sec">Admin secret</Label>
            <Input id="sec" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} />
            <Button
              className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
              onClick={() => { sessionStorage.setItem("vls_admin_secret", secret); setAuthed(true); }}
            >
              Sign in
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container-default py-10 space-y-10">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="font-serif text-3xl font-bold">Scheduling admin</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={loadAll}><RefreshCw size={14} className="mr-1" />Refresh</Button>
          <Button variant="ghost" size="sm" onClick={() => { sessionStorage.removeItem("vls_admin_secret"); setAuthed(false); }}>Sign out</Button>
        </div>
      </div>
      {err && <div className="text-sm text-destructive">{err}</div>}

      {/* Availability rules */}
      <section>
        <h2 className="font-serif text-xl font-bold mb-3">Recurring availability rules</h2>
        <p className="text-sm text-muted-foreground mb-3">
          All times America/Phoenix (operator tz). Bookings only land in slots created by these rules.
        </p>
        <Card className="mb-4">
          <CardContent className="p-4 flex gap-3 flex-wrap items-end">
            <div>
              <Label className="text-xs">Day</Label>
              <select
                className="block w-32 border rounded px-2 py-1.5 text-sm bg-background"
                value={newRule.day_of_week}
                onChange={(e) => setNewRule((r) => ({ ...r, day_of_week: e.target.value }))}
              >
                {DOW_LABEL.map((d, i) => <option key={i} value={i}>{d}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs">Start (HH:MM)</Label>
              <Input className="w-28" value={newRule.start_time} onChange={(e) => setNewRule((r) => ({ ...r, start_time: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">End (HH:MM)</Label>
              <Input className="w-28" value={newRule.end_time} onChange={(e) => setNewRule((r) => ({ ...r, end_time: e.target.value }))} />
            </div>
            <Button size="sm" onClick={addRule}><Plus size={14} className="mr-1" />Add</Button>
          </CardContent>
        </Card>
        <div className="space-y-2">
          {rules.length === 0 && <p className="text-sm text-muted-foreground">No rules yet. Add one above.</p>}
          {rules.map((r) => (
            <Card key={r.id}>
              <CardContent className="p-3 flex items-center justify-between">
                <div className="text-sm">
                  <Badge variant="outline" className="mr-2">{DOW_LABEL[r.day_of_week]}</Badge>
                  {r.start_time} - {r.end_time}
                </div>
                <Button size="sm" variant="ghost" onClick={() => deleteRule(r.id)}><Trash2 size={14} /></Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Blackouts */}
      <section>
        <h2 className="font-serif text-xl font-bold mb-3">Blackouts</h2>
        <p className="text-sm text-muted-foreground mb-3">
          One-off blocks. Leave start/end blank for an all-day blackout.
        </p>
        <Card className="mb-4">
          <CardContent className="p-4 flex gap-3 flex-wrap items-end">
            <div>
              <Label className="text-xs">Date</Label>
              <Input type="date" value={newBlackout.blackout_date} onChange={(e) => setNewBlackout((b) => ({ ...b, blackout_date: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Start (HH:MM, optional)</Label>
              <Input className="w-28" value={newBlackout.start_time} onChange={(e) => setNewBlackout((b) => ({ ...b, start_time: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">End (HH:MM, optional)</Label>
              <Input className="w-28" value={newBlackout.end_time} onChange={(e) => setNewBlackout((b) => ({ ...b, end_time: e.target.value }))} />
            </div>
            <div className="flex-1 min-w-40">
              <Label className="text-xs">Reason</Label>
              <Input value={newBlackout.reason} onChange={(e) => setNewBlackout((b) => ({ ...b, reason: e.target.value }))} />
            </div>
            <Button size="sm" onClick={addBlackout}><Plus size={14} className="mr-1" />Add</Button>
          </CardContent>
        </Card>
        <div className="space-y-2">
          {blackouts.length === 0 && <p className="text-sm text-muted-foreground">No blackouts.</p>}
          {blackouts.map((b) => (
            <Card key={b.id}>
              <CardContent className="p-3 flex items-center justify-between">
                <div className="text-sm">
                  <Badge variant="outline" className="mr-2">{b.blackout_date}</Badge>
                  {b.start_time && b.end_time ? `${b.start_time} - ${b.end_time}` : "All day"}
                  {b.reason ? <span className="text-muted-foreground ml-2">({b.reason})</span> : null}
                </div>
                <Button size="sm" variant="ghost" onClick={() => deleteBlackout(b.id)}><Trash2 size={14} /></Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Bookings */}
      <section>
        <h2 className="font-serif text-xl font-bold mb-3">Bookings (200 most recent)</h2>
        <div className="space-y-2">
          {bookings.length === 0 && <p className="text-sm text-muted-foreground">No bookings yet.</p>}
          {bookings.map((bk) => (
            <Card key={bk.id} className={bk.status === "cancelled" ? "opacity-60" : ""}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                  <div>
                    <span className="font-semibold">{bk.slot_date}</span> {bk.slot_start} - {bk.slot_end}
                    <Badge variant="outline" className="ml-2 text-xs">{bk.status}</Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">{bk.created_at}</span>
                </div>
                <div className="text-sm">
                  <strong>{bk.booker_name}</strong> &lt;{bk.booker_email}&gt;
                  {bk.lab_name ? <span className="text-muted-foreground"> · {bk.lab_name}</span> : null}
                  {bk.role ? <span className="text-muted-foreground"> · {bk.role}</span> : null}
                </div>
                {bk.topic && <div className="text-sm mt-1"><span className="text-muted-foreground">Topic:</span> {bk.topic}</div>}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
