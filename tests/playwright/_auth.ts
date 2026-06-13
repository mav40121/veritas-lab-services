import { Page } from "@playwright/test";

// Browser QA (2026-06-13) found that injecting only `veritas_token` is not
// enough to exercise authenticated UI: the client's AuthContext reads the
// logged-in user (and its .plan) ONLY from localStorage `veritas_user`, and
// never re-fetches it. With the token but no user, every plan-gated page
// renders its "upgrade / requires a subscription" wall, so specs fail or skip.
// Real login stores BOTH keys; this helper does the same by fetching
// /api/auth/me with the token and seeding token + user before the app loads.
export async function injectAuth(page: Page, base: string, token: string): Promise<void> {
  await page.goto(`${base}/`);
  const me = await page.evaluate(async ([b, t]) => {
    try {
      const r = await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } });
      return r.ok ? await r.json() : null;
    } catch { return null; }
  }, [base, token] as const);
  const user = me && (me.user || me);
  await page.evaluate(([t, u]) => {
    localStorage.setItem("veritas_token", t);
    if (u) localStorage.setItem("veritas_user", JSON.stringify(u));
  }, [token, user] as const);
}
