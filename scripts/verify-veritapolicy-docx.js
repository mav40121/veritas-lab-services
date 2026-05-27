/**
 * Verify VeritaPolicy DOCX generation against all 58 policies on the master list.
 *
 * Asserts for each policy_id:
 *  - Template file exists in server/policyTemplates/data/
 *  - DOCX generates without throwing
 *  - Lab name substituted (no literal <<LAB_NAME>> left)
 *  - Lab name + CLIA appear in the document text
 *  - Footer brand string present
 *  - Body has 0 em-dashes (footer brand em-dash is in the footer XML and excluded)
 *
 * Exits non-zero on any failure so this can land in CI.
 *
 * Run:  node scripts/verify-veritapolicy-docx.js
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import yauzl from "yauzl";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

const LAB_NAME = "Riverside Regional Medical Center";
const CLIA = "22D0999999";

async function loadMasterList() {
  const tsPath = path.join(REPO_ROOT, "server", "veritapolicyMasterList.ts");
  const text = fs.readFileSync(tsPath, "utf-8");
  const m = text.match(/export const VERITAPOLICY_MASTER_LIST:[^=]*=\s*(\[[\s\S]*?\]);\s*$/m);
  if (!m) throw new Error("Could not parse master list array");
  return JSON.parse(m[1]);
}

function readDocxXml(filePath, entryName) {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      let found = null;
      zip.on("entry", (entry) => {
        if (entry.fileName === entryName) {
          zip.openReadStream(entry, (e, stream) => {
            if (e) return reject(e);
            const chunks = [];
            stream.on("data", (c) => chunks.push(c));
            stream.on("end", () => { found = Buffer.concat(chunks).toString("utf-8"); zip.readEntry(); });
          });
        } else {
          zip.readEntry();
        }
      });
      zip.on("end", () => resolve(found));
      zip.readEntry();
    });
  });
}

function textOfXml(xml) {
  if (!xml) return "";
  return xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function main() {
  // Lazy-import the generator (TS via tsx).
  const { generatePolicyDocxBuffer, findTemplatePath } = await import("../server/veritapolicyDocx.ts");

  const master = await loadMasterList();
  console.log(`Master list: ${master.length} policies`);

  let pass = 0;
  let fail = 0;
  const failures = [];
  const tmpDir = path.join(REPO_ROOT, ".tmp_verify_docx");
  fs.mkdirSync(tmpDir, { recursive: true });

  for (const p of master) {
    const id = p.policy_id;
    const errors = [];

    const tmplPath = findTemplatePath(id);
    if (!tmplPath) {
      errors.push("template file missing");
    } else {
      const buf = await generatePolicyDocxBuffer(id, { lab_name: LAB_NAME, clia_number: CLIA });
      if (!buf) {
        errors.push("generator returned null");
      } else if (buf.length < 1000) {
        errors.push(`DOCX too small: ${buf.length} bytes`);
      } else {
        const outPath = path.join(tmpDir, `${String(id).padStart(3, "0")}.docx`);
        fs.writeFileSync(outPath, buf);
        const bodyXml = await readDocxXml(outPath, "word/document.xml");
        const footerXml = await readDocxXml(outPath, "word/footer1.xml");
        const headerXml = await readDocxXml(outPath, "word/header1.xml");

        const bodyText = textOfXml(bodyXml);
        const footerText = textOfXml(footerXml);
        const headerText = textOfXml(headerXml);

        if (bodyText.includes("<<LAB_NAME>>")) errors.push("<<LAB_NAME>> literal left in body");
        if (!bodyText.includes(LAB_NAME)) errors.push(`body missing lab name '${LAB_NAME}'`);
        if (!headerText.includes(LAB_NAME)) errors.push(`header missing lab name '${LAB_NAME}'`);
        if (!headerText.includes(CLIA)) errors.push(`header missing CLIA '${CLIA}'`);
        if (!footerText.includes("VeritaAssure") || !footerText.includes("VeritaPolicy")) errors.push("footer missing brand line");
        const bodyEmDashes = (bodyText.match(/—/g) || []).length;
        if (bodyEmDashes > 0) errors.push(`body has ${bodyEmDashes} em-dash(es) (CLAUDE.md §3 violation)`);
        fs.unlinkSync(outPath);
      }
    }

    if (errors.length === 0) {
      pass += 1;
      process.stdout.write(".");
    } else {
      fail += 1;
      failures.push({ id, name: p.policy_name, errors });
      process.stdout.write("F");
    }
  }
  process.stdout.write("\n");

  fs.rmdirSync(tmpDir, { recursive: true });

  console.log(`\nVerified ${master.length} policies: ${pass} PASS, ${fail} FAIL`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) {
      console.log(`  #${f.id} ${f.name}`);
      for (const e of f.errors) console.log(`    - ${e}`);
    }
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
