"""BUG-013 (Michael, Q46 = 1, 2026-10-09): every VeritaPolicy template CFR quote is
rebuilt word for word from the eCFR, and any quote that is not real CFR text is
caught before it ships.

The policy DOCX tells labs: "The following federal regulation language is reproduced
verbatim from the Code of Federal Regulations". An audit on 2026-10-09 found that of
125 quotes from 42 CFR 493, 43 were mostly not CFR text and 45 were edited.

What this script does (no template is changed unless --apply is given):
  1. Fetches every cited section from the eCFR (point-in-time edition ECFR_DATE),
     parses its paragraph tree ((a) / (1) / (i) / (A) ...), and caches the XML.
  2. For each template quote, reads the text at its citation and scores how much of
     the quote appears there (6-word windows), and finds the closest real paragraph
     anywhere in the fetched text.
  3. Sorts each quote:
       A  quote is the cited paragraph (>= 95% found there): normalized to the exact text
       B  right citation, quote edited or merged (50-95%): replaced with the exact text
       C  the quoted words are real CFR text but at a different citation: REVIEW
       D  the quoted words are not in the CFR: REVIEW (proposal: the cited paragraph's
          actual text if it exists, otherwise the closest real paragraph)
  4. Writes a review workbook for Michael and a JSON of every decision. --apply writes
     A and B into the templates; C and D are applied only from an approved decision
     file (--decisions), never on the script's own judgment.
  5. Writes scripts/data/ecfr_policy_quotes_<date>.json: the exact eCFR text for every
     citation the templates use, which verify-policy-cfr-quotes.mjs checks against.

Usage:
  python scripts/policy-cfr/rebuild_cfr_quotes.py --report <xlsx> [--apply] [--decisions <json>]
"""
import argparse
import datetime
import glob
import gzip
import html
import io
import json
import os
import re
import urllib.request

ECFR_DATE = "2026-10-01"
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
TEMPLATES = os.path.join(ROOT, "server", "policyTemplates", "data")
CACHE = os.path.join(HERE, ".ecfr-cache")
EXTRACT = os.path.join(ROOT, "scripts", "data", f"ecfr_policy_quotes_{ECFR_DATE}.json")
ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii", "xiii", "xiv", "xv",
         "xvi", "xvii", "xviii", "xix", "xx", "xxi", "xxii", "xxiii", "xxiv", "xxv"]
# Parts fetched whole (small enough); for anything else only the cited sections are fetched.
WHOLE_PARTS = {("42", "493"), ("21", "606"), ("21", "607"), ("21", "610"), ("21", "630"), ("21", "1271"), ("45", "164"), ("10", "20")}


def fetch(title, part, section=None):
    os.makedirs(CACHE, exist_ok=True)
    name = f"t{title}-p{part}" + (f"-s{section}" if section else "") + f"-{ECFR_DATE}.xml"
    path = os.path.join(CACHE, name)
    if os.path.exists(path):
        return open(path, encoding="utf-8").read()
    url = f"https://www.ecfr.gov/api/versioner/v1/full/{ECFR_DATE}/title-{title}.xml?part={part}" + (f"&section={section}" if section else "")
    req = urllib.request.Request(url, headers={"Accept-Encoding": "gzip", "User-Agent": "VeritaAssure-policy-cfr-check"})
    with urllib.request.urlopen(req, timeout=120) as r:
        raw = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            raw = gzip.GzipFile(fileobj=io.BytesIO(raw)).read()
    text = raw.decode("utf-8")
    open(path, "w", encoding="utf-8").write(text)
    return text


def clean(s):
    s = re.sub(r"<[^>]+>", " ", s)
    s = html.unescape(s)
    return re.sub(r"\s+", " ", s).strip()


def words(s):
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).split()


def grams(s, n=6, step=3):
    w = words(s)
    if len(w) < n:
        return {" ".join(w)} if w else set()
    return {" ".join(w[i:i + n]) for i in range(0, len(w) - n + 1, step)}


def grams_all(s, n=6):
    w = words(s)
    if len(w) < n:
        return {" ".join(w)} if w else set()
    return {" ".join(w[i:i + n]) for i in range(len(w) - n + 1)}


# eCFR paragraph markers. Levels: (a) 1, (1) 2, (i) 3, (A) 4, italic (1) 5, italic (i) 6.
# Several markers can open one <P>: "(c) <I>Exposure control</I>—(1) <I>Plan.</I> (i) Each ..."
MARK = re.compile(r"^[—–-]?\s*\(\s*(?:<I>\s*([0-9]+|[a-z]{1,6})\s*</I>|([0-9]+|[a-z]{1,6}|[A-Z]))\s*\)\s*(?:<I>(.*?)</I>\s*)?", re.S)


def split_markers(raw):
    """-> ([(marker, italic, offset_in_raw)], ...) for the markers that open a <P>."""
    rest, pos, out = raw.strip(), 0, []
    full = rest
    while True:
        m = MARK.match(rest)
        if not m:
            break
        mk = m.group(1) or m.group(2)
        lead = len(rest) - len(rest.lstrip("—–- "))
        out.append((mk, bool(m.group(1)), pos + lead))
        pos += m.end()
        rest = rest[m.end():]
    return full, out


def nxt_roman(r):
    return ROMAN[ROMAN.index(r) + 1] if r in ROMAN and ROMAN.index(r) + 1 < len(ROMAN) else None


def assign_level(mk, italic, stack, following):
    """Level for one marker. `following` = the markers after it (for i / v / x: roman or letter?)."""
    if italic:
        return 5 if mk.isdigit() else 6
    if mk.isdigit():
        return 2
    if mk.isupper():
        return 4
    if mk not in ROMAN:
        return 1
    if len(mk) > 1 and mk not in ("ii", "iii"):  # iv, vi, xi ... are never letters
        return 3
    prev1 = next((m for l, m in reversed(stack) if l == 1), None)
    prev3 = next((m for l, m in reversed(stack) if l == 3), None)
    cur = stack[-1][0] if stack else 0
    as_letter = prev1 is not None and len(mk) == 1 and ord(mk) == ord(prev1) + 1
    as_roman = (mk == "i" and cur == 2) or (prev3 is not None and nxt_roman(prev3) == mk and cur >= 3)
    if mk in ("ii", "iii"):
        return 3
    if as_roman and not as_letter:
        return 3
    if as_letter and not as_roman:
        return 1
    if as_letter and as_roman:  # e.g. "(i)" right after "(h)(2)": look at what comes next
        for m2, it2 in following:
            if it2:
                continue
            if m2 == nxt_roman(mk) or m2.isupper():
                return 3
            if (len(m2) == 1 and m2.islower() and ord(m2) == ord(mk) + 1) or m2.isdigit():
                return 1
            break
        return 3
    return 3 if cur >= 2 else 1


def parse_section(div):
    """-> list of P entries: {'paths': [...], 'segments': {path: text from that marker on}, 'text', 'cur'}.
    A <P> without a marker (definitions, run-on text) belongs to the paragraph open above it."""
    raws = re.findall(r"<P>(.*?)</P>", div, re.S)
    split = [split_markers(r) for r in raws]
    flat = [(i, mk, it) for i, (_, ms) in enumerate(split) for mk, it, _ in ms]
    out, stack, k = [], [], 0
    for i, (full, ms) in enumerate(split):
        paths, segs = [], {}
        for mk, it, off in ms:
            k += 1
            lvl = assign_level(mk, it, stack, [(m, t) for _, m, t in flat[k:k + 3]])
            while stack and stack[-1][0] >= lvl:
                stack.pop()
            stack.append((lvl, mk))
            path = "".join(f"({x})" for _, x in stack)
            paths.append(path)
            segs[path] = clean(full[off:])
        out.append({"paths": paths, "segments": segs, "text": clean(full), "cur": "".join(f"({x})" for _, x in stack)})
    return out


def under(path, target):
    return path == target or path.startswith(target + "(")


CITE = re.compile(r"(\d+)\s*CFR\s*(?:Part\s*)?(\d+)(?:\.(\d+[a-z]?))?\s*((?:\([^)]+\))*)(?:\s*-\s*((?:\([^)]+\))+))?")


def parse_cite(c):
    m = CITE.search(c)
    if not m:
        return None
    title, part, sec, path, upto = m.groups()
    return {"title": title, "part": part, "section": f"{part}.{sec}" if sec else None, "path": path or "", "upto": upto or ""}


class Corpus:
    def __init__(self):
        self.sections = {}  # "493.1271" -> parsed P list
        self.heads = {}

    def load_part(self, title, part):
        xml = fetch(title, part)
        for m in re.finditer(r'<DIV8 N="([^"]+)"[^>]*>(.*?)</DIV8>', xml, re.S):
            n, body = m.group(1), m.group(2)
            if n in self.sections:
                continue
            head = re.search(r"<HEAD>(.*?)</HEAD>", body, re.S)
            self.heads[n] = clean(head.group(1)) if head else n
            self.sections[n] = parse_section(body)

    def load_section(self, title, part, section):
        if section in self.sections:
            return
        xml = fetch(title, part, section)
        m = re.search(r'<DIV8 N="([^"]+)"[^>]*>(.*?)</DIV8>', xml, re.S)
        if m:
            head = re.search(r"<HEAD>(.*?)</HEAD>", m.group(2), re.S)
            self.heads[m.group(1)] = clean(head.group(1)) if head else m.group(1)
            self.sections[m.group(1)] = parse_section(m.group(2))

    def text_at(self, section, path="", upto=""):
        ps = self.sections.get(section)
        if ps is None:
            return None
        if not path:
            return " ".join(p["text"] for p in ps) or None
        targets = [path]
        if upto:  # a range like (a)-(c): same level, letters/numbers between
            last = re.findall(r"\(([^)]+)\)", path)[-1]
            end = re.findall(r"\(([^)]+)\)", upto)[-1]
            prefix = path[: path.rfind("(")]
            if last.isdigit() and end.isdigit():
                seq = [str(i) for i in range(int(last), int(end) + 1)]
            elif last in ROMAN and end in ROMAN and len(last) + len(end) > 2:
                seq = ROMAN[ROMAN.index(last): ROMAN.index(end) + 1]
            else:
                seq = [chr(c) for c in range(ord(last), ord(end) + 1)]
            targets = [f"{prefix}({x})" for x in seq]
        parts = []
        for p in ps:
            for t in targets:
                hit = next((seg for pth, seg in p["segments"].items() if pth == t), None)
                if hit is not None:
                    parts.append(hit)
                    break
                if (p["paths"] and under(p["paths"][0], t)) or (not p["paths"] and under(p["cur"], t)):
                    parts.append(p["text"])
                    break
        return " ".join(parts) or None

    def best_match(self, quote, part_prefix):
        q = grams(quote)
        if not q:
            return None
        best = (0.0, None, None)
        for sec, ps in self.sections.items():
            if not sec.startswith(part_prefix + "."):
                continue
            for p in ps:
                g = grams_all(p["text"])
                cov = len(q & g) / len(q)
                if cov > best[0]:
                    best = (cov, f"{sec}{p['paths'][0] if p['paths'] else ''}", p["text"])
            g = grams_all(" ".join(p["text"] for p in ps))
            cov = len(q & g) / len(q)
            if cov > best[0] + 0.05:
                best = (cov, sec, " ".join(p["text"] for p in ps))
        return best


def house(s):
    """eCFR text as printed in a policy: em/en dashes become hyphens (house copy rule); no word changes."""
    s = re.sub(r"\s*[—–]\s*", " - ", s or "")
    return re.sub(r"\s+", " ", s).strip()


def excerpt(quote, cited):
    """The exact eCFR words the quote was taken from. Short paragraphs come back whole; in a long
    one, only the stretch(es) the quote covers, joined by " ... " where CFR text is skipped."""
    from difflib import SequenceMatcher
    if len(cited) <= max(1.5 * len(quote), 1200):
        return cited
    cw = [(m.group(0).lower(), m.start(), m.end()) for m in re.finditer(r"[A-Za-z0-9]+", cited)]
    qw = words(quote)
    sm = SequenceMatcher(None, qw, [w for w, _, _ in cw], autojunk=False)
    spans = sorted((b, b + n) for _, b, n in sm.get_matching_blocks() if n >= 3)
    if not spans:
        return cited
    merged = [list(spans[0])]
    for s, e in spans[1:]:
        if s - merged[-1][1] <= 12:
            merged[-1][1] = max(merged[-1][1], e)
        elif s >= merged[-1][1]:
            merged.append([s, e])
    # Widen each stretch to whole clauses: back to a paragraph marker or the end of the previous
    # sentence/clause, forward to the next "." or ";" that ends one (not the dot in "493.1261").
    starts = sorted({0} | {m.end() for m in re.finditer(r"(?:[.;:]|\s-)\s+(?=\S)", cited)}
                    | {m.start(1) for m in re.finditer(r"(?:^|\s)(\((?:[0-9]+|[a-z]{1,5}|[A-Z])\))\s", cited)})
    ends = sorted({len(cited)} | {m.end() for m in re.finditer(r"[.;](?=\s|$)", cited)})
    spans_c = []
    for s, e in merged:
        a = max(x for x in starts if x <= cw[s][1])
        z = min(x for x in ends if x >= cw[e - 1][2])
        if spans_c and a <= spans_c[-1][1]:
            spans_c[-1][1] = max(spans_c[-1][1], z)
        else:
            spans_c.append([a, z])
    pieces = [cited[a:z].strip() for a, z in spans_c]
    return " ... ".join(p for p in pieces if p)


STOP = set("the a an of to and or in for on by with as at be is are was were that this which any each such from its their must shall may will not under all other than these those if has have been it".split())


class Similar:
    """Closest real paragraph by wording (TF-IDF cosine over content words and word pairs). Finds the
    source of a reworded quote, which a 6-word phrase match cannot."""

    def __init__(self, corpus, part):
        import math
        self.units = []
        for sec, ps in corpus.sections.items():
            if not sec.startswith(part + "."):
                continue
            seen = set()
            for p in ps:
                for path in p["paths"][:1]:
                    if path in seen:
                        continue
                    seen.add(path)
                    self.units.append((f"{sec}{path}", corpus.text_at(sec, path) or p["text"]))
            self.units.append((sec, " ".join(p["text"] for p in ps)))
        self.vecs = [self._tf(t) for _, t in self.units]
        df = {}
        for v in self.vecs:
            for k in v:
                df[k] = df.get(k, 0) + 1
        n = len(self.vecs)
        self.idf = {k: math.log((n + 1) / (c + 0.5)) for k, c in df.items()}
        self.norms = [self._norm(v) for v in self.vecs]

    @staticmethod
    def _tf(text):
        w = [x for x in words(text) if len(x) > 2 and x not in STOP]
        v = {}
        for t in w + [f"{a} {b}" for a, b in zip(w, w[1:])]:
            v[t] = v.get(t, 0) + 1
        return v

    def _norm(self, v):
        return sum((c * self.idf.get(k, 0)) ** 2 for k, c in v.items()) ** 0.5 or 1.0

    def top(self, text):
        q = self._tf(text)
        qn = self._norm(q)
        best = (0.0, None, None)
        for (cite, t), v, vn in zip(self.units, self.vecs, self.norms):
            dot = sum(c * v.get(k, 0) * self.idf.get(k, 0) ** 2 for k, c in q.items())
            s = dot / (qn * vn)
            if s > best[0]:
                best = (s, cite, t)
        return best


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", required=True)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--decisions")
    a = ap.parse_args()

    blocks = []
    for f in sorted(glob.glob(os.path.join(TEMPLATES, "*.json"))):
        d = json.load(open(f, encoding="utf-8"))
        for i, b in enumerate(d.get("cfr_text_blocks") or []):
            blocks.append({"file": os.path.basename(f), "title": d.get("title", ""), "index": i, **b})

    corpus = Corpus()
    for b in blocks:
        c = parse_cite(b["citation"])
        b["_c"] = c
        if not c or not c["section"]:
            continue
        if (c["title"], c["part"]) in WHOLE_PARTS:
            corpus.load_part(c["title"], c["part"])
        else:
            corpus.load_section(c["title"], c["part"], c["section"])
    similar = {}

    rows = []
    for b in blocks:
        c = b["_c"]
        quote = b.get("verbatim", "") or ""
        q = grams(quote)
        cited = corpus.text_at(c["section"], c["path"], c["upto"]) if c and c["section"] else None
        cov_cited = (len(q & grams_all(cited)) / len(q)) if (cited and q) else 0.0
        best = corpus.best_match(quote, c["part"]) if c else None
        cov_best, best_cite, best_text = best if best else (0.0, None, None)
        if cited is None:
            cat = "D"
        elif cov_cited >= 0.95:
            cat = "A"
        elif cov_cited >= 0.5:
            cat = "B"
        elif cov_best >= 0.6:
            cat = "C"
        else:
            cat = "D"
        sim_score, sim_cite, sim_text = 0.0, None, None
        if cat in ("C", "D") and c:
            if c["part"] not in similar:
                similar[c["part"]] = Similar(corpus, c["part"])
            sim_score, sim_cite, sim_text = similar[c["part"]].top(quote)
        T = c["title"] if c else ""
        if cat in ("A", "B"):
            prop_cite, prop_text, action = b["citation"], house(excerpt(quote, cited)), "applied: exact eCFR text"
        elif cat == "C":
            sec = best_cite.split("(")[0]
            src = corpus.text_at(sec, best_cite[len(sec):]) or best_text
            prop_cite, prop_text, action = f"{T} CFR {best_cite}", house(excerpt(quote, src)), "change citation to where the words are"
        elif sim_cite and sim_score >= 0.30 and (not cited or not under(sim_cite, c["section"] + c["path"])):
            strong = sim_score >= 0.6
            prop_cite, prop_text = f"{T} CFR {sim_cite}", house(sim_text)
            action = ("reworded from another paragraph (strong match): cite it and quote its real text" if strong
                      else "possible source (weak match, check it): cite it and quote its real text")
        elif cited:
            prop_cite, prop_text, action = b["citation"], house(cited), "keep citation, quote what it actually says"
        else:
            prop_cite, prop_text, action = "", "", "citation does not exist: remove block or choose a citation"
        rows.append({
            "file": b["file"], "template": b["title"], "index": b["index"], "citation": b["citation"], "label": b.get("label", ""),
            "category": cat, "found_at_citation": round(cov_cited * 100),
            "closest_citation": f"{T} CFR {best_cite}" if best_cite else "", "closest_found": round(cov_best * 100),
            "likely_source": f"{T} CFR {sim_cite}" if sim_cite else "", "likely_score": round(sim_score * 100),
            "quote": quote, "cited_text": house(cited) if cited else "(this citation does not exist in the eCFR)",
            "proposed_citation": prop_cite, "proposed_text": prop_text, "proposed_action": action,
            "section_heading": corpus.heads.get(c["section"], "") if c and c["section"] else "",
        })

    # A and B apply on --apply. C and D change only from Michael's decision file:
    # {"<file>#<index>": {"action": "proposed" | "keep_citation" | "remove" | "replace", "citation"?, "text"?}}
    decisions = json.load(open(a.decisions, encoding="utf-8")) if a.decisions else {}
    if a.apply:
        by_file = {}
        for r in rows:
            dec = decisions.get(f"{r['file']}#{r['index']}")
            if r["category"] in ("A", "B"):
                change = (r["citation"], r["proposed_text"])
            elif not dec:
                continue
            elif dec["action"] == "proposed":
                change = (r["proposed_citation"], r["proposed_text"])
            elif dec["action"] == "keep_citation":
                change = (r["citation"], r["cited_text"])
            elif dec["action"] == "replace":
                change = (dec["citation"], dec["text"])
            elif dec["action"] == "remove":
                change = (None, None)
            else:
                raise SystemExit(f"unknown decision {dec}")
            by_file.setdefault(r["file"], []).append((r["index"], *change))
        for f, changes in by_file.items():
            write_in_place(os.path.join(TEMPLATES, f), changes)
        print(f"applied: {sum(len(v) for v in by_file.values())} quotes in {len(by_file)} templates")

    # Exact eCFR text (house dashes) for every citation now in the templates; the check script reads this.
    extract = {}
    for f in sorted(glob.glob(os.path.join(TEMPLATES, "*.json"))):
        for b in json.load(open(f, encoding="utf-8")).get("cfr_text_blocks") or []:
            c = parse_cite(b["citation"])
            if c and c["section"]:
                if c["section"] not in corpus.sections:
                    corpus.load_section(c["title"], c["part"], c["section"])
                t = corpus.text_at(c["section"], c["path"], c["upto"])
                if t:
                    extract[b["citation"]] = house(t)
    os.makedirs(os.path.dirname(EXTRACT), exist_ok=True)
    json.dump({"source": f"eCFR point-in-time {ECFR_DATE} (www.ecfr.gov versioner API); em dashes printed as hyphens",
               "built": datetime.date.today().isoformat(), "text": dict(sorted(extract.items()))},
              open(EXTRACT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    json.dump(rows, open(os.path.join(HERE, "quote_audit.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    write_report(a.report, rows, scan_in_text(corpus, rows))


def write_in_place(path, changes):
    """Change only the quote blocks' text in the template file, keeping its hand formatting (one-line
    arrays and so on). Afterwards the file must parse to exactly the expected content, or nothing is written."""
    raw = open(path, encoding="utf-8").read()
    d = json.loads(raw)
    want = json.loads(raw)
    bl = want["cfr_text_blocks"]
    for idx, cite, text in changes:
        bl[idx] = None if cite is None else {**bl[idx], "citation": cite, "verbatim": text}
    want["cfr_text_blocks"] = [x for x in bl if x is not None]
    enc = lambda v: json.dumps(v, ensure_ascii=False)
    cur = raw.index('"cfr_text_blocks"')
    out, last = [], 0
    todo = {idx: (cite, text) for idx, cite, text in changes}
    for i, old in enumerate(d["cfr_text_blocks"]):
        c0 = raw.index(f'"citation": {enc(old["citation"])}', cur)
        v0 = raw.index(f'"verbatim": {enc(old["verbatim"])}', c0)
        v1 = v0 + len(f'"verbatim": {enc(old["verbatim"])}')
        cur = v1
        if i not in todo:
            continue
        cite, text = todo[i]
        if cite is None:  # drop the whole {...} block and its separating comma
            a = raw.rindex("{", 0, c0)
            z = raw.index("}", v1) + 1
            m = re.match(r"\s*,", raw[z:])
            if m:
                z += m.end()
            else:
                a = raw.rindex(",", 0, a)
            out.append(raw[last:a])
            last = z
        else:
            out.append(raw[last:c0])
            out.append(raw[c0:v0].replace(f'"citation": {enc(old["citation"])}', f'"citation": {enc(cite)}', 1))
            out.append(f'"verbatim": {enc(text)}')
            last = v1
    out.append(raw[last:])
    new = "".join(out)
    if json.loads(new) != want:
        raise SystemExit(f"{os.path.basename(path)}: in-place edit did not produce the expected JSON; nothing written")
    open(path, "w", encoding="utf-8", newline="").write(new)


IN_TEXT = re.compile(r"\b(10|21|29|42|45)\s*CFR\s*(?:Part\s*)?§*\s*(\d{2,4})\.(\d+[a-z]?)((?:\([a-zA-Z0-9]{1,5}\))*)")


def scan_in_text(corpus, rows):
    """CFR citations in policy text outside the quote blocks: flag any that do not exist in the eCFR,
    and any that repeat a quote citation now under review (they must change with that quote)."""
    review = {(r["file"], r["citation"].replace(" ", "")): r for r in rows if r["category"] in ("C", "D")}
    out = []

    def walk(o, field, f):
        if isinstance(o, dict):
            for k, v in o.items():
                if k != "cfr_text_blocks":
                    walk(v, f"{field}.{k}" if field else k, f)
        elif isinstance(o, list):
            for i, v in enumerate(o):
                walk(v, f"{field}[{i}]", f)
        elif isinstance(o, str):
            for m in IN_TEXT.finditer(o):
                title, part, sec, path = m.group(1), m.group(2), f"{m.group(2)}.{m.group(3)}", m.group(4) or ""
                if sec not in corpus.sections:
                    try:
                        corpus.load_part(title, part) if (title, part) in WHOLE_PARTS else corpus.load_section(title, part, sec)
                    except Exception:
                        pass
                cite = f"{title} CFR {sec}{path}"
                exists = sec in corpus.sections and (not path or corpus.text_at(sec, path) is not None)
                tied = review.get((f, cite.replace(" ", "")))
                if not exists or tied:
                    a, z = max(0, m.start() - 90), min(len(o), m.end() + 60)
                    out.append({"file": f, "field": field, "citation": cite,
                                "problem": "does not exist in the eCFR" if not exists else
                                f"same citation as a quote under review ({tied['category']}); change it with that quote's decision ({tied['proposed_citation']})",
                                "context": ("..." if a else "") + o[a:z] + ("..." if z < len(o) else ""), "checked": True})
    total = 0
    for fp in sorted(glob.glob(os.path.join(TEMPLATES, "*.json"))):
        d = json.load(open(fp, encoding="utf-8"))
        before = len(out)
        walk(d, "", os.path.basename(fp))
        total += sum(1 for _ in IN_TEXT.finditer(json.dumps({k: v for k, v in d.items() if k != "cfr_text_blocks"}, ensure_ascii=False)))
    print(f"in-text citations checked {total}, flagged {len(out)}")
    return {"total": total, "flagged": out}


def write_report(path, rows, in_text):
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    TEAL, ALT, TXT = "01696F", "EBF3F8", "28251D"
    thin = Side(style="thin", color="D0D0D0")
    box = Border(left=thin, right=thin, top=thin, bottom=thin)
    wb = Workbook()
    about = wb.active
    about.title = "About"
    cnt = {k: sum(1 for r in rows if r["category"] == k) for k in "ABCD"}
    lines = [
        ("VeritaPolicy template CFR quotes checked against the eCFR (BUG-013 review)", True),
        (f"Built {datetime.date.today().isoformat()} from the eCFR point-in-time edition of {ECFR_DATE}. {len(rows)} quotes in {len({r['file'] for r in rows})} templates.", False),
        ("Every policy DOCX tells labs its CFR text is reproduced verbatim. This workbook shows which quotes are and which are not.", False),
        ("", False),
        (f"A  {cnt['A']} quotes: the quote is the cited paragraph. Normalized to the exact eCFR text. Applied automatically.", False),
        (f"B  {cnt['B']} quotes: right citation, but the quote was edited, shortened or merged. Replaced with the exact eCFR text of that citation. Applied automatically.", False),
        (f"C  {cnt['C']} quotes: the words are real CFR text, but from a different paragraph than the one cited. Needs your decision.", False),
        (f"D  {cnt['D']} quotes: the words are not CFR text (reworded, outdated or invented). Needs your decision.", False),
        ("", False),
        ("How to decide (sheet 'Decide C and D', column K): 'proposed' = take the proposed citation and text; 'keep citation' = keep the citation and quote what it actually says;", False),
        ("'remove' = drop the block; or type a citation. A blank row stays as it is and the new check keeps failing on it, so nothing unreviewed ships.", False),
        ("", False),
        ("Long paragraphs are excerpted, not paraphrased: only the stretch the policy relies on, exact eCFR words, with ' ... ' where text is skipped.", False),
        ("Em dashes in the CFR are printed as hyphens (house copy rule). No word is changed.", False),
        ("Found % = share of the quote's wording (6-word runs) present in that text. Likely source = the paragraph closest in wording, used to find reworded quotes.", False),
    ]
    for t, bold in lines:
        about.append([t])
        if bold:
            about.cell(about.max_row, 1).font = Font(bold=True, size=14, color=TEAL)
    about.column_dimensions["A"].width = 160

    def sheet(name, cols, data, widths):
        ws = wb.create_sheet(name)
        ws.append(cols)
        ws.row_dimensions[1].height = 30
        for cell in ws[1]:
            cell.fill = PatternFill("solid", fgColor=TEAL)
            cell.font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
            cell.alignment = Alignment(wrap_text=True, vertical="center")
            cell.border = box
        for i, r in enumerate(data):
            ws.append(r)
            for cell in ws[ws.max_row]:
                cell.font = Font(name="Calibri", size=10, color=TXT)
                cell.alignment = Alignment(wrap_text=True, vertical="top")
                cell.border = box
                if i % 2:
                    cell.fill = PatternFill("solid", fgColor=ALT)
        for i, w in enumerate(widths, 1):
            ws.column_dimensions[ws.cell(1, i).column_letter].width = w
        ws.freeze_panes = "C2"
        ws.auto_filter.ref = ws.dimensions
        return ws

    cut = lambda s: (s or "")[:32000]
    review = sorted([r for r in rows if r["category"] in ("C", "D")], key=lambda r: (r["category"], r["file"], r["index"]))
    sheet("Decide C and D", ["Template", "Cat", "Current citation", "What the template quotes", "What that citation actually says (eCFR)",
                             "Words found at citation %", "Likely source (closest wording)", "Proposed action", "Proposed citation", "Proposed text (exact eCFR)",
                             "Your decision", "Key"],
          [[f"{r['file'][:-5]} | {r['template']}", r["category"], r["citation"], cut(r["quote"]), cut(r["cited_text"]), r["found_at_citation"],
            f"{r['likely_source']} ({r['likely_score']})" if r["likely_source"] else "", r["proposed_action"], r["proposed_citation"], cut(r["proposed_text"]),
            "", f"{r['file']}#{r['index']}"] for r in review],
          [30, 6, 20, 55, 55, 10, 22, 26, 20, 55, 16, 8])
    sheet("Applied A and B", ["Template", "Cat", "Citation", "Found at citation %", "Old quote", "New quote (exact eCFR)"],
          [[f"{r['file'][:-5]} | {r['template']}", r["category"], r["citation"], r["found_at_citation"], cut(r["quote"]), cut(r["proposed_text"])]
           for r in sorted(rows, key=lambda r: (r["category"], r["file"])) if r["category"] in ("A", "B")],
          [30, 6, 22, 10, 70, 70])
    sheet("In-text citations", ["Template", "Where", "Citation in the policy text", "Problem", "Text around it"],
          [[x["file"][:-5], x["field"], x["citation"], x["problem"], x["context"]] for x in in_text["flagged"]],
          [24, 22, 22, 50, 90])
    about.append([f"In-text citations: {in_text['total']} CFR citations in policy text were checked; {len(in_text['flagged'])} are listed on the 'In-text citations' sheet."])
    wb.active = 0
    wb.save(path)
    print(f"quotes {len(rows)} | A {cnt['A']} B {cnt['B']} C {cnt['C']} D {cnt['D']} | report {path}")


if __name__ == "__main__":
    main()
