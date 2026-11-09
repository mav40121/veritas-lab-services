// What the request logger in server/index.ts writes for each /api call: the method, the path, the status and the time.
// It held whole JSON response bodies until 2026-11-04, which put names, work emails, job titles, credential numbers,
// invite links and session tokens in the server logs, and from there into error reports (BUG-133). No body goes in now.

// The routes that take their credential in the path.
const TOKEN_IN_PATH = /^(\/api\/(?:surveyor|public\/policy-share|seats\/invite|pdf|zip|export-all\/file|scheduling\/booking)\/)[^/]+/;

export function redactPath(path: string): string {
  return path.replace(TOKEN_IN_PATH, "$1[REDACTED]");
}

export function requestLogLine(method: string, path: string, status: number, ms: number): string {
  return `${method} ${redactPath(path)} ${status} in ${ms}ms`;
}
