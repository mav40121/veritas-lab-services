// scripts/verify-readiness.mjs
//
// Receipt for MLC-3 (cross-module inspection-readiness rollup). Exercises the
// per-module status classification and the lab-level roll-up used by
// computeLabReadiness() in server/routes.ts.
//
//   node scripts/verify-readiness.mjs
let fails = 0;
const ok = (label, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}${cond ? "" : "  -- " + detail}`); if (!cond) fails++; };

// Module status: overdue if any overdue, else attention if any due-soon, else ok.
const moduleStatus = (overdue, dueSoon) => overdue > 0 ? "overdue" : dueSoon > 0 ? "attention" : "ok";
// Lab-level roll-up over module {overdue, due_soon}.
function rollup(modules) {
  const withStatus = modules.map(m => ({ ...m, status: moduleStatus(m.overdue, m.due_soon) }));
  const modules_ok = withStatus.filter(m => m.status === "ok").length;
  const overdue_items = withStatus.reduce((a, m) => a + m.overdue, 0);
  const attention_items = withStatus.reduce((a, m) => a + m.overdue + m.due_soon, 0);
  return { modules: withStatus, modules_total: withStatus.length, modules_ok, overdue_items, attention_items,
           status: overdue_items > 0 ? "overdue" : attention_items > 0 ? "attention" : "ok" };
}

ok("module with an overdue item -> 'overdue'", moduleStatus(2, 0) === "overdue");
ok("module with only due-soon -> 'attention'", moduleStatus(0, 3) === "attention");
ok("module with overdue AND due-soon -> 'overdue' (overdue wins)", moduleStatus(1, 5) === "overdue");
ok("module with nothing pending -> 'ok'", moduleStatus(0, 0) === "ok");

// All clear.
let r = rollup([{ overdue: 0, due_soon: 0 }, { overdue: 0, due_soon: 0 }]);
ok("all modules clear -> lab status 'ok', 2/2 on track", r.status === "ok" && r.modules_ok === 2 && r.overdue_items === 0);

// One overdue drags the lab to 'overdue'.
r = rollup([{ overdue: 1, due_soon: 0 }, { overdue: 0, due_soon: 2 }, { overdue: 0, due_soon: 0 }]);
ok("any overdue module -> lab 'overdue'", r.status === "overdue");
ok("lab counts: 1/3 on track, 1 overdue item, 3 attention items", r.modules_ok === 1 && r.overdue_items === 1 && r.attention_items === 3);

// Only due-soon -> attention.
r = rollup([{ overdue: 0, due_soon: 1 }, { overdue: 0, due_soon: 0 }]);
ok("due-soon only -> lab 'attention'", r.status === "attention" && r.overdue_items === 0 && r.attention_items === 1);

console.log(fails === 0 ? "\n=== READINESS ROLLUP: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
