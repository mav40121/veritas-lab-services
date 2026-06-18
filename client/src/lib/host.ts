// Shared host detection for the VeritaStock front door.
//
// When the app is served from veritastock.com (or any subdomain of it), it
// presents as a standalone VeritaStock inventory product rather than the
// lab-compliance site: the NavBar swaps its chrome and the root route ("/")
// renders the VeritaStock landing instead of the lab HomePage.
//
// Keep this the single source of truth so the NavBar and the router can never
// disagree about which host is which.
export const isStockHost = (): boolean =>
  typeof window !== "undefined" && /(^|\.)veritastock\.com$/i.test(window.location.hostname);
