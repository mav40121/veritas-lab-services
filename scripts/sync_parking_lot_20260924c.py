# Parking-lot sync 2026-09-24 pass 3:
#   - Close #49 (unify recurrence helper) as a non-issue after investigation.
#   - Log the shipped verified-users product-update send path (PR #1324).
import re, pathlib
MD = pathlib.Path(__file__).resolve().parent.parent / "PARKING_LOT.md"
text = MD.read_text(encoding="utf-8")

# Remove the OPEN #49 block.
pat = re.compile(r"### 49\. Unify the coverage/competency recurrence.*?\n---\n", re.DOTALL)
text, n = pat.subn("", text, count=1)
if n != 1:
    raise SystemExit(f"expected to remove one #49 block, removed {n}")

closed = """### C45. Unify coverage/competency recurrence helper (was #49) - closed as non-issue

**Closure evidence:** Investigated 2026-09-24 before building. The coverage recurrence math (+6-month interval, signed-resets-to-missing, nextDueOn/overdue, isFailVerdict) is ALREADY single-source in server/veritacheckCoverage.ts (computeCoverageFrom). server/coverageReport.ts and the routes.ts coverage export do not recompute it; they consume the computed nextDueOn/overdue/status fields and apply small surface-specific presentation labels (deliberately different vocabularies per surface, so they should not be merged). The only truly identical duplicate is a one-line date formatter. The competency "owed" derivation is NOT the same cadence: competency follows the CLIA milestone schedule (initial / semiannual year 1 / annual, 42 CFR 493.1451(b)(8) and 493.1235), which is a different regulatory interval from the coverage 6-month rule (493.1281 / 493.1255) and must stay separate. No worthwhile extraction; merging the two cadences would be wrong. Closed 2026-09-24. (The year-1 competency-window refinement remains tracked separately as #50.)

**Source:** 2026-09-24 session, "keep working" pass; scoped read-only, found no real duplication.

---

### C46. Verified-users product-update send path (wrong-list incident fix)

**Closure evidence:** Shipped PR #1324 (merged 4e05506a, deploy ACTIVE). New POST /api/admin/users/send targets registered VeritaAssure account holders (the users table), never the Lab Director's Briefing subscriber list. Separate explicitly-named endpoint (not a flag with a dangerous default), account-holder email framing, excludes suppressed emails and RFC-reserved test domains, CC owner, dryRun + testTo previews. Public unsubscribe now upserts a suppression row so opt-outs are honored across both audiences. Live dryRun: 49 verified-user recipients vs 673 on the Briefing list. Receipts: scripts/verify-product-update-send.mts 24/24, tsc clean, rendered sample inspected. Fixes the fallout from the 2026-09-23/24 wrong-list send (a product update went to the 675-person Briefing list). Nothing sends without Michael's explicit "send it."

**Source:** 2026-09-24 session; Michael selected this as the next build after the #41 close.

---

"""
marker = "## CLOSED (audit trail)\n\n"
i = text.find(marker) + len(marker)
text = text[:i] + closed + text[i:]
MD.write_text(text, encoding="utf-8")
print("Closed #49 -> C45; logged verified-users email path -> C46.")
