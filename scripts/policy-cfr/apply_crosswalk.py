"""Apply the approved master-list CFR crosswalk (Michael Q52 = 1, 2026-10-09) to server/veritapolicyMasterList.ts.
Reads crosswalk_changes_2026-10-09.json (built by crosswalk_review.py) and replaces each policy's "cfr_citations"
value in place, keeping the file's formatting. Refuses to write unless the file then parses to exactly the
approved crosswalk for every policy, with every other field unchanged."""
import json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
MASTER = os.path.join(os.path.dirname(os.path.dirname(HERE)), "server", "veritapolicyMasterList.ts")


def parse(src):
    a = src.index("= [", src.index("VERITAPOLICY_MASTER_LIST")) + 2
    depth, i = 0, a
    while True:
        if src[i] == "[":
            depth += 1
        elif src[i] == "]":
            depth -= 1
            if depth == 0:
                break
        i += 1
    return json.loads(src[a:i + 1])


def main():
    after = json.load(open(os.path.join(HERE, "crosswalk_changes_2026-10-09.json"), encoding="utf-8"))["after"]
    src = open(MASTER, encoding="utf-8", newline="").read()
    before = parse(src)
    out, pos, changed = [], 0, 0
    for row in before:
        pid = row["policy_id"]
        k = src.index(f'"policy_id": {json.dumps(pid)}', pos)
        m = re.compile(r'"cfr_citations": (".*?(?<!\\)")').search(src, k)
        out.append(src[pos:m.start(1)])
        new = json.dumps(after[pid], ensure_ascii=False)
        out.append(new)
        changed += new != m.group(1)
        pos = m.end(1)
    out.append(src[pos:])
    new_src = "".join(out)
    got = parse(new_src)
    want = [{**r, "cfr_citations": after[r["policy_id"]]} for r in before]
    if got != want:
        raise SystemExit("master list did not parse to the approved crosswalk; nothing written")
    open(MASTER, "w", encoding="utf-8", newline="").write(new_src)
    print(f"cfr_citations changed on {changed} of {len(before)} policies")


if __name__ == "__main__":
    main()
