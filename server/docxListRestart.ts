// server/docxListRestart.ts
//
// BUG-088 (2026-10-27): Redington-Fairview house-format policies printed "01 Principle, 02 Policy, 03 Procedure" and then
// "01 References, 02 Revised, 03 Biannual ..." when Word saved them as PDF: the list numbers restarted at the first
// section heading on page 3. Word itself numbers the document 01 to 06; only its PDF export restarts.
//
// Cause, found by changing one thing at a time and exporting through Word: the docx library (9.x) gives every list
// instance a <w:lvlOverride><w:startOverride w:val="1"/> in numbering.xml, and Word's PDF export re-applies that override
// part-way through the document. Removing it gives 01 to 06 in the PDF; adding a w:nsid or dropping
// w15:restartNumberingAfterBreak changes nothing.
//
// The override is only needed to RESTART a list: when one list definition (abstractNum) is used by two or more
// instances, each instance starts again at its override. When a definition has exactly one instance, the override
// repeats the definition's own start and can go. Those are the only ones removed here.

import JSZip from "jszip";

const NUM_RE = /<w:num w:numId="(\d+)"([^>]*)>([\s\S]*?)<\/w:num>/g;
const ABSTRACT_ID_RE = /<w:abstractNumId w:val="(\d+)"\s*\/>/;
const START_ONE_RE = /<w:lvlOverride w:ilvl="0">\s*<w:startOverride w:val="1"\s*\/>\s*<\/w:lvlOverride>/;

export function stripSingleInstanceStartOverrides(numberingXml: string): { xml: string; removed: number; kept: number } {
  const uses = new Map<string, number>();
  for (const m of numberingXml.matchAll(NUM_RE)) {
    const a = ABSTRACT_ID_RE.exec(m[3])?.[1];
    if (a) uses.set(a, (uses.get(a) ?? 0) + 1);
  }
  let removed = 0;
  let kept = 0;
  const xml = numberingXml.replace(NUM_RE, (whole, id: string, attrs: string, body: string) => {
    if (!START_ONE_RE.test(body)) return whole;
    const a = ABSTRACT_ID_RE.exec(body)?.[1];
    if (!a || uses.get(a) !== 1) { kept++; return whole; }
    removed++;
    return `<w:num w:numId="${id}"${attrs}>${body.replace(START_ONE_RE, "")}</w:num>`;
  });
  return { xml, removed, kept };
}

// Applied to every generated policy .docx (server/veritapolicyDocx.ts). Returns the buffer unchanged when there is
// nothing to remove.
export async function fixDocxListRestarts(buf: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buf);
  const file = zip.file("word/numbering.xml");
  if (!file) return buf;
  const { xml, removed } = stripSingleInstanceStartOverrides(await file.async("string"));
  if (!removed) return buf;
  zip.file("word/numbering.xml", xml);
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}
