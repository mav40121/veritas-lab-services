// What Sentry may collect with an error report (2026-10-26, Sentry 8 -> 11). Sentry 11 removed `sendDefaultPii` and
// replaced it with `dataCollection`, whose defaults COLLECT user info and IP address, cookies, headers, request and
// response bodies, query strings, database query data and stack-frame variables. Veritas's policy, architecture
// diagram and customer security answers say Sentry receives no personal information by default, so every category is
// off here; reports keep the error, stack trace and code context only. Used by server/index.ts and client/src/main.tsx;
// pinned by scripts/verify-sentry-data-collection.ts.
export const SENTRY_DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [] as never[],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  mcp: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
};

// Breadcrumbs are separate from dataCollection. By default Sentry copies console lines into the next error report, and
// a browser's page and request addresses can carry an invite, reset or surveyor link (BUG-133, 2026-11-04). None of
// those leave our servers or the browser. Other breadcrumbs stay. Pinned by scripts/verify-sentry-data-collection.ts.
export function sentryBreadcrumbFilter<T extends { category?: string; message?: string; data?: unknown }>(breadcrumb: T): T | null {
  if (breadcrumb.category === "console") return null;
  const text = `${breadcrumb.message ?? ""} ${JSON.stringify(breadcrumb.data ?? {})}`;
  if (maskTokenInAddress(text) !== text) return null;
  return breadcrumb;
}

// An error report also carries the web address of the request or page. Some addresses hold a credential in the query or
// the path (an invite, reset, surveyor or document share link, a one-time PDF or zip, an export file, a booking), so it is masked.
export function maskTokenInAddress(address: string): string {
  return address
    .replace(/([?&][a-z_]*token=)[^&#\s]+/gi, "$1[REDACTED]")
    .replace(/(\/(?:surveyor|policy|public\/policy-share|seats\/invite|pdf|zip|export-all\/file|scheduling\/booking)\/)[^/?#\s]+/gi, "$1[REDACTED]");
}

export function sentryEventFilter<T extends { request?: { url?: string }; transaction?: string }>(event: T): T {
  if (event.request?.url) event.request.url = maskTokenInAddress(event.request.url);
  if (event.transaction) event.transaction = maskTokenInAddress(event.transaction);
  return event;
}
