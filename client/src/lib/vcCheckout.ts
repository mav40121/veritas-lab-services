// client/src/lib/vcCheckout.ts
//
// BUG-173 (2026-11-17, design approved by Michael "1"): VeritaCheck® Unlimited checkout from the VeritaCheck page and
// Account Settings, for a lab's owner (or someone with no lab). A discount code applied on the VeritaCheck page is kept
// for this browser tab (parking lot #89: it used to be lost on the way to checkout), so the sign-in page, Account
// Settings and the next visit to VeritaCheck can carry it. Storage can throw (private windows, blocked site data), so
// every access is wrapped and a failure only means the code isn't remembered.
import { authHeaders } from "@/lib/auth";
import { API_BASE } from "@/lib/queryClient";

const PENDING_CODE_KEY = "veritas_pending_discount_code";

export const VC_SUBSCRIBE_LABEL = "Subscribe to VeritaCheck® Unlimited";
export const VC_PRICE_LINE = "$299 the first year, $499 a year after.";

// What POST /api/discount/validate adds for VeritaCheck Unlimited (server/vcCheckout.ts vcFirstYearFields): the first year
// the buyer will really pay, and whether the code or the $200 first-year discount gives it.
export interface VcFirstYear { appliedAs?: "code" | "first_year"; firstYearCents?: number }

export function formatUsdCents(cents: number): string {
  const d = cents / 100;
  return Number.isInteger(d) ? `$${d}` : `$${d.toFixed(2)}`;
}

// The banner's first-year sentence, or null when the answer carried none (any plan but Unlimited).
export function vcFirstYearLine(d: VcFirstYear | null | undefined): string | null {
  if (!d || typeof d.firstYearCents !== "number" || (d.appliedAs !== "code" && d.appliedAs !== "first_year")) return null;
  return d.appliedAs === "code"
    ? `First year with this code: ${formatUsdCents(d.firstYearCents)}, then $499 a year.`
    : `This code is smaller than the $200 first-year discount, so your first year stays ${formatUsdCents(d.firstYearCents)}, then $499 a year.`;
}

// The line under the Subscribe button: the code's first year when the code is what applies, else the list line.
export function vcPriceLine(d: VcFirstYear | null | undefined): string {
  return d?.appliedAs === "code" && typeof d.firstYearCents === "number"
    ? `${formatUsdCents(d.firstYearCents)} the first year with your code, $499 a year after.`
    : VC_PRICE_LINE;
}

// The code's own terms as the banner names them (": 10% off"). On VeritaCheck Unlimited (appliedAs set) there is never a
// trial, so a code's trial isn't named there.
export function codeTermsText(d: { pct?: number; trialDays?: number } & VcFirstYear): string {
  const parts = [!d.appliedAs && d.trialDays ? `${d.trialDays}-day free trial` : "", d.pct ? `${d.pct}% off` : ""].filter(Boolean);
  return parts.length ? `: ${parts.join(" + ")}` : "";
}

export function savePendingDiscountCode(code: string): void {
  try {
    const c = (code || "").trim();
    if (c) sessionStorage.setItem(PENDING_CODE_KEY, c);
  } catch { /* storage unavailable: the code just isn't remembered */ }
}

export function readPendingDiscountCode(): string | null {
  try {
    const v = sessionStorage.getItem(PENDING_CODE_KEY);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

export function clearPendingDiscountCode(): void {
  try { sessionStorage.removeItem(PENDING_CODE_KEY); } catch { /* storage unavailable */ }
}

// Starts Stripe Checkout for VeritaCheck Unlimited on the given lab. Returns null once the browser is on its way to
// checkout; otherwise the message to show (a 409 ALREADY_SUBSCRIBED or 403 NOT_LAB_OWNER comes back here, and nothing
// redirects).
export async function startVcUnlimitedCheckout({ labId, discountCode }: { labId?: number | null; discountCode?: string | null }): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/api/stripe/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        priceType: "veritacheck_only",
        ...(labId ? { labId } : {}),
        ...(discountCode ? { discountCode } : {}),
      }),
    });
    let data: any = {};
    try { data = await res.json(); } catch { /* not JSON */ }
    if (res.ok && data?.url) {
      clearPendingDiscountCode();
      window.location.href = data.url;
      return null;
    }
    return data?.error || "Could not start checkout.";
  } catch {
    return "Could not start checkout.";
  }
}
