// Redact credentials from what the request logger in server/index.ts writes: the path, and the whole JSON
// response body of every /api call. It matched exact key names until 2026-11-04, which let invite_token,
// inviteToken, joinUrl, resetUrl and session_token through into the server logs, along with tokens in route
// paths (BUG-133). Anything ending in "token" now counts, and so does a link that carries one, whatever its
// key is called.
const SENSITIVE_LOG_KEY = /token$|secret|password|^pass$|^pwd$|^jwt$|api_?key|authorization|^pin$/i;
const TOKEN_IN_VALUE = /[?&][a-z_]*token=|\/surveyor\/[\w-]{8,}/i;

export function redactSensitive(key: string, value: any): any {
  if (typeof value === "string" && (SENSITIVE_LOG_KEY.test(key) || TOKEN_IN_VALUE.test(value))) return "[REDACTED]";
  return value;
}

// The routes that take their credential in the path.
const TOKEN_IN_PATH = /^(\/api\/(?:surveyor|seats\/invite|pdf|zip|export-all\/file|scheduling\/booking)\/)[^/]+/;

export function redactPath(path: string): string {
  return path.replace(TOKEN_IN_PATH, "$1[REDACTED]");
}
