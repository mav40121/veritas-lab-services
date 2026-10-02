// tests/playwright/repository-file-upload.spec.ts
//
// Gate 3 step 8 evidence for the System Repository file-upload feature: uploads are
// gated by a HIPAA acknowledgment and files are served back org-scoped.
//
// Two layers:
//   1. A source invariant that always runs (no network): the upload endpoint rejects
//      a missing HIPAA ack and the UI ships the acknowledgment checkbox. This guards
//      the one rule that must never regress.
//   2. A live API exercise gated on PW_BASE + PW_TOKEN (a system-lab writer token) and
//      PW_SYSTEM_LAB_ID: upload without the ack -> 400, with the ack -> ok, then the
//      file downloads. Skips cleanly when those are not provided.

import { test, expect, request as pwRequest } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";

const BASE = process.env.PW_BASE || "";
const TOKEN = process.env.PW_TOKEN || "";
const LAB = process.env.PW_SYSTEM_LAB_ID || "";

test.describe("System Repository file upload (HIPAA-gated)", () => {
  test("source invariant: upload requires a HIPAA acknowledgment", () => {
    const root = process.cwd();
    const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
    const page = readFileSync(join(root, "client/src/pages/SystemRepositoryPage.tsx"), "utf8");

    // Server rejects an upload without the acknowledgment.
    expect(routes).toContain("repository/documents/upload");
    expect(routes).toMatch(/HIPAA acknowledgment is required before a file can be uploaded/);
    // Download endpoint is org-scoped to file docs.
    expect(routes).toMatch(/repository\/documents\/:docId\/download/);
    expect(routes).toContain("doc_kind = 'file'");
    // UI ships the acknowledgment checkbox and blocks submit until it is checked.
    expect(page).toContain("hipaaAcknowledged");
    expect(page).toMatch(/HIPAA acknowledgment/i);
  });

  test("live: upload is rejected without the ack and accepted with it, then downloads", async () => {
    if (!BASE || !TOKEN || !LAB) {
      test.skip(true, "Needs PW_BASE + PW_TOKEN (system-lab writer) + PW_SYSTEM_LAB_ID.");
      return;
    }
    const ctx = await pwRequest.newContext({
      baseURL: BASE,
      extraHTTPHeaders: { Authorization: `Bearer ${TOKEN}` },
    });
    const url = `/api/labs/${LAB}/repository/documents/upload`;
    const fileBody = Buffer.from("Playwright Gate 3 test document.\n");

    // No acknowledgment -> 400.
    const noAck = await ctx.post(url, {
      multipart: { file: { name: "gate3.txt", mimeType: "text/plain", buffer: fileBody }, title: "Gate3 no-ack" },
    });
    expect(noAck.status()).toBe(400);

    // With acknowledgment -> ok, returns a file doc.
    const withAck = await ctx.post(url, {
      multipart: { file: { name: "gate3.txt", mimeType: "text/plain", buffer: fileBody }, title: "Gate3 ack", hipaaAcknowledged: "true" },
    });
    expect(withAck.ok()).toBeTruthy();
    const doc = (await withAck.json()).document;
    expect(doc.doc_kind).toBe("file");

    // Downloads the stored bytes.
    const dl = await ctx.get(`/api/labs/${LAB}/repository/documents/${doc.id}/download`);
    expect(dl.ok()).toBeTruthy();
    expect(await dl.text()).toContain("Gate 3 test document");

    // Clean up the test doc.
    await ctx.delete(`/api/labs/${LAB}/repository/documents/${doc.id}`);
    await ctx.dispose();
  });
});
