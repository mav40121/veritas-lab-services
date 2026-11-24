// shared/systemDocuments.ts
//
// One controlled procedure for several laboratories (B1; server/policySharedDocuments.ts): the words for where a laboratory stands
// on a system document, used by its own screens, the organization's view and that view's Excel file, so they can't disagree.

/** How a laboratory's document stands to the system document it came from. */
export type SystemCopyState = "following" | "retired" | "left" | "own_copy" | "declined";

/** Where a laboratory stands on a system document, in the organization's view. */
export type SystemLabState = "current" | "waiting" | "behind" | "declined" | "own_copy" | "left" | "archived" | "removed";

export const SYSTEM_LAB_STATE_LABEL: Record<SystemLabState, string> = {
  current: "Approved",
  waiting: "Waiting for approval",
  behind: "On an earlier version",
  declined: "Declined",
  own_copy: "Keeps its own copy",
  left: "Left the system",
  archived: "Archived by the laboratory",
  removed: "Deleted by the laboratory",
};

export const DECLINE_REASON_MAX = 500;
export const SEND_LABS_MAX = 500;

/** "System document, version 2.1": the label on a laboratory's document. */
export const systemDocumentLabel = (version: string | null | undefined): string =>
  version ? `System document, version ${version}` : "System document";

/** The words under the label, saying where it came from and what that means here. */
export function systemDocumentNote(d: { state: SystemCopyState; organization_name: string | null; in_force_own?: boolean }): string {
  const from = d.organization_name || "your system";
  switch (d.state) {
    case "following":
      return `From ${from}. Your laboratory approves each version before it is used here.`;
    case "retired":
      return `${from} has retired this document. Your approved copy stays in use until your laboratory archives it.`;
    case "left":
      return `Came from ${from}. Your laboratory is no longer part of it, so this is your own document and new versions don't arrive.`;
    case "own_copy":
      return `Came from ${from}. Your laboratory keeps its own copy, so new versions don't arrive.`;
    case "declined":
      return `From ${from}. Your laboratory declined it.`;
  }
}
