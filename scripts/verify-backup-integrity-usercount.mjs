// Receipt for the backup-integrity userCount hardening (exclude internal/test accounts).
//
// The nightly integrity check false-tripped when QA/Playwright accounts churned
// (qa-*@veritaslabservices.com created/deleted). The fix counts REAL users only
// (excluding Michael-owned internal domains) and gates the alert on that count,
// with a NULL-prior transition that does not false-alarm on the first run.
//
// This verifies: (1) the SQL predicate partitions the actual prod email set into
// 24 real / 4 internal, (2) qa-* churn does not move the real count, (3) the
// OK-branch logic (NULL prior -> ok; real drop -> not ok; stable/increase -> ok).
//
// Run: npx tsx scripts/verify-backup-integrity-usercount.mjs

import Database from "better-sqlite3";

// Must mirror server/backup.ts REAL_USER_PREDICATE exactly.
const REAL_USER_PREDICATE = "email NOT LIKE '%@veritaslabservices.com' AND email NOT LIKE '%@veritaslab.com'";

// The 28 distinct prod accounts (from /api/admin/report on 2026-06-30).
const PROD_EMAILS = [
  "demo@veritaslabservices.com",              // internal
  "computer@veritaslab.com",                  // internal
  "john.hall@scahealth.org",
  "gghafour@gmail.com",
  "verilabguy@gmail.com",                     // Michael (real owner)
  "gaynoll.arthurs@scahealth.org",
  "rodrigo.gaspartrillo@scahealth.org",
  "bobbi.persinger@scahealth.org",
  "dhmccormick@gmail.com",
  "michael.veri@scahealth.org",
  "drsmohsin@yahoo.com",
  "xiaoyiem@usc.edu",
  "jeffmmoore@hotmail.com",
  "lisa.veri@umassmemorial.org",
  "daniela.rivera@pfizer.com",
  "chineme.swann@scahealth.org",
  "nam.lemorawa@scahealth.org",
  "jrobinso@copcp.com",
  "qa-policy-1780083331@veritaslabservices.com", // QA/Playwright (internal, churny)
  "yauweh.daniels@scahealth.org",
  "michael.longstreth@copcp.com",
  "ria.salcido@scahealth.org",
  "nlamb@sampsonrmc.org",
  "jhall713@live.com",
  "tywauna@trendyelitellc.com",
  "christian.bartlett@scahealth.org",
  "info@veritaslabservices.com",              // internal
  "lisa.j.veri@gmail.com",                    // Lisa (real)
];

let fails = 0;
const check = (name, cond) => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}`); if (!cond) fails++; };

const db = new Database(":memory:");
db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)");
const ins = db.prepare("INSERT INTO users (email) VALUES (?)");
for (const e of PROD_EMAILS) ins.run(e);

const total = db.prepare("SELECT COUNT(*) c FROM users").get().c;
const real = db.prepare(`SELECT COUNT(*) c FROM users WHERE ${REAL_USER_PREDICATE}`).get().c;
const excluded = db.prepare(`SELECT email FROM users WHERE NOT (${REAL_USER_PREDICATE}) ORDER BY email`).all().map(r => r.email);

check("total accounts = 28", total === 28);
check("real users = 24", real === 24);
check("exactly 4 excluded", excluded.length === 4);
check("excluded set is the 4 internal accounts", JSON.stringify(excluded) === JSON.stringify([
  "computer@veritaslab.com", "demo@veritaslabservices.com", "info@veritaslabservices.com", "qa-policy-1780083331@veritaslabservices.com",
]));
check("no real customer excluded (all scahealth/copcp/pfizer/umass/gmail kept)",
  !excluded.some(e => /scahealth|copcp|pfizer|umassmemorial|usc\.edu|sampsonrmc|trendyelite/.test(e)) &&
  db.prepare(`SELECT COUNT(*) c FROM users WHERE email='verilabguy@gmail.com' AND ${REAL_USER_PREDICATE}`).get().c === 1);

// qa-* churn must NOT move the real count.
for (let i = 0; i < 5; i++) ins.run(`qa-policy-${1000 + i}@veritaslabservices.com`);
const total2 = db.prepare("SELECT COUNT(*) c FROM users").get().c;
const real2 = db.prepare(`SELECT COUNT(*) c FROM users WHERE ${REAL_USER_PREDICATE}`).get().c;
check("after adding 5 qa-* accounts: total rises to 33", total2 === 33);
check("after adding 5 qa-* accounts: real count unchanged at 24", real2 === 24);

// OK-branch logic (mirror of backup.ts): realUserCount>0 && (priorReal==null || realUserCount>=priorReal)
const okFn = (realCount, priorReal) => realCount > 0 && (priorReal == null || realCount >= priorReal);
check("NULL prior (first post-deploy run) -> ok even though 24 < legacy all-users 32", okFn(24, null) === true);
check("real drop 24 -> 23 vs prior 24 -> NOT ok (real loss still alerts)", okFn(23, 24) === false);
check("stable 24 vs prior 24 -> ok", okFn(24, 24) === true);
check("increase 25 vs prior 24 -> ok", okFn(25, 24) === true);
check("zero real users -> NOT ok (catastrophic)", okFn(0, null) === false);

console.log(`\n${fails === 0 ? "ALL PASS" : fails + " FAILED"}`);
process.exit(fails === 0 ? 0 : 1);
