// scripts/verify-veritatrack-frequency.mjs
//
// Gate-3 receipt for parking-lot #54: the scoped VeritaTrack task-create path
// (server/veritatrack.ts POST /api/labs/:labId/veritatrack/tasks) must derive
// frequency_months from the `frequency` STRING the client sends, so the stored
// months column agrees with the label. The old `Number(frequency_months || 1)`
// defaulted every create to 1 month, so a Quarterly task rendered as Monthly
// until re-saved. Mirrors frequencyToMonths + the fixed derivation.
//
// Run: node scripts/verify-veritatrack-frequency.mjs

function frequencyToMonths(freq) {
  switch (freq) {
    case "Monthly":   return 1;
    case "Quarterly": return 3;
    case "Biannual":  return 6;
    case "Annual":    return 12;
    case "Biennial":  return 24;
    default:          return 1;
  }
}

// The fixed line: const freqMonths = Number(frequency_months) || frequencyToMonths(frequency || "Monthly");
function deriveFreqMonths(body) {
  const { frequency, frequency_months } = body;
  return Number(frequency_months) || frequencyToMonths(frequency || "Monthly");
}

let pass = 0, fail = 0;
const eq = (name, got, want) => { if (got === want) { pass++; console.log(`  PASS  ${name} (= ${got})`); } else { fail++; console.log(`  FAIL  ${name}: got ${got}, want ${want}`); } };

// The reported bug: client sends only the frequency string, no frequency_months.
eq("Quarterly string only -> 3 (was the bug: defaulted to 1)", deriveFreqMonths({ frequency: "Quarterly" }), 3);
eq("Monthly string only -> 1", deriveFreqMonths({ frequency: "Monthly" }), 1);
eq("Biannual string only -> 6", deriveFreqMonths({ frequency: "Biannual" }), 6);
eq("Annual string only -> 12", deriveFreqMonths({ frequency: "Annual" }), 12);
eq("Biennial string only -> 24", deriveFreqMonths({ frequency: "Biennial" }), 24);

// Explicit frequency_months (numeric or string) is honored when provided.
eq("explicit frequency_months number wins", deriveFreqMonths({ frequency: "Monthly", frequency_months: 6 }), 6);
eq("explicit frequency_months string wins", deriveFreqMonths({ frequency: "Monthly", frequency_months: "3" }), 3);

// No frequency at all -> safe default (1), never NaN/undefined.
eq("no frequency at all -> 1", deriveFreqMonths({}), 1);
eq("unknown frequency string -> 1", deriveFreqMonths({ frequency: "Hourly" }), 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
