// The website's contact form (BUG-185, 2026-11-24). POST /api/contact stored the message in contact_messages and told nobody,
// while the page said "Message sent! We'll respond promptly". The route now stores it and then emails info@ through here, as
// the live demo form already did; both forms write contact_messages, so a message survives an email outage.

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const oneLine = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
const LOOKS_LIKE_EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const DEMO_PREFIX = "Live demo request (from /demo)";

export async function emailContactMessage(msg: { name: string; email: string; message: string }): Promise<void> {
  if (!process.env.RESEND_API_KEY) { console.warn("[contact] RESEND_API_KEY not set; email skipped"); return; }
  const name = oneLine(msg.name).slice(0, 80), email = oneLine(msg.email).toLowerCase();
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "VeritaAssure® <info@veritaslabservices.com>",
        to: "info@veritaslabservices.com",
        // A reply-to that isn't an address makes Resend refuse the whole email, so it is left out then.
        ...(LOOKS_LIKE_EMAIL.test(email) ? { reply_to: email } : {}),
        subject: `Contact form: ${name || "no name"}`,
        html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px"><h2 style="color:#01696F">Contact form message</h2>`
          + `<p><strong>${esc(name)}</strong><br>${esc(email)}</p><p style="white-space:pre-wrap">${esc(msg.message)}</p>`
          + `<p style="color:#888;font-size:12px;margin-top:24px">Sent from the contact form on /contact.</p></div>`,
      }),
    });
    if (!r.ok) console.error("[contact] email not sent: HTTP", r.status);
  } catch (err: any) {
    console.error("[contact] email failed:", err?.message);
  }
}

export function listContactMessages(sqlite: any, countsOnly: boolean) {
  const rows = sqlite.prepare("SELECT id, name, email, message, created_at FROM contact_messages ORDER BY id DESC").all() as any[];
  const kind = (r: any) => (String(r.message).startsWith(DEMO_PREFIX) ? "demo" : "contact");
  const contact = rows.filter((r) => kind(r) === "contact");
  const counts = { total: rows.length, contact: contact.length, demo: rows.length - contact.length, oldestContact: contact.at(-1)?.created_at ?? null, newestContact: contact[0]?.created_at ?? null };
  return countsOnly ? { counts } : { counts, messages: rows.map((r) => ({ id: r.id, kind: kind(r), created_at: r.created_at, name: r.name, email: r.email, message: r.message })) };
}
