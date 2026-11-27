// shared/staffReadSign.ts
//
// How a Staff login's read-and-sign was made, in the words the signature roster and the signature report use (BUG-188,
// server/policyStaffSign.ts). A signature made before BUG-188 has no signed_with: the person typed their name with no password,
// and the hash on the row is the one their browser sent. Those stay signed (mock 3, Q3), and the record says so.

export const TYPED_NAME_ONLY = "Typed name, no password";
export const BEFORE_PASSWORDS = "Signed before passwords were asked";
export const HASH_MATCHES = "Hash matches";
export const HASH_FROM_BROWSER = "As sent by browser";

/** How the signature was made: "Name and password", "<hospital> sign-in", or a typed name with no password for one made before. */
export function readSignHow(method: string | null | undefined, provider: string | null | undefined): string {
  if (method === "sso") return provider ? `${provider} sign-in` : "Hospital sign-in";
  if (method === "password") return "Name and password";
  return TYPED_NAME_ONLY;
}

/** The line beside it: the server's hash matched the version's record, or the signature is from before passwords were asked. */
export function readSignNote(method: string | null | undefined, signedHash: string | null | undefined, versionHash: string | null | undefined): string {
  if (method !== "password" && method !== "sso") return BEFORE_PASSWORDS;
  return signedHash && versionHash && signedHash === versionHash ? HASH_MATCHES : "Hash doesn't match the version on file";
}

/** "5c0e 91d7": the first eight characters of a hash in two groups, for a report column. */
export function shortHash(hash: string | null | undefined, groups = 2): string {
  const h = String(hash ?? "").replace(/[^0-9a-f]/gi, "").toLowerCase();
  if (!h) return "";
  return (h.slice(0, groups * 4).match(/.{1,4}/g) || []).join(" ");
}
