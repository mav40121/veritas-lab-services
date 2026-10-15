// Password rule for new and changed passwords (two-factor sign-in Stage 1, mock Q171 = 1, 2026-10-14).
// At least 8 characters using 3 of the 4 character types. Lifepoint's IPS asks for 7 or more; 8 was
// approved in the mock. Existing passwords keep working: the rule applies only when a password is set
// (register, change, reset, admin reset), never at sign-in.
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_RULE_TEXT =
  "At least 8 characters, using 3 of these 4: upper case, lower case, a number, a symbol.";

export function passwordProblem(pw: unknown): string | null {
  const s = typeof pw === "string" ? pw : "";
  if (s.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  const kinds = [/[A-Z]/, /[a-z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(s)).length;
  if (kinds < 3) return "Password must use 3 of these 4: upper case, lower case, a number, a symbol.";
  return null;
}
