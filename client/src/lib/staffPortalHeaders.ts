// client/src/lib/staffPortalHeaders.ts
//
// My sign-offs reads and signs as the person's own roster entry in ONE lab (B3, BUG-193, 2026-11-24). A floating person has an entry in
// several labs under one sign-in, and the server picks by X-Active-Lab-Id, so every My sign-offs request names the lab the page loaded
// for. Without it the server picked the first Staff seat, whatever lab was on screen.
let portalLabId: number | null = null;

export function setStaffPortalLab(labId: number | null): void {
  portalLabId = labId;
}

export function staffPortalHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, ...(portalLabId ? { "X-Active-Lab-Id": String(portalLabId) } : {}) };
}
