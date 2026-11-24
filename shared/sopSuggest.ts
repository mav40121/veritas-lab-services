// shared/sopSuggest.ts
//
// Which of a lab's VeritaDC documents a VeritaResponse finding probably points at (B8, 2026-11-24). Simple and
// explainable on purpose: every suggestion carries the words or the citation that made it one, and nothing is ever linked by
// itself. Three things count:
//   1. The finding's standard reference is written in the document's title, number or description.
//   2. One of the lab's policy requirements cites that reference, and names this document (or has its title).
//   3. The document's title, or its number and description, shares topic words with the finding.

export interface SuggestFinding {
  standard_ref?: string | null;
  description?: string | null;
  pt_analyte?: string | null;
  /** The name of the VeritaCheck study the finding was opened from, if any. */
  study?: string | null;
}
export interface SuggestDoc { id: number; title: string; doc_number?: string | null; description?: string | null }
export interface SuggestRequirement { policy_name: string; citations: string; our_policy_name?: string | null }
export interface Suggestion { id: number; score: number; reasons: string[] }

const NOT_COLA = new Set(["CFR", "EP", "SEC", "PART", "PAGE", "ITEM", "PHASE", "RFI", "NCE", "NO"]);

/**
 * The standards named in a text: CFR sections (493.1253), CAP items (GEN.20377), TJC standards (QSA.02.06.01), COLA criteria
 * (QC 26) and AABB standards (5.1.10). A paragraph after a section ((b)(1)) is left off, so 493.1253(b)(1) is 493.1253.
 */
export function citationTokens(text: string | null | undefined): string[] {
  let s = String(text ?? "").toUpperCase();
  const out = new Set<string>();
  const take = (re: RegExp, as: (m: RegExpMatchArray) => string | null = (m) => m[0]) => {
    for (const m of s.matchAll(re)) { const t = as(m); if (t) out.add(t); }
    s = s.replace(re, " ");
  };
  take(/\b[A-Z]{2,4}(?:\.\d{2}){3,4}\b/g);                       // TJC
  take(/\b[A-Z]{2,4}\.\d{4,6}\b/g);                              // CAP
  take(/\b\d{3,4}\.\d{2,4}\b/g);                                 // CFR section
  take(/\b\d{1,2}(?:\.\d{1,2}){2,3}\b/g);                        // AABB
  take(/\b([A-Z]{2,4})\s(\d{1,3})\b/g, (m) => (NOT_COLA.has(m[1]) ? null : `${m[1]} ${m[2]}`)); // COLA
  return [...out];
}

// Words that say nothing about the topic: English, and the ones every laboratory document and finding uses.
const STOP = new Set(("about above after again also and any are because been before being below between both but can could did does doing done down during each few for from further had has have having " +
  "here how into its itself just more most not now off once only other our out over own same she should some such than that the their them then there these they this those through too under until up very was " +
  "were what when where which while who whom why will with within without would you your per via " +
  "lab labs laboratory laboratories policy policies procedure procedures sop document documents documentation form forms manual record records recorded recording test tests testing tested " +
  "result results patient patients staff person personnel director designee medical supervisor department review reviewed reviewing required requirement requirements require standard standards " +
  "finding findings deficiency deficiencies event events made missing found find failed fail failure study veritacheck dated include included including follow followed following perform performed " +
  "performing using used use new one two three four five day days week month months year years time date every all some none yes monitoring process method methods system general written " +
  "ensure action corrective evidence complete completed compliance compliant").split(/\s+/));

const stem = (w: string) => (w.length > 5 && w.endsWith("ies") ? `${w.slice(0, -3)}y` : w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);

/** The topic words of a text: 4 letters or more (numbers aside), lower case, plural taken off, the words above left out. */
export function topicWords(text: string | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const raw of String(text ?? "").toLowerCase().match(/[a-z][a-z0-9]*/g) ?? []) {
    if (raw.length < 4 || STOP.has(raw)) continue;
    const w = stem(raw);
    if (w.length >= 4 && !STOP.has(w)) out.add(w);
  }
  return out;
}

const norm = (s: string | null | undefined) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const list = (xs: string[]) => xs.slice(0, 4).join(", ");

/** The best few documents for a finding, highest first. An empty list when nothing matches. */
export function suggestDocuments(finding: SuggestFinding, docs: SuggestDoc[], requirements: SuggestRequirement[], limit = 8): Suggestion[] {
  const refs = citationTokens(finding.standard_ref);
  const topics = topicWords([finding.description, finding.pt_analyte, finding.study].filter(Boolean).join(" "));
  const cited = requirements
    .map((r) => ({ ...r, hits: citationTokens(r.citations).filter((c) => refs.includes(c)) }))
    .filter((r) => r.hits.length > 0);
  const out: Suggestion[] = [];
  for (const d of docs) {
    let score = 0;
    const reasons: string[] = [];
    const named = citationTokens([d.title, d.doc_number, d.description].filter(Boolean).join(" ; ")).filter((c) => refs.includes(c));
    if (named.length) { score += 10; reasons.push(`Names ${list(named)}`); }

    const title = norm(d.title), number = norm(d.doc_number), titleWords = topicWords(d.title);
    let best: { score: number; reason: string } | null = null;
    for (const r of cited) {
      const ours = norm(r.our_policy_name);
      const byName = !!ours && (ours === title || (!!number && ours === number) || (title.length >= 8 && ours.includes(title)));
      const reqWords = [...topicWords(r.policy_name)], shared = reqWords.filter((x) => titleWords.has(x));
      const byTitle = norm(r.policy_name) === title || (reqWords.length >= 2 && shared.length === reqWords.length);
      const hit = byName ? { score: 8, reason: `Your policy list gives it for "${r.policy_name}", which cites ${list(r.hits)}` }
        : byTitle ? { score: 6, reason: `Matches the policy requirement "${r.policy_name}", which cites ${list(r.hits)}` } : null;
      if (hit && (!best || hit.score > best.score)) best = hit;
    }
    if (best) { score += best.score; reasons.push(best.reason); }

    const inTitle = [...titleWords].filter((x) => topics.has(x));
    const inRest = [...topicWords([d.doc_number, d.description].filter(Boolean).join(" "))].filter((x) => topics.has(x) && !inTitle.includes(x));
    if (inTitle.length * 2 + inRest.length >= 2) {
      score += inTitle.length * 2 + inRest.length;
      if (inTitle.length) reasons.push(`Title shares: ${list(inTitle)}`);
      if (inRest.length) reasons.push(`Description shares: ${list(inRest)}`);
    }
    if (score >= 2) out.push({ id: d.id, score, reasons });
  }
  return out.sort((a, b) => b.score - a.score || a.id - b.id).slice(0, limit);
}
