// scripts/verify-system-repository.mjs
//
// Gate-3 receipt for the system repository input validator
// (server/systemRepository.ts validateSystemDocument). Mirrors the pure logic.
//
// Run: node scripts/verify-system-repository.mjs

function validateSystemDocument(input) {
  const title = typeof input?.title === "string" ? input.title.trim() : "";
  if (!title) return { ok: false, error: "title is required" };
  if (title.length > 300) return { ok: false, error: "title is too long (max 300)" };
  const url = typeof input?.url === "string" ? input.url.trim() : "";
  if (!url) return { ok: false, error: "url is required" };
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: "url must start with http:// or https://" };
  if (url.length > 2048) return { ok: false, error: "url is too long (max 2048)" };
  const category = typeof input?.category === "string" && input.category.trim() ? input.category.trim().slice(0, 100) : null;
  const description = typeof input?.description === "string" && input.description.trim() ? input.description.trim().slice(0, 2000) : null;
  return { ok: true, value: { title, url, category, description } };
}

let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`  FAIL  ${name} -> ${detail}`); } };

let r;
r = validateSystemDocument({ title: "Chemistry SOP binder", url: "https://sharepoint.com/x", category: "SOPs", description: "all chem SOPs" });
ok("valid full doc accepted", r.ok && r.value.title === "Chemistry SOP binder" && r.value.category === "SOPs", JSON.stringify(r));

r = validateSystemDocument({ title: "  Trimmed  ", url: "  https://a.com/b  " });
ok("title + url trimmed; optional fields null", r.ok && r.value.title === "Trimmed" && r.value.url === "https://a.com/b" && r.value.category === null && r.value.description === null, JSON.stringify(r));

r = validateSystemDocument({ title: "", url: "https://a.com" });
ok("empty title rejected", !r.ok && /title is required/.test(r.error), JSON.stringify(r));

r = validateSystemDocument({ title: "x", url: "" });
ok("empty url rejected", !r.ok && /url is required/.test(r.error), JSON.stringify(r));

r = validateSystemDocument({ title: "x", url: "javascript:alert(1)" });
ok("javascript: url rejected", !r.ok && /must start with http/.test(r.error), JSON.stringify(r));

r = validateSystemDocument({ title: "x", url: "/relative/path" });
ok("relative url rejected", !r.ok && /must start with http/.test(r.error), JSON.stringify(r));

r = validateSystemDocument({ title: "x", url: "HTTPS://CAPS.com" });
ok("https case-insensitive accepted", r.ok, JSON.stringify(r));

r = validateSystemDocument({ title: "a".repeat(301), url: "https://a.com" });
ok("over-long title rejected", !r.ok && /too long/.test(r.error), JSON.stringify(r));

r = validateSystemDocument({ title: "x", url: "https://a.com", category: "  ", description: "  " });
ok("whitespace-only optionals -> null", r.ok && r.value.category === null && r.value.description === null, JSON.stringify(r));

r = validateSystemDocument({ title: 5, url: 7 });
ok("non-string inputs rejected", !r.ok, JSON.stringify(r));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
