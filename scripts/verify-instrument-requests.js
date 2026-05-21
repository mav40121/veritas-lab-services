// Receipt for the VeritaMap instrument-request feature.
//
// What this verifies (server-side correctness only — Gate 3 Step 8
// requires Michael to click the button on prod to fully verify the
// user flow):
//   1. POST /api/veritamap/instrument-requests creates a record
//   2. Response carries id + deduped flag
//   3. Soft dedup: same name within 5 minutes returns deduped=true
//      with the same id
//   4. Admin GET /api/admin/instrument-requests returns the new record
//   5. Admin POST /api/admin/instrument-requests/:id/resolve sets status
//   6. Resolved record shows status=approved + reviewer_notes
//
// Run:
//   API=https://www.veritaslabservices.com TOKEN=<jwt> \
//     ADMIN_SECRET=<from Railway env> \
//     node scripts/verify-instrument-requests.js

const API = process.env.API || 'https://www.veritaslabservices.com';
const TOKEN = process.env.TOKEN;
const ADMIN_SECRET = process.env.ADMIN_SECRET;

if (!TOKEN) { console.error('TOKEN env var required'); process.exit(2); }
if (!ADMIN_SECRET) { console.error('ADMIN_SECRET env var required'); process.exit(2); }

const AUTH = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const ADMIN = { 'x-admin-secret': ADMIN_SECRET, 'Content-Type': 'application/json' };

let failed = 0;
function check(label, cond, detail) {
  const status = cond ? 'PASS' : 'FAIL';
  if (!cond) failed += 1;
  console.log(`${status}  ${label}${detail ? '  // ' + detail : ''}`);
}

(async () => {
  const uniqueName = `Verify-Test-Instrument-${Date.now()}`;

  // 1. Submit a request
  const submitR = await fetch(`${API}/api/veritamap/instrument-requests`, {
    method: 'POST', headers: AUTH,
    body: JSON.stringify({
      instrument_name: uniqueName,
      vendor: 'Verify Vendor',
      category_suggestion: 'Chemistry',
      example_analytes: 'Glucose, Sodium, Potassium',
      notes: 'Submitted by verify-instrument-requests.js',
    }),
  });
  check('POST submit returns 200', submitR.status === 200, `status=${submitR.status}`);
  const submitBody = submitR.status === 200 ? await submitR.json() : {};
  check('Submit response carries id + deduped flag',
    typeof submitBody.id === 'number' && typeof submitBody.deduped === 'boolean',
    `id=${submitBody.id} deduped=${submitBody.deduped}`);
  check('First submit not deduped', submitBody.deduped === false);
  const requestId = submitBody.id;

  // 2. Submit again same name -> should dedup to same id
  const dupR = await fetch(`${API}/api/veritamap/instrument-requests`, {
    method: 'POST', headers: AUTH,
    body: JSON.stringify({ instrument_name: uniqueName, vendor: 'Other Vendor' }),
  });
  const dupBody = await dupR.json();
  check('Second submit (same name, <5min) returns deduped=true',
    dupBody.deduped === true && dupBody.id === requestId,
    `id=${dupBody.id} deduped=${dupBody.deduped} (expected id=${requestId})`);

  // 3. Admin list shows our record
  const listR = await fetch(`${API}/api/admin/instrument-requests?status=pending`, { headers: ADMIN });
  check('Admin list returns 200', listR.status === 200);
  const list = await listR.json();
  const found = (list.requests || []).find(r => r.id === requestId);
  check('Submitted request appears in admin list',
    !!found && found.instrument_name === uniqueName,
    `found=${!!found} name_match=${found?.instrument_name === uniqueName}`);
  check('Listed record has expected fields',
    found && found.vendor === 'Verify Vendor' && found.category_suggestion === 'Chemistry'
      && found.status === 'pending',
    `vendor=${found?.vendor} cat=${found?.category_suggestion} status=${found?.status}`);

  // 4. Resolve as approved
  const resolveR = await fetch(`${API}/api/admin/instrument-requests/${requestId}/resolve`, {
    method: 'POST', headers: ADMIN,
    body: JSON.stringify({ status: 'approved', reviewer_notes: 'Verify script test resolution' }),
  });
  check('Admin resolve returns 200', resolveR.status === 200, `status=${resolveR.status}`);

  // 5. Confirm status flipped
  const listR2 = await fetch(`${API}/api/admin/instrument-requests?status=approved`, { headers: ADMIN });
  const list2 = await listR2.json();
  const foundAfter = (list2.requests || []).find(r => r.id === requestId);
  check('Resolved record now appears in status=approved list', !!foundAfter);
  check('Reviewer notes saved',
    foundAfter?.reviewer_notes === 'Verify script test resolution',
    `notes=${foundAfter?.reviewer_notes}`);
  check('resolved_at populated', !!foundAfter?.resolved_at);

  // 6. Bad status rejected
  const badR = await fetch(`${API}/api/admin/instrument-requests/${requestId}/resolve`, {
    method: 'POST', headers: ADMIN,
    body: JSON.stringify({ status: 'in-the-trash', reviewer_notes: 'should fail' }),
  });
  check('Invalid resolve status returns 400', badR.status === 400, `status=${badR.status}`);

  console.log(`\n${failed === 0 ? 'ALL TESTS PASSED' : `${failed} TEST(S) FAILED`}`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(err => { console.error(err); process.exit(1); });
