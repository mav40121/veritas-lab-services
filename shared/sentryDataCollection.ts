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
