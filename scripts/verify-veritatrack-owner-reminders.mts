// Verifies groupNotifiableForSend (server/veritatrackReminders): owner-only
// reminder routing (#51). Owner-only ON splits a lab's due/overdue tasks into
// one digest per task owner (by owner_email), with unowned tasks falling back to
// the lab recipient list so none are dropped. OFF = one lab-wide digest.
import { groupNotifiableForSend } from "../server/veritatrackReminders.ts";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => { if (cond) { pass++; console.log("  PASS", name); } else { fail++; console.log("  FAIL", name); } };
const item = (id: number, owner_email: string | null, owner?: string) => ({ task: { id, name: `T${id}`, owner_email, owner }, kind: "overdue", dueDate: "2026-09-01", days: -5 });
const lab = [{ email: "labowner@lab.org", name: "Lab Owner" }];

// OFF: one lab-wide digest with all items.
{
  const g = groupNotifiableForSend([item(1, "heme@lab.org"), item(2, "chem@lab.org")], false, lab);
  ok("owner-only OFF => single group", g.length === 1);
  ok("owner-only OFF => group goes to lab recipients", g[0].recipients[0].email === "labowner@lab.org");
  ok("owner-only OFF => all items in the one group", g[0].items.length === 2);
}

// ON: one group per owner email.
{
  const g = groupNotifiableForSend([item(1, "heme@lab.org", "Heme Tech"), item(2, "chem@lab.org"), item(3, "heme@lab.org")], true, lab);
  const heme = g.find(x => x.recipients[0].email === "heme@lab.org");
  const chem = g.find(x => x.recipients[0].email === "chem@lab.org");
  ok("owner-only ON => a group per distinct owner email", g.length === 2);
  ok("heme owner gets exactly their 2 tasks", !!heme && heme.items.length === 2 && heme.items.every(i => [1,3].includes(i.task.id)));
  ok("chem owner gets exactly their 1 task", !!chem && chem.items.length === 1 && chem.items[0].task.id === 2);
  ok("heme digest does NOT include the chem task", !!heme && !heme.items.some(i => i.task.id === 2));
  ok("owner name carried onto the recipient", !!heme && heme.recipients[0].name === "Heme Tech");
}

// ON with an unowned task: falls back to the lab recipient list, never dropped.
{
  const g = groupNotifiableForSend([item(1, "heme@lab.org"), item(2, null), item(3, "not-an-email")], true, lab);
  const fallback = g.find(x => x.recipients[0].email === "labowner@lab.org");
  ok("unowned tasks fall back to the lab list", !!fallback && fallback.items.length === 2 && fallback.items.every(i => [2,3].includes(i.task.id)));
  const allItemIds = g.flatMap(x => x.items.map(i => i.task.id)).sort();
  ok("no task is dropped (all 3 present across groups)", JSON.stringify(allItemIds) === JSON.stringify([1,2,3]));
}

// A task's group (Michael 2026-11-04): everyone in it gets the task, on top of the list or the owner.
{
  const sup = { name: "Supervisors", recipients: [{ email: "a@lab.org" }, { email: "b@lab.org" }] };
  const withGroup = (t: any) => (t.id === 1 ? sup : null);
  const off = groupNotifiableForSend([item(1, null), item(2, null)], false, lab, withGroup);
  const digestFor = (g: any[], email: string) => g.filter(x => x.recipients.some((r: any) => r.email === email));
  ok("group, owner-only OFF: the list gets both tasks", digestFor(off, "labowner@lab.org")[0]?.items.length === 2);
  ok("group, owner-only OFF: a member gets only the group's task", digestFor(off, "a@lab.org")[0]?.items.length === 1 && digestFor(off, "a@lab.org")[0].items[0].task.id === 1);
  ok("members with the same tasks share one email", digestFor(off, "a@lab.org")[0] === digestFor(off, "b@lab.org")[0]);

  const on = groupNotifiableForSend([item(1, "heme@lab.org"), item(2, null)], true, lab, withGroup);
  ok("group, owner-only ON: the owner keeps their task", digestFor(on, "heme@lab.org")[0]?.items[0].task.id === 1);
  ok("group, owner-only ON: the group gets it too", digestFor(on, "a@lab.org")[0]?.items[0].task.id === 1);
  ok("group, owner-only ON: the list gets only the unowned task", digestFor(on, "labowner@lab.org")[0]?.items.length === 1 && digestFor(on, "labowner@lab.org")[0].items[0].task.id === 2);

  const overlap = groupNotifiableForSend([item(1, null), item(2, null)], false, [{ email: "A@LAB.ORG" }], withGroup);
  const overlapA = overlap.filter(x => x.recipients.some((r: any) => r.email.toLowerCase() === "a@lab.org"));
  ok("someone on the list and in the group gets one email, whatever the case of the address", overlapA.length === 1 && overlapA[0].items.length === 2);
  ok("no task appears twice for one person", overlapA[0].items.filter(i => i.task.id === 1).length === 1);

  const dropped = groupNotifiableForSend([item(1, null)], true, lab, () => null);
  ok("a task that reaches nobody falls back to the list", dropped.length === 1 && dropped[0].recipients[0].email === "labowner@lab.org");
}

// Empty input => no groups (no email sent).
ok("empty notifiable => no groups", groupNotifiableForSend([], true, lab).length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
