import { useId } from "react";

// Bot guard for every form that posts to /api/newsletter/subscribe (Michael 2026-11-09, Q247 = 1). A form bot fills
// every input it finds; a person never sees this one. The server (server/newsletterGuards.ts isHoneypotFilled) answers
// a filled one like a real signup and stores and sends nothing. Kept off-screen at zero size rather than display:none,
// because some bots skip display:none fields; tabIndex -1 and aria-hidden keep it away from keyboards and screen readers.
// The field name must match NEWSLETTER_HONEYPOT_FIELD on the server.
export const NEWSLETTER_HONEYPOT_NAME = "website";

const wrapStyle: React.CSSProperties = {
  position: "absolute",
  left: "-10000px",
  top: "auto",
  width: 0,
  height: 0,
  overflow: "hidden",
};

const inputStyle: React.CSSProperties = {
  width: 0,
  height: 0,
  padding: 0,
  border: 0,
  opacity: 0,
};

export function NewsletterHoneypot() {
  const id = useId();
  return (
    <div style={wrapStyle} aria-hidden="true" data-testid="newsletter-honeypot">
      <label htmlFor={id}>Website</label>
      <input
        type="text"
        id={id}
        name={NEWSLETTER_HONEYPOT_NAME}
        tabIndex={-1}
        autoComplete="off"
        defaultValue=""
        style={inputStyle}
      />
    </div>
  );
}

/** The hidden field's value in a submitted form ("" when a person sent it). */
export function honeypotValue(form: HTMLFormElement | null | undefined): string {
  const el = form?.elements.namedItem(NEWSLETTER_HONEYPOT_NAME);
  return el instanceof HTMLInputElement ? el.value : "";
}
