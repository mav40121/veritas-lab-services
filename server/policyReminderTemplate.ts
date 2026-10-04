// Customizable VeritaDC review-reminder email templates (#39 MediaLab parity).
// Each lab can override the subject and HTML body for the three reminder types;
// with no override the built-in defaults (which reproduce the historical copy)
// are used. Rendering is a pure merge-field substitution so it is unit-testable
// and identical whether the template is custom or default.

export type ReminderType = "30_day_warning" | "overdue" | "final";

export const REMINDER_TYPES: ReminderType[] = ["30_day_warning", "overdue", "final"];

// Merge fields a template may use. Unknown {{tokens}} are left untouched so a
// typo is visible rather than silently dropped; a known field with no value
// renders empty.
export const REMINDER_MERGE_FIELDS = [
  "policy_title",
  "lab_name",
  "next_review_date",
  "owner_name",
  "days_until",
  "review_link",
] as const;

export interface ReminderTemplate {
  subject: string;
  body_html: string;
}

// Shared default body (matches the pre-customization copy); only the subject
// differed per type historically.
const DEFAULT_BODY = `<p>Hi {{owner_name}},</p>
<p>The policy <strong>{{policy_title}}</strong> on {{lab_name}} is due for review on <strong>{{next_review_date}}</strong>.</p>
<p>
  Open VeritaDC: <a href="{{review_link}}">{{review_link}}</a><br>
  Click <strong>Recertify</strong> to confirm the policy is still current, or <strong>Submit</strong> a revised version through the approval workflow.
</p>
<p>VeritaAssure&trade; / VeritaDC&trade;</p>`;

export const DEFAULT_TEMPLATES: Record<ReminderType, ReminderTemplate> = {
  "30_day_warning": { subject: "Policy review due in {{days_until}} days: {{policy_title}}", body_html: DEFAULT_BODY },
  overdue: { subject: "Policy review overdue: {{policy_title}}", body_html: DEFAULT_BODY },
  final: { subject: "Final notice: policy review past due: {{policy_title}}", body_html: DEFAULT_BODY },
};

// Substitute {{field}} tokens from vars. Known fields render their value (or
// empty string when missing); unknown tokens are left as-is.
export function renderTemplateString(tpl: string, vars: Record<string, string | number | null | undefined>): string {
  return tpl.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (whole, key) => {
    const k = String(key).toLowerCase();
    if (!(REMINDER_MERGE_FIELDS as readonly string[]).includes(k)) return whole;
    const v = vars[k];
    return v === null || v === undefined ? "" : String(v);
  });
}

// Render a full reminder email from a template (custom or default) + vars.
export function renderReminderEmail(
  tpl: ReminderTemplate,
  vars: Record<string, string | number | null | undefined>
): { subject: string; html: string } {
  return {
    subject: renderTemplateString(tpl.subject, vars),
    html: renderTemplateString(tpl.body_html, vars),
  };
}
