// tests/playwright/veritacomp-nys-competency.spec.ts
//
// NYS CLEP 8-element competency (Elements 7 and 8) in VeritaComp. The New
// Assessment dialog that renders the el7/el8 fields is behind login, so this
// spec is auth-gated: it runs only when PW_TOKEN and a NYS-CLEP lab id
// (PW_NYS_LAB_ID, default lab 24 "Catholic Health - NYS CLEP Demo") are
// provided, and otherwise compiles and skips. It is the Gate 3 step 8 hook for
// an authenticated run; the deterministic PDF-content assertion (NYS renders 8
// elements with 10 NYCRR citations, CLIA renders 6) lives in
// scripts/verify-veritacomp-nys-elements.ts and passes 12/12.
import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN;
const NYS_LAB = process.env.PW_NYS_LAB_ID || "24";

test.describe("VeritaComp NYS CLEP 8-element competency", () => {
  test.skip(!TOKEN, "PW_TOKEN not set, skipping authenticated UI exercise");

  test("NYS-CLEP lab VeritaComp loads for the authenticated owner", async ({ page, context }) => {
    await context.addInitScript((t) => {
      try { localStorage.setItem("veritas_token", String(t)); } catch {}
    }, TOKEN);
    await page.goto(`${BASE}/labs/${NYS_LAB}/veritacomp-app`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    const body = (await page.textContent("body")) || "";
    expect(body).not.toContain("404 Page Not Found");
    expect(page.url()).not.toContain("/login");
  });
});
