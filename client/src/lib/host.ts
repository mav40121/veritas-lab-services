// Shared "this is the VeritaStock product" detection. True in two cases:
//
//  1. The DEDICATED VeritaStock deployment is built with VITE_STOCK_DEPLOYMENT=true.
//     That whole Railway service then IS VeritaStock on every URL it serves,
//     including its raw *.up.railway.app URL — not VeritaAssure-with-a-skin that
//     only flips when the hostname happens to match. This is the real product
//     separation.
//  2. The app is served from veritastock.com (or a subdomain), so the shared
//     deployment still skins correctly if that domain ever points back at it.
//
// Single source of truth so the NavBar, the router, the login page, and the
// route lockdown can never disagree about which deployment is which.
export const isStockHost = (): boolean => {
  // Runtime flag injected by the server (server/static.ts) on the dedicated
  // VeritaStock deployment. The reliable signal: it does not depend on the Vite
  // build baking an env var, and works on the raw *.up.railway.app URL too.
  if (typeof window !== "undefined" && (window as any).__STOCK_DEPLOYMENT__ === true) return true;
  if (import.meta.env.VITE_STOCK_DEPLOYMENT === "true") return true;
  return typeof window !== "undefined" && /(^|\.)veritastock\.com$/i.test(window.location.hostname);
};

// Temporary single-site demo mode, injected by the server (server/static.ts)
// when DEMO_SINGLE_SITE=on on the stock deployment. Purely presentational: the
// location switcher collapses to one site relabeled below, and the
// multi-location nav (All Locations / Enterprise / Incoming / transfers) is
// hidden. No data is changed, so removing the env var fully reverts it.
export const isSingleSiteDemo = (): boolean =>
  typeof window !== "undefined" && (window as any).__DEMO_SINGLE_SITE__ === true;

// Display name for the single site in that mode.
export const SINGLE_SITE_DEMO_NAME = "Pfizer Proposed";
