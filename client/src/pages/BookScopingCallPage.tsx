// client/src/pages/BookScopingCallPage.tsx
//
// Public booking page for the consulting scoping call.
//
// Flow:
//   1. Page mounts, fetches event-type info + availability for the next
//      30 days.
//   2. User picks a date from the date row.
//   3. User clicks a slot to open the booker form.
//   4. Submit -> POST /api/scheduling/book.
//   5. Confirmation screen with the booking token.
//
// All times are stored on the server in America/Phoenix (operator tz).
// This page shows each slot in BOTH operator tz and the booker's local
// tz so there is no confusion about which time the booker is signing
// up for.

import { useEffect, useMemo, useState } from "react";
import { useSEO } from "@/hooks/useSEO";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, Clock, CheckCircle2, AlertCircle, MapPin } from "lucide-react";

interface Slot {
  date: string;        // YYYY-MM-DD operator tz
  start_time: string;  // HH:MM operator tz
  end_time: string;    // HH:MM operator tz
  duration_minutes: number;
}
interface EventType {
  id: number;
  slug: string;
  title: string;
  duration_minutes: number;
  description: string;
  operator_tz: string;
}
interface AvailabilityResponse {
  event_slug: string;
  duration_minutes: number;
  operator_tz: string;
  from: string;
  to: string;
  slots: Slot[];
}

const EVENT_SLUG = "scoping-call";

function formatOperatorTime(date: string, time: string): string {
  // Format the operator-tz slot as a friendly string, e.g. "Tue Jun 3 at 2:00 PM"
  const [h, m] = time.split(":").map((s) => parseInt(s, 10));
  const d = new Date(date + "T12:00:00Z");
  const day = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${day} at ${h12}:${m < 10 ? "0" + m : m} ${ampm}`;
}

function formatBookerLocalTime(date: string, time: string, operatorTz: string): string | null {
  // Convert operator-tz slot to booker's local tz for display
  try {
    const [y, mo, d] = date.split("-").map((s) => parseInt(s, 10));
    const [h, m] = time.split(":").map((s) => parseInt(s, 10));
    // Phoenix is UTC-7 year-round. Build an ISO with that offset.
    // (Phase 2 can swap this for a real tz lib if other event types
    // need DST-aware operator tzs.)
    const offsetIso = `${date}T${time}:00-07:00`;
    void y; void mo; void d; void h; void m; void operatorTz;
    const utc = new Date(offsetIso);
    if (isNaN(utc.getTime())) return null;
    const local = utc.toLocaleString(undefined, {
      weekday: "short", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit", timeZoneName: "short",
    });
    return local;
  } catch {
    return null;
  }
}

export default function BookScopingCallPage() {
  useSEO({
    title: "Book a 30-Minute Scoping Call | Veritas Lab Services",
    description:
      "Schedule a no-cost 30-minute scoping call with Michael Veri, MS, MBA, MLS(ASCP), CPHQ, former TJC Laboratory Surveyor with 200+ surveys conducted. Confirms engagement fit, scope, and price before any paper changes hands.",
  });

  const [eventType, setEventType] = useState<EventType | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<{ token: string; slot: Slot } | null>(null);

  const [form, setForm] = useState({
    booker_name: "",
    booker_email: "",
    booker_phone: "",
    lab_name: "",
    role: "",
    topic: "",
    message: "",
    website: "", // honeypot
  });

  // Compute date range: today + 30 days
  const { fromDate, toDate } = useMemo(() => {
    const t = new Date();
    const from = t.toISOString().slice(0, 10);
    const to = new Date(t.getTime() + 30 * 86400 * 1000).toISOString().slice(0, 10);
    return { fromDate: from, toDate: to };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const etRes = await fetch(`/api/scheduling/event-types/${EVENT_SLUG}`);
        if (!etRes.ok) throw new Error("Event type not available");
        const et: EventType = await etRes.json();
        if (cancelled) return;
        setEventType(et);
        const avRes = await fetch(`/api/scheduling/availability?event=${EVENT_SLUG}&from=${fromDate}&to=${toDate}`);
        if (!avRes.ok) throw new Error("Could not load availability");
        const av: AvailabilityResponse = await avRes.json();
        if (cancelled) return;
        setSlots(av.slots);
        // Auto-select the first day with slots
        const firstDay = av.slots[0]?.date ?? null;
        setSelectedDate(firstDay);
      } catch (e: any) {
        if (!cancelled) setLoadError(e?.message || "Could not load the calendar.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fromDate, toDate]);

  const availableDates = useMemo(() => {
    const set = new Set<string>();
    for (const s of slots) set.add(s.date);
    return Array.from(set).sort();
  }, [slots]);

  const slotsForSelected = useMemo(
    () => slots.filter((s) => s.date === selectedDate),
    [slots, selectedDate]
  );

  const bookerTz = (() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; }
  })();

  async function submitBooking(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSlot) return;
    setSubmitError(null);
    if (!form.booker_name.trim()) { setSubmitError("Name is required."); return; }
    if (!form.booker_email.trim()) { setSubmitError("Email is required."); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/scheduling/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_slug: EVENT_SLUG,
          slot_date: selectedSlot.date,
          slot_start: selectedSlot.start_time,
          booker_tz: bookerTz,
          ...form,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSubmitError(data.error || `HTTP ${res.status}`);
        return;
      }
      setConfirmed({ token: data.confirmation_token, slot: selectedSlot });
    } catch {
      setSubmitError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      {/* Hero */}
      <section className="border-b border-border bg-secondary/20">
        <div className="container-default py-12">
          <Badge variant="outline" className="mb-4 text-primary border-primary/30">
            Schedule a call
          </Badge>
          <h1 className="font-serif text-3xl sm:text-4xl font-bold mb-3">
            30-Minute Consulting Scoping Call
          </h1>
          <p className="text-muted-foreground text-base max-w-2xl leading-relaxed">
            No cost, no obligation. We confirm whether the engagement is the
            right fit, identify the scope, and give you a clear price before
            any paper changes hands. If we are not the right team for your
            work, we will tell you who is.
          </p>
        </div>
      </section>

      {/* Body */}
      <section className="section-padding">
        <div className="container-default max-w-5xl">
          {confirmed ? (
            <Card>
              <CardContent className="p-8 text-center space-y-4">
                <CheckCircle2 size={48} className="text-primary mx-auto" />
                <h2 className="font-serif text-2xl font-bold">Booking confirmed</h2>
                <p className="text-muted-foreground">
                  Your scoping call is set for <strong>{formatOperatorTime(confirmed.slot.date, confirmed.slot.start_time)}</strong> America/Phoenix.
                </p>
                {bookerTz && (
                  <p className="text-sm text-muted-foreground">
                    In your local tz: {formatBookerLocalTime(confirmed.slot.date, confirmed.slot.start_time, "America/Phoenix")}
                  </p>
                )}
                <p className="text-sm text-muted-foreground">
                  A confirmation email with a calendar invite is on the way.
                  Reply to that email to cancel or reschedule.
                </p>
                <p className="text-xs text-muted-foreground pt-4">
                  Confirmation token: <span className="font-mono">{confirmed.token}</span>
                </p>
              </CardContent>
            </Card>
          ) : loading ? (
            <Card>
              <CardContent className="p-8 text-center">
                <p className="text-muted-foreground">Loading the calendar...</p>
              </CardContent>
            </Card>
          ) : loadError ? (
            <Card>
              <CardContent className="p-8 text-center space-y-3">
                <AlertCircle size={32} className="text-destructive mx-auto" />
                <p className="font-semibold">{loadError}</p>
                <p className="text-sm text-muted-foreground">
                  Please email <a className="text-primary underline" href="mailto:info@veritaslabservices.com">info@veritaslabservices.com</a> and we'll set up the call by hand.
                </p>
              </CardContent>
            </Card>
          ) : availableDates.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center space-y-3">
                <Clock size={32} className="text-muted-foreground mx-auto" />
                <p className="font-semibold">No openings in the next 30 days.</p>
                <p className="text-sm text-muted-foreground">
                  Email <a className="text-primary underline" href="mailto:info@veritaslabservices.com">info@veritaslabservices.com</a> and we will work in a time that fits your survey timeline.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid lg:grid-cols-2 gap-8">
              {/* Calendar column */}
              <div>
                <h2 className="font-serif text-xl font-bold mb-3 flex items-center gap-2">
                  <Calendar size={18} /> Pick a day
                </h2>
                <div className="grid grid-cols-3 gap-2 mb-6">
                  {availableDates.slice(0, 18).map((d) => {
                    const day = new Date(d + "T12:00:00Z");
                    const label = day.toLocaleDateString("en-US", {
                      weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
                    });
                    const isSel = d === selectedDate;
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => { setSelectedDate(d); setSelectedSlot(null); }}
                        className={
                          "p-3 rounded-lg border text-left text-sm transition-colors " +
                          (isSel
                            ? "border-primary bg-primary/10 text-primary font-semibold"
                            : "border-border hover:bg-secondary/40")
                        }
                        data-testid={`date-${d}`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                {selectedDate && (
                  <div>
                    <h2 className="font-serif text-xl font-bold mb-3 flex items-center gap-2">
                      <Clock size={18} /> Pick a time
                    </h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {slotsForSelected.map((s) => {
                        const isSel = selectedSlot && selectedSlot.date === s.date && selectedSlot.start_time === s.start_time;
                        const [h, m] = s.start_time.split(":").map((x) => parseInt(x, 10));
                        const ampm = h >= 12 ? "PM" : "AM";
                        const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
                        return (
                          <button
                            key={s.start_time}
                            type="button"
                            onClick={() => setSelectedSlot(s)}
                            className={
                              "p-3 rounded-lg border text-center text-sm transition-colors " +
                              (isSel
                                ? "border-primary bg-primary/10 text-primary font-semibold"
                                : "border-border hover:bg-secondary/40")
                            }
                            data-testid={`slot-${s.start_time}`}
                          >
                            {h12}:{m < 10 ? "0" + m : m} {ampm}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1">
                      <MapPin size={12} /> All times shown in America/Phoenix. Your local time appears below once you pick a slot.
                    </p>
                  </div>
                )}
              </div>

              {/* Form column */}
              <div>
                {selectedSlot ? (
                  <Card>
                    <CardContent className="p-6 space-y-4">
                      <div className="border-b pb-3 mb-2">
                        <div className="text-sm text-muted-foreground">Selected slot</div>
                        <div className="font-semibold">{formatOperatorTime(selectedSlot.date, selectedSlot.start_time)} America/Phoenix</div>
                        {bookerTz && (
                          <div className="text-xs text-muted-foreground mt-1">
                            Your local: {formatBookerLocalTime(selectedSlot.date, selectedSlot.start_time, "America/Phoenix")}
                          </div>
                        )}
                      </div>
                      <form onSubmit={submitBooking} className="space-y-3">
                        {/* honeypot */}
                        <input
                          type="text"
                          name="website"
                          tabIndex={-1}
                          autoComplete="off"
                          value={form.website}
                          onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
                          style={{ position: "absolute", left: "-10000px", opacity: 0, height: 0 }}
                          aria-hidden="true"
                        />
                        <div>
                          <Label htmlFor="bn">Your name *</Label>
                          <Input id="bn" required value={form.booker_name} onChange={(e) => setForm((f) => ({ ...f, booker_name: e.target.value }))} />
                        </div>
                        <div className="grid sm:grid-cols-2 gap-3">
                          <div>
                            <Label htmlFor="be">Work email *</Label>
                            <Input id="be" type="email" required value={form.booker_email} onChange={(e) => setForm((f) => ({ ...f, booker_email: e.target.value }))} />
                          </div>
                          <div>
                            <Label htmlFor="bp">Phone</Label>
                            <Input id="bp" type="tel" value={form.booker_phone} onChange={(e) => setForm((f) => ({ ...f, booker_phone: e.target.value }))} />
                          </div>
                        </div>
                        <div className="grid sm:grid-cols-2 gap-3">
                          <div>
                            <Label htmlFor="ln">Lab or facility name</Label>
                            <Input id="ln" value={form.lab_name} onChange={(e) => setForm((f) => ({ ...f, lab_name: e.target.value }))} />
                          </div>
                          <div>
                            <Label htmlFor="ro">Your role</Label>
                            <Input id="ro" placeholder="e.g. Lab Manager, VP Lab Services" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} />
                          </div>
                        </div>
                        <div>
                          <Label htmlFor="tp">Engagement topic</Label>
                          <Input id="tp" placeholder="e.g. Mock TJC survey, productivity analysis, director coverage" value={form.topic} onChange={(e) => setForm((f) => ({ ...f, topic: e.target.value }))} />
                        </div>
                        <div>
                          <Label htmlFor="ms">Anything else?</Label>
                          <Textarea id="ms" rows={3} placeholder="Survey date if applicable, current pain points, anything that helps scope the call." value={form.message} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))} />
                        </div>
                        {submitError && (
                          <div className="text-sm text-destructive flex items-center gap-2"><AlertCircle size={14} /> {submitError}</div>
                        )}
                        <Button type="submit" disabled={submitting} className="w-full bg-primary hover:bg-primary/90 text-primary-foreground">
                          {submitting ? "Booking..." : "Confirm booking"}
                        </Button>
                        <p className="text-xs text-muted-foreground">
                          By booking you agree to be contacted at the email and phone provided about the scoping call only.
                        </p>
                      </form>
                    </CardContent>
                  </Card>
                ) : (
                  <Card>
                    <CardContent className="p-8 text-center text-muted-foreground text-sm">
                      Pick a day and a time on the left to continue.
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
