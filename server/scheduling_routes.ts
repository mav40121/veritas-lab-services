// server/scheduling_routes.ts
//
// Routes for the consulting scoping-call booking flow (Phase 1).
//
// Public:
//   GET  /api/scheduling/event-types/:slug
//   GET  /api/scheduling/availability?event=scoping-call&from=YYYY-MM-DD&to=YYYY-MM-DD
//   POST /api/scheduling/book
//   GET  /api/scheduling/booking/:token
//   POST /api/scheduling/booking/:token/cancel
//
// Admin (x-admin-secret header):
//   GET    /api/admin/scheduling/rules?event=scoping-call
//   POST   /api/admin/scheduling/rules
//   DELETE /api/admin/scheduling/rules/:id
//   GET    /api/admin/scheduling/blackouts
//   POST   /api/admin/scheduling/blackouts
//   DELETE /api/admin/scheduling/blackouts/:id
//   GET    /api/admin/scheduling/bookings
//
// All times stored in operator tz (America/Phoenix). The booker's tz is
// captured per booking for the confirmation email.

import type { Express } from "express";
import { db } from "./db";
import {
  computeAvailability,
  makeConfirmationToken,
  buildBookingIcs,
  OPERATOR_TZ,
  type AvailabilityRule,
  type Blackout,
  type Booking,
} from "./scheduling";

const sqlite = (db as any).$client;

function operatorNow(): { date: string; minute: number } {
  // Operator "now" in OPERATOR_TZ, DST-aware. Eastern observes DST, so a fixed
  // offset would be wrong for half the year; Intl resolves the correct offset.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: OPERATOR_TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "00";
  let hh = parseInt(get("hour"), 10);
  if (hh === 24) hh = 0; // some ICU builds emit 24 at midnight
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minute: hh * 60 + parseInt(get("minute"), 10),
  };
}

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + "T00:00:00Z"));
}

function isValidTime(s: string): boolean {
  return /^\d{2}:\d{2}$/.test(s);
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

const BOOKING_RATE_PER_IP_PER_HOUR = 5;

function rateLimitOk(ip: string): boolean {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const row = sqlite.prepare(
    "SELECT COUNT(*) AS c FROM schedule_bookings WHERE ip_address = ? AND created_at > ?"
  ).get(ip, cutoff) as { c: number };
  return row.c < BOOKING_RATE_PER_IP_PER_HOUR;
}

export function registerSchedulingRoutes(app: Express) {
  const ADMIN_SECRET = process.env.ADMIN_SECRET || "";

  function requireAdmin(req: any, res: any): boolean {
    const secret = (req.headers["x-admin-secret"] || req.query.secret) as
      | string
      | undefined;
    if (!ADMIN_SECRET || secret !== ADMIN_SECRET) {
      res.status(403).json({ error: "Forbidden" });
      return false;
    }
    return true;
  }

  // ── public ──────────────────────────────────────────────────────────

  app.get("/api/scheduling/event-types/:slug", (req, res) => {
    const slug = String(req.params.slug || "").trim();
    const row = sqlite.prepare(
      "SELECT id, slug, title, duration_minutes, description, active FROM schedule_event_types WHERE slug = ? AND active = 1"
    ).get(slug) as any;
    if (!row) return res.status(404).json({ error: "Event type not found" });
    res.json({ ...row, operator_tz: OPERATOR_TZ });
  });

  app.get("/api/scheduling/availability", (req, res) => {
    const slug = String(req.query.event || "").trim();
    const from = String(req.query.from || "").trim();
    const to = String(req.query.to || "").trim();
    if (!slug) return res.status(400).json({ error: "event is required" });
    if (!isValidDate(from) || !isValidDate(to)) {
      return res.status(400).json({ error: "from and to must be YYYY-MM-DD" });
    }
    const evt = sqlite.prepare(
      "SELECT id, duration_minutes, slot_interval_minutes, synthetic_holds_per_day FROM schedule_event_types WHERE slug = ? AND active = 1"
    ).get(slug) as any;
    if (!evt) return res.status(404).json({ error: "Event type not found" });

    // Cap the window to 60 days
    const fromMs = Date.parse(from + "T00:00:00Z");
    const toMs = Date.parse(to + "T00:00:00Z");
    if (toMs < fromMs) return res.status(400).json({ error: "to must be >= from" });
    const cappedToMs = Math.min(toMs, fromMs + 60 * 86400 * 1000);
    const cappedTo = new Date(cappedToMs).toISOString().slice(0, 10);

    const rules = sqlite.prepare(
      "SELECT id, event_type_id, day_of_week, start_time, end_time, active FROM schedule_availability_rules WHERE event_type_id = ? AND active = 1"
    ).all(evt.id) as AvailabilityRule[];

    const blackouts = sqlite.prepare(
      "SELECT id, blackout_date, start_time, end_time, reason FROM schedule_blackouts WHERE blackout_date BETWEEN ? AND ?"
    ).all(from, cappedTo) as Blackout[];

    const bookings = sqlite.prepare(
      "SELECT slot_date, slot_start, slot_end, status FROM schedule_bookings WHERE event_type_id = ? AND slot_date BETWEEN ? AND ? AND status = 'confirmed'"
    ).all(evt.id, from, cappedTo) as Booking[];

    const slots = computeAvailability({
      fromDate: from,
      toDate: cappedTo,
      durationMinutes: evt.duration_minutes,
      intervalMinutes: evt.slot_interval_minutes ?? undefined,
      syntheticHoldsPerDay: evt.synthetic_holds_per_day ?? 0,
      rules,
      blackouts,
      bookings,
      minLeadHours: 24,
      nowOperator: operatorNow(),
    });

    res.json({
      event_slug: slug,
      duration_minutes: evt.duration_minutes,
      operator_tz: OPERATOR_TZ,
      from,
      to: cappedTo,
      slots,
    });
  });

  app.post("/api/scheduling/book", async (req: any, res) => {
    const ip = (req.ip || req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim() || "unknown";
    if (!rateLimitOk(ip)) {
      return res.status(429).json({ error: "Too many booking attempts. Try again in an hour." });
    }
    const body = req.body || {};
    const slug = String(body.event_slug || "").trim();
    const slotDate = String(body.slot_date || "").trim();
    const slotStart = String(body.slot_start || "").trim();
    const bookerName = String(body.booker_name || "").trim();
    const bookerEmail = String(body.booker_email || "").trim().toLowerCase();
    const bookerPhone = String(body.booker_phone || "").trim();
    const labName = String(body.lab_name || "").trim();
    const role = String(body.role || "").trim();
    const topic = String(body.topic || "").trim();
    const message = String(body.message || "").trim();
    const bookerTz = String(body.booker_tz || "").trim();
    const honeypot = String(body.website || "").trim(); // hidden field

    if (honeypot) return res.status(200).json({ ok: true }); // silent drop bots
    if (!slug || !isValidDate(slotDate) || !isValidTime(slotStart)) {
      return res.status(400).json({ error: "Invalid slot or event." });
    }
    if (!bookerName || bookerName.length > 200) {
      return res.status(400).json({ error: "Name is required." });
    }
    if (!bookerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bookerEmail) || bookerEmail.length > 200) {
      return res.status(400).json({ error: "Valid email is required." });
    }
    if (bookerEmail === "info@veritaslabservices.com") {
      return res.status(400).json({ error: "Please use your own email address." });
    }
    if (message.length > 2000) {
      return res.status(400).json({ error: "Message is too long." });
    }

    const evt = sqlite.prepare(
      "SELECT id, duration_minutes, title, slot_interval_minutes, synthetic_holds_per_day FROM schedule_event_types WHERE slug = ? AND active = 1"
    ).get(slug) as any;
    if (!evt) return res.status(404).json({ error: "Event type not found." });

    // Compute slot end and check availability inside a transaction
    const [sh, sm] = slotStart.split(":").map((s) => parseInt(s, 10));
    const startMinutes = sh * 60 + sm;
    const endMinutes = startMinutes + evt.duration_minutes;
    const eh = Math.floor(endMinutes / 60);
    const em = endMinutes % 60;
    const slotEnd = `${eh < 10 ? "0" + eh : eh}:${em < 10 ? "0" + em : em}`;

    const token = makeConfirmationToken();

    try {
      const txn = sqlite.transaction(() => {
        // Re-validate the slot against current state
        const rules = sqlite.prepare(
          "SELECT id, event_type_id, day_of_week, start_time, end_time, active FROM schedule_availability_rules WHERE event_type_id = ? AND active = 1"
        ).all(evt.id) as AvailabilityRule[];
        const blackouts = sqlite.prepare(
          "SELECT id, blackout_date, start_time, end_time, reason FROM schedule_blackouts WHERE blackout_date = ?"
        ).all(slotDate) as Blackout[];
        const bookings = sqlite.prepare(
          "SELECT slot_date, slot_start, slot_end, status FROM schedule_bookings WHERE event_type_id = ? AND slot_date = ? AND status = 'confirmed'"
        ).all(evt.id, slotDate) as Booking[];
        const available = computeAvailability({
          fromDate: slotDate,
          toDate: slotDate,
          durationMinutes: evt.duration_minutes,
          intervalMinutes: evt.slot_interval_minutes ?? undefined,
          syntheticHoldsPerDay: evt.synthetic_holds_per_day ?? 0,
          rules,
          blackouts,
          bookings,
          minLeadHours: 24,
          nowOperator: operatorNow(),
        });
        const stillOpen = available.some((s) => s.start_time === slotStart);
        if (!stillOpen) {
          throw new Error("SLOT_TAKEN");
        }
        sqlite.prepare(`
          INSERT INTO schedule_bookings
            (event_type_id, slot_date, slot_start, slot_end, booker_tz, booker_name, booker_email, booker_phone, lab_name, role, topic, message, status, confirmation_token, ip_address, user_agent)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?)
        `).run(
          evt.id, slotDate, slotStart, slotEnd, bookerTz || null,
          bookerName, bookerEmail, bookerPhone || null, labName || null, role || null,
          topic || null, message || null, token, ip, (req.headers["user-agent"] || "").toString().slice(0, 500)
        );
      });
      txn();
    } catch (err: any) {
      if (err.message === "SLOT_TAKEN") {
        return res.status(409).json({ error: "That slot was just taken. Please pick another." });
      }
      return res.status(500).json({ error: "Could not save the booking. Please try again." });
    }

    // Fire confirmation + operator-notification emails (best-effort; do
    // not fail the booking if email is unavailable)
    const ics = buildBookingIcs({
      uid: `${token}@veritaslabservices.com`,
      summary: evt.title,
      description: `${evt.title}\n\nBooked via veritaslabservices.com\nConfirmation token: ${token}\n\nLab: ${labName || "(not provided)"}\nRole: ${role || "(not provided)"}\nTopic: ${topic || "(not provided)"}\n\nNotes from booker:\n${message || "(none)"}`,
      location: "Phone or video, to be confirmed",
      bookerEmail,
      bookerName,
      organizerEmail: "info@veritaslabservices.com",
      organizerName: "Michael Veri, Veritas Lab Services",
      slotDate,
      slotStart,
      slotEnd,
    });

    void (async () => {
      try {
        const { Resend } = await import("resend").catch(() => ({ Resend: null as any }));
        if (!Resend || !process.env.RESEND_API_KEY) return;
        const resend = new Resend(process.env.RESEND_API_KEY);
        const subject = `Confirmed: ${evt.title} on ${slotDate} at ${slotStart} ${OPERATOR_TZ}`;
        const bookerHtml = `
          <p>Hi ${bookerName.split(" ")[0]},</p>
          <p>Your ${evt.title} is confirmed:</p>
          <ul>
            <li><strong>Date:</strong> ${slotDate}</li>
            <li><strong>Time:</strong> ${slotStart} ${OPERATOR_TZ} (${bookerTz ? "your local equivalent shown in the calendar invite" : "please verify your local time"})</li>
            <li><strong>Duration:</strong> ${evt.duration_minutes} minutes</li>
          </ul>
          <p>I will reach out shortly to confirm whether the call runs by phone or video.</p>
          <p>To cancel or reschedule, reply to this email.</p>
          <p>Best,<br/>Michael Veri<br/>Veritas Lab Services</p>
        `;
        await resend.emails.send({
          from: "Veritas Lab Services <info@veritaslabservices.com>",
          to: bookerEmail,
          replyTo: "info@veritaslabservices.com",
          subject,
          html: bookerHtml,
          attachments: [{ filename: "scoping-call.ics", content: Buffer.from(ics).toString("base64") }],
        });
        // Operator notification
        const opHtml = `
          <p>New booking on the scoping call calendar.</p>
          <ul>
            <li><strong>When:</strong> ${slotDate} ${slotStart} ${OPERATOR_TZ}</li>
            <li><strong>Name:</strong> ${bookerName}</li>
            <li><strong>Email:</strong> ${bookerEmail}</li>
            <li><strong>Phone:</strong> ${bookerPhone || "(not provided)"}</li>
            <li><strong>Lab:</strong> ${labName || "(not provided)"}</li>
            <li><strong>Role:</strong> ${role || "(not provided)"}</li>
            <li><strong>Topic:</strong> ${topic || "(not provided)"}</li>
          </ul>
          <p>${message ? "Notes from booker:<br/>" + message.replace(/\n/g, "<br/>") : "(no message)"}</p>
        `;
        await resend.emails.send({
          from: "Veritas Lab Services <info@veritaslabservices.com>",
          to: "info@veritaslabservices.com",
          subject: `New scoping call: ${bookerName} - ${slotDate} ${slotStart}`,
          html: opHtml,
        });
      } catch (e) {
        console.error("[scheduling] email send failed:", (e as any)?.message || e);
      }
    })();

    res.json({ ok: true, confirmation_token: token, slot_date: slotDate, slot_start: slotStart, slot_end: slotEnd });
  });

  app.get("/api/scheduling/booking/:token", (req, res) => {
    const token = String(req.params.token || "").trim();
    if (!token) return res.status(400).json({ error: "Token is required." });
    const row = sqlite.prepare(`
      SELECT b.slot_date, b.slot_start, b.slot_end, b.booker_name, b.lab_name,
             b.status, b.created_at, b.cancelled_at, e.title, e.duration_minutes
      FROM schedule_bookings b
      JOIN schedule_event_types e ON e.id = b.event_type_id
      WHERE b.confirmation_token = ?
    `).get(token) as any;
    if (!row) return res.status(404).json({ error: "Booking not found." });
    res.json({ ...row, operator_tz: OPERATOR_TZ });
  });

  app.post("/api/scheduling/booking/:token/cancel", (req, res) => {
    const token = String(req.params.token || "").trim();
    if (!token) return res.status(400).json({ error: "Token is required." });
    const row = sqlite.prepare("SELECT id, status FROM schedule_bookings WHERE confirmation_token = ?").get(token) as any;
    if (!row) return res.status(404).json({ error: "Booking not found." });
    if (row.status !== "confirmed") return res.status(400).json({ error: "Booking is not active." });
    sqlite.prepare("UPDATE schedule_bookings SET status = 'cancelled', cancelled_at = datetime('now') WHERE id = ?").run(row.id);
    res.json({ ok: true });
  });

  // ── admin ───────────────────────────────────────────────────────────

  app.get("/api/admin/scheduling/rules", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const slug = String(req.query.event || "scoping-call").trim();
    const evt = sqlite.prepare("SELECT id FROM schedule_event_types WHERE slug = ?").get(slug) as any;
    if (!evt) return res.status(404).json({ error: "Event type not found." });
    const rows = sqlite.prepare(
      "SELECT id, event_type_id, day_of_week, start_time, end_time, active, created_at FROM schedule_availability_rules WHERE event_type_id = ? ORDER BY day_of_week, start_time"
    ).all(evt.id);
    res.json({ rules: rows });
  });

  app.post("/api/admin/scheduling/rules", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = req.body || {};
    const slug = String(body.event_slug || "scoping-call").trim();
    const evt = sqlite.prepare("SELECT id FROM schedule_event_types WHERE slug = ?").get(slug) as any;
    if (!evt) return res.status(404).json({ error: "Event type not found." });
    const dow = clamp(Number(body.day_of_week), 0, 6);
    const startTime = String(body.start_time || "").trim();
    const endTime = String(body.end_time || "").trim();
    if (!isValidTime(startTime) || !isValidTime(endTime)) {
      return res.status(400).json({ error: "start_time and end_time must be HH:MM." });
    }
    sqlite.prepare(`
      INSERT INTO schedule_availability_rules (event_type_id, day_of_week, start_time, end_time, active)
      VALUES (?, ?, ?, ?, 1)
    `).run(evt.id, dow, startTime, endTime);
    res.json({ ok: true });
  });

  app.delete("/api/admin/scheduling/rules/:id", (req, res) => {
    if (!requireAdmin(req, res)) return;
    sqlite.prepare("DELETE FROM schedule_availability_rules WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  });

  app.get("/api/admin/scheduling/blackouts", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const rows = sqlite.prepare(
      "SELECT id, blackout_date, start_time, end_time, reason, created_at FROM schedule_blackouts ORDER BY blackout_date DESC LIMIT 200"
    ).all();
    res.json({ blackouts: rows });
  });

  app.post("/api/admin/scheduling/blackouts", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = req.body || {};
    const date = String(body.blackout_date || "").trim();
    if (!isValidDate(date)) return res.status(400).json({ error: "blackout_date must be YYYY-MM-DD." });
    const startTime = body.start_time ? String(body.start_time).trim() : null;
    const endTime = body.end_time ? String(body.end_time).trim() : null;
    if (startTime && !isValidTime(startTime)) return res.status(400).json({ error: "start_time invalid." });
    if (endTime && !isValidTime(endTime)) return res.status(400).json({ error: "end_time invalid." });
    if ((startTime && !endTime) || (!startTime && endTime)) {
      return res.status(400).json({ error: "Provide both start_time and end_time, or neither." });
    }
    sqlite.prepare(
      "INSERT INTO schedule_blackouts (blackout_date, start_time, end_time, reason) VALUES (?, ?, ?, ?)"
    ).run(date, startTime, endTime, body.reason || null);
    res.json({ ok: true });
  });

  app.delete("/api/admin/scheduling/blackouts/:id", (req, res) => {
    if (!requireAdmin(req, res)) return;
    sqlite.prepare("DELETE FROM schedule_blackouts WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  });

  app.get("/api/admin/scheduling/bookings", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const rows = sqlite.prepare(`
      SELECT b.id, b.slot_date, b.slot_start, b.slot_end, b.booker_tz, b.booker_name, b.booker_email,
             b.booker_phone, b.lab_name, b.role, b.topic, b.message, b.status,
             b.confirmation_token, b.created_at, b.cancelled_at, e.title
      FROM schedule_bookings b
      JOIN schedule_event_types e ON e.id = b.event_type_id
      ORDER BY b.slot_date DESC, b.slot_start DESC
      LIMIT 200
    `).all();
    res.json({ bookings: rows });
  });

  // Admin backfill: log a past or off-platform meeting onto the bookings
  // tracker. Unlike the public /book flow this does NOT validate against
  // availability, so it accepts past dates and any time; it just records a
  // meeting that already happened. Used to seed the tracker with demos and
  // calls already run. Future availability is unaffected (computeAvailability
  // only subtracts bookings on today-or-later dates).
  app.post("/api/admin/scheduling/bookings", (req: any, res) => {
    if (!requireAdmin(req, res)) return;
    const b = req.body || {};
    const slug = String(b.event_slug || "scoping-call").trim();
    const slotDate = String(b.slot_date || "").trim();
    const slotStart = String(b.slot_start || "12:00").trim();
    const bookerName = String(b.booker_name || "").trim();
    if (!isValidDate(slotDate)) return res.status(400).json({ error: "slot_date must be YYYY-MM-DD" });
    if (!isValidTime(slotStart)) return res.status(400).json({ error: "slot_start must be HH:MM" });
    if (!bookerName) return res.status(400).json({ error: "booker_name required" });
    const evt = sqlite.prepare(
      "SELECT id, duration_minutes FROM schedule_event_types WHERE slug = ?"
    ).get(slug) as any;
    if (!evt) return res.status(404).json({ error: `Unknown event type: ${slug}` });
    let slotEnd = String(b.slot_end || "").trim();
    if (!isValidTime(slotEnd)) {
      const [sh, sm] = slotStart.split(":").map((s: string) => parseInt(s, 10));
      const total = sh * 60 + sm + (evt.duration_minutes || 50);
      const eh = Math.floor(total / 60) % 24;
      const em = total % 60;
      slotEnd = `${eh < 10 ? "0" + eh : eh}:${em < 10 ? "0" + em : em}`;
    }
    const token = makeConfirmationToken();
    sqlite.prepare(`
      INSERT INTO schedule_bookings
        (event_type_id, slot_date, slot_start, slot_end, booker_tz, booker_name, booker_email, booker_phone, lab_name, role, topic, message, status, confirmation_token, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      evt.id, slotDate, slotStart, slotEnd,
      b.booker_tz || null, bookerName, b.booker_email || null, b.booker_phone || null,
      b.lab_name || null, b.role || null, b.topic || null, b.message || null,
      String(b.status || "confirmed"), token, "(backfill)", "admin-backfill",
    );
    const row = sqlite.prepare(
      "SELECT id, slot_date, slot_start, slot_end, booker_name, lab_name, topic, status FROM schedule_bookings WHERE confirmation_token = ?"
    ).get(token);
    res.json({ ok: true, booking: row });
  });
}
