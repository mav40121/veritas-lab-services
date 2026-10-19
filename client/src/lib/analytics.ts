type GA4EventName = 'begin_checkout' | 'select_item' | 'sign_up' | 'purchase' | 'invoice_request_submitted' | 'invoice_request_cta_click' | 'invoice_request_card_link_click' | 'system_quote_request_band_click' | 'lead_capture';

interface GA4EventParams {
  // begin_checkout / purchase / select_item
  currency?: string;
  value?: number;
  transaction_id?: string;
  items?: Array<{
    item_id: string;
    item_name: string;
    price?: number;
    quantity?: number;
  }>;
  // select_item
  item_list_id?: string;
  item_list_name?: string;
  // sign_up
  method?: string;
  // invoice_request_submitted
  tier?: string;
  seats?: number;
  has_promo?: boolean;
  // system_quote_request_band_click
  source?: string;
}

// Google Analytics runs for signed-out visitors on the public site only, never inside the logged-in app
// (2026-10-19, Michael: customer security schedules, e.g. a "no tracking code on our workforce" clause). The
// bootstrap used to sit in index.html and load on every page; it now loads here, and the official per-property
// opt-out flag stops all collection the moment anyone is signed in (a tab that loaded GA before sign-in).
export const GA_MEASUREMENT_ID = 'G-M3TB43ZX4E';

function isSignedIn(): boolean {
  try { return !!localStorage.getItem('veritas_token'); } catch { return false; }
}

// Sign-in, invite, password and app pages are workforce pages even before anyone signs in (Google's automatic
// form events fired on the sign-in form), so GA stays off them too. Marketing and resource pages keep it.
const APP_PATH = /^\/(login|signin|signup|register|join|invite|accept|reset|forgot|sso|two-factor|mfa|labs\/|account|staff|my-signoffs|admin|onboarding)/i;

export function analyticsAllowed(): boolean {
  if (typeof window === 'undefined' || isSignedIn()) return false;
  return !APP_PATH.test(window.location.pathname || '/');
}

// Turn collection off (signed in) or on (signed out) for this tab. Safe to call on every route change.
export function syncAnalyticsOptOut(): void {
  if (typeof window === 'undefined') return;
  (window as any)[`ga-disable-${GA_MEASUREMENT_ID}`] = !analyticsAllowed();
}

// Load gtag.js once, for a signed-out visitor only.
export function ensureAnalyticsLoaded(): void {
  if (!analyticsAllowed() || typeof document === 'undefined') return;
  if (document.getElementById('ga4-gtag')) return;
  const w = window as any;
  w.dataLayer = w.dataLayer || [];
  w.gtag = function gtag() { w.dataLayer.push(arguments); };
  w.gtag('js', new Date());
  w.gtag('config', GA_MEASUREMENT_ID, { send_page_view: false });
  const s = document.createElement('script');
  s.id = 'ga4-gtag';
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  document.head.appendChild(s);
}

export function trackEvent(name: GA4EventName, params: GA4EventParams = {}) {
  if (typeof window === 'undefined') return;
  syncAnalyticsOptOut();
  if (!analyticsAllowed()) return;
  const w = window as any;
  if (typeof w.gtag !== 'function') return;
  try {
    w.gtag('event', name, params);
  } catch (e) {
    // never let analytics break the user flow
    console.warn('GA4 event failed:', e);
  }
}
