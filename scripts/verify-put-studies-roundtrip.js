// Receipt for the PUT /api/studies/:id and PUT /api/labs/:labId/studies/:id
// double-stringify fix (server/routes.ts ~lines 2952 and 3161).
//
// What the bug was: both PUT handlers ran
//   JSON.stringify(payload.dataPoints)
// where payload.dataPoints could already be a string (insertStudySchema
// declares it as text). That wrapped the JSON string in another layer of
// quotes, corrupting the column on disk. Draft PUTs were unaffected because
// the draft whitelist hands dataPoints through as the parsed object.
//
// What this script verifies: after the fix, PUT round-trips dataPoints
// without double-stringifying, regardless of whether the request body sends
// the field as a stringified payload (non-draft) or as a parsed object
// (draft). The receipt is the SHAPE of data_points returned from a GET
// immediately after the PUT — it must be `[{level:1,...}]`, not
// `"[{level:1,...}]"`.
//
// Run (requires the dev/staging API token in env or paste inline):
//   API=https://www.veritaslabservices.com TOKEN=<jwt> LAB=3 \
//     node scripts/verify-put-studies-roundtrip.js
//
// Exits non-zero on any failure so the script can land in CI later.

const API = process.env.API || 'https://www.veritaslabservices.com';
const TOKEN = process.env.TOKEN;
const LAB_ID = process.env.LAB || '3';

if (!TOKEN) {
  console.error('TOKEN env var required. Pull from browser localStorage["veritas_token"].');
  process.exit(2);
}

const AUTH = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const REPL = [21, 23, 22, 22, 22, 21, 23, 23, 21, 21];
const DATA_POINTS = [{ level: 1, levelName: 'Level 1', values: REPL }];

let failed = 0;

function check(label, cond, detail) {
  const status = cond ? 'PASS' : 'FAIL';
  if (!cond) failed += 1;
  console.log(`${status}  ${label}${detail ? '  // ' + detail : ''}`);
}

(async () => {
  // 1. Create a precision study via POST (works fine today).
  const postBody = {
    testName: 'PUT roundtrip test', instrument: '-', analyst: '-',
    date: new Date().toISOString().slice(0, 10), studyType: 'precision',
    cliaAllowableError: 0.20, teaIsPercentage: 1, teaUnit: '%',
    cliaAbsoluteFloor: null, cliaAbsoluteUnit: null,
    dataPoints: JSON.stringify(DATA_POINTS), instruments: JSON.stringify(['-']),
    status: 'pass', createdAt: new Date().toISOString(),
  };
  const postR = await fetch(`${API}/api/labs/${LAB_ID}/studies`, { method: 'POST', headers: AUTH, body: JSON.stringify(postBody) });
  const created = await postR.json();
  check('POST creates study', postR.status === 200 && created.id, `status=${postR.status} id=${created.id}`);
  const studyId = created.id;
  if (!studyId) { console.log('\nFAILED -- abort'); process.exit(1); }

  // 2. GET back and confirm dataPoints is a JSON array, not a string of a string.
  const get1R = await fetch(`${API}/api/labs/${LAB_ID}/studies/${studyId}`, { headers: AUTH });
  const cur1 = await get1R.json();
  const dp1 = typeof cur1.dataPoints === 'string' ? JSON.parse(cur1.dataPoints) : cur1.dataPoints;
  check('POST -> GET: dataPoints parses to array', Array.isArray(dp1) && dp1[0]?.values?.length === 10, `got len=${dp1?.[0]?.values?.length}`);

  // 3. PUT non-draft (the path that had the bug). Send dataPoints as a JSON
  //    string per insertStudySchema. After the fix, the column should still
  //    hold a single-stringified array.
  const putBody = {
    ...postBody,
    testName: 'PUT roundtrip test (renamed)',
    dataPoints: typeof cur1.dataPoints === 'string' ? cur1.dataPoints : JSON.stringify(cur1.dataPoints),
    instruments: typeof cur1.instruments === 'string' ? cur1.instruments : JSON.stringify(cur1.instruments),
    status: 'pass',
  };
  const putR = await fetch(`${API}/api/labs/${LAB_ID}/studies/${studyId}`, { method: 'PUT', headers: AUTH, body: JSON.stringify(putBody) });
  check('PUT non-draft accepts string dataPoints', putR.status === 200, `status=${putR.status}`);

  // 4. GET back after PUT. Confirm dataPoints did NOT get double-stringified.
  const get2R = await fetch(`${API}/api/labs/${LAB_ID}/studies/${studyId}`, { headers: AUTH });
  const cur2 = await get2R.json();
  let dp2;
  try { dp2 = typeof cur2.dataPoints === 'string' ? JSON.parse(cur2.dataPoints) : cur2.dataPoints; } catch { dp2 = null; }
  // Before the fix, dp2 would be a STRING (the inner JSON string). After the fix, it's an array.
  check('PUT -> GET: dataPoints parses to array (not string)', Array.isArray(dp2) && dp2[0]?.values?.length === 10, `typeof=${typeof dp2} ${Array.isArray(dp2) ? 'array' : 'NOT array'}`);
  check('PUT -> GET: test name updated', cur2.testName === 'PUT roundtrip test (renamed)', `got "${cur2.testName}"`);

  // 5. PUT draft (the path that already worked). Confirm we did not regress it.
  const draftBody = {
    ...postBody,
    testName: 'PUT roundtrip test (draft)',
    status: 'draft',
    dataPoints: DATA_POINTS, // draft path accepts an array
    instruments: ['-'],
  };
  const draftR = await fetch(`${API}/api/labs/${LAB_ID}/studies/${studyId}`, { method: 'PUT', headers: AUTH, body: JSON.stringify(draftBody) });
  check('PUT draft accepts array dataPoints', draftR.status === 200, `status=${draftR.status}`);
  const get3R = await fetch(`${API}/api/labs/${LAB_ID}/studies/${studyId}`, { headers: AUTH });
  const cur3 = await get3R.json();
  let dp3;
  try { dp3 = typeof cur3.dataPoints === 'string' ? JSON.parse(cur3.dataPoints) : cur3.dataPoints; } catch { dp3 = null; }
  check('PUT draft -> GET: dataPoints parses to array', Array.isArray(dp3) && dp3[0]?.values?.length === 10, `typeof=${typeof dp3}`);

  // 6. Clean up.
  const delR = await fetch(`${API}/api/labs/${LAB_ID}/studies/${studyId}`, { method: 'DELETE', headers: AUTH });
  check('DELETE cleanup', delR.status === 200, `status=${delR.status}`);

  console.log(`\n${failed === 0 ? 'ALL TESTS PASSED' : `${failed} TEST(S) FAILED`}`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(err => { console.error(err); process.exit(1); });
