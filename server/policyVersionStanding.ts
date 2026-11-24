// server/policyVersionStanding.ts
//
// Where each version of a VeritaDC document stands, for the people who may open its earlier versions: editors and the approvers on
// its route (mayOpenEarlierVersions in server/policyDocumentControl.ts; shared/policyVersionStanding.ts has the words). Reads
// only. A limited Staff login reads the approved version only (BUG-151), so nothing here is ever sent to it.

import { versionLabel } from "../shared/policyVersion";
import type { VersionStandingInfo } from "../shared/policyVersionStanding";
import { approvedReadVersionId, type ApprovedReadDoc } from "./policyApprovedVersion";

/** Where every version of a document stands. An archived document's versions stand as they did when it was archived. */
export function versionStandings(sqlite: any, doc: ApprovedReadDoc & { id: number }): Map<number, VersionStandingInfo> {
  const versions = sqlite
    .prepare("SELECT id, version_number, version_major, version_minor FROM policy_versions WHERE document_id = ?")
    .all(doc.id) as any[];
  const inEffectId = approvedReadVersionId({ ...doc, archived_at: null });
  const inEffect = versions.find((v) => v.id === inEffectId) ?? null;
  return new Map(versions.map((v): [number, VersionStandingInfo] => {
    const standing: VersionStandingInfo["standing"] =
      v.id === doc.current_version_id ? "current"
        : v.id === inEffectId ? "in_effect"
          : inEffect && v.version_number > inEffect.version_number ? "not_approved"
            : "superseded";
    return [Number(v.id), { standing, in_use_label: versionLabel(inEffect) }];
  }));
}
