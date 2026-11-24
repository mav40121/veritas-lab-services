// shared/policyVersionStanding.ts
//
// Where one version of a VeritaDC document stands, and the words the screen uses for it (server/policyVersionStanding.ts works
// it out; the version history and the viewer show it to editors and the approvers on the document's route).
//   current       the version the document is on now
//   in_effect     the approved version, while the document is on a newer draft or in-review version
//   superseded    an older version that another one replaced
//   not_approved  a draft newer than the approved version that was replaced before it was approved

export type VersionStanding = "current" | "in_effect" | "superseded" | "not_approved";

export interface VersionStandingInfo {
  standing: VersionStanding;
  // The approved version read now, as a label such as "2.0", or null when the document has none.
  in_use_label: string | null;
}

export const STANDING_LABEL: Record<VersionStanding, string> = {
  current: "Current",
  in_effect: "Approved version in effect",
  superseded: "Superseded",
  not_approved: "Draft, never approved",
};

// Printed across an old version and an archived document, so a screenshot or a print can't pass for the procedure in use.
export const SUPERSEDED_WATERMARK = "SUPERSEDED - UNCONTROLLED COPY";
export const NOT_APPROVED_WATERMARK = "NEVER APPROVED - UNCONTROLLED COPY";
export const ARCHIVED_WATERMARK = "ARCHIVED - UNCONTROLLED COPY";

/** What follows the standing's own label above an earlier version while someone reads it, or null for the current version. */
export function standingNote(label: string, s: VersionStandingInfo): string | null {
  const now = s.in_use_label ? `Version ${s.in_use_label} is in use now. ` : "";
  if (s.standing === "superseded") return `${now}Version ${label} is shown for reference only.`;
  if (s.standing === "not_approved") return `Version ${label} was replaced before anyone approved it. ${now}It is shown for reference only.`;
  if (s.standing === "in_effect") return `Version ${label} is the one in use. A newer revision isn't approved yet.`;
  return null;
}
