// Verify receipt for the VeritaDC reminder-email template rendering (#39).
// Exercises the REAL renderTemplateString / renderReminderEmail +
// DEFAULT_TEMPLATES from server/policyReminderTemplate.ts: merge-field
// substitution, missing-value -> empty, unknown token left intact, and the
// defaults reproduce the historical copy shape.
//
// Run: npx tsx scripts/verify-veritadc-email-templates.ts
import { renderTemplateString, renderReminderEmail, DEFAULT_TEMPLATES } from "../server/policyReminderTemplate";

const vars = {
  policy_title: "Specimen Rejection Criteria",
  lab_name: "Riverside Regional",
  next_review_date: "2026-11-01",
  owner_name: "Dr. Chen",
  days_until: 12,
  review_link: "https://www.veritaslabservices.com/labs/3/veritapolicy-app/my-policies",
};

interface C { name: string; got: any; exp: any; }
const cases: C[] = [
  { name: "substitutes a known field", got: renderTemplateString("Due: {{policy_title}}", vars), exp: "Due: Specimen Rejection Criteria" },
  { name: "numeric field renders", got: renderTemplateString("in {{days_until}} days", vars), exp: "in 12 days" },
  { name: "whitespace inside braces tolerated", got: renderTemplateString("{{  lab_name  }}", vars), exp: "Riverside Regional" },
  { name: "missing known field -> empty", got: renderTemplateString("[{{owner_name}}]", { policy_title: "x" }), exp: "[]" },
  { name: "unknown token left intact", got: renderTemplateString("hi {{totally_unknown}}", vars), exp: "hi {{totally_unknown}}" },
  { name: "custom template renders subject+html", got: renderReminderEmail({ subject: "{{policy_title}} due {{next_review_date}}", body_html: "<p>{{lab_name}}</p>" }, vars),
    exp: { subject: "Specimen Rejection Criteria due 2026-11-01", html: "<p>Riverside Regional</p>" } },
  { name: "default 30_day subject uses days_until + title", got: renderReminderEmail(DEFAULT_TEMPLATES["30_day_warning"], vars).subject,
    exp: "Policy review due in 12 days: Specimen Rejection Criteria" },
  { name: "default overdue subject", got: renderReminderEmail(DEFAULT_TEMPLATES["overdue"], vars).subject, exp: "Policy review overdue: Specimen Rejection Criteria" },
  { name: "default body has the review link substituted", got: renderReminderEmail(DEFAULT_TEMPLATES["final"], vars).html.includes(vars.review_link), exp: true },
];

let pass = 0, fail = 0;
for (const c of cases) {
  const ok = JSON.stringify(c.got) === JSON.stringify(c.exp);
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.name}`);
  if (!ok) console.log(`    exp ${JSON.stringify(c.exp)}\n    got ${JSON.stringify(c.got)}`);
  ok ? pass++ : fail++;
}
console.log(`\n${pass}/${cases.length} passed, ${fail} failed`);
if (fail) process.exit(1);
