// scripts/verify-qc-lot-changeover.js
//
// Gate 3 receipt for the VeritaQC lot-changeover / continuous Levey-Jennings
// feature. Exercises the two pieces of branching logic that the feature adds:
//
//   1. Per-own-lot SDI. On the continuous cross-lot chart, each point is plotted
//      as (value - ITS lot's mean) / ITS lot's SD. A lot change must re-center
//      the series on the new lot's mean rather than smear one baseline across
//      two materials. This mirrors the server computation in the GET /qc/line
//      endpoint (server/routes.ts).
//
//   2. Segment + changeover-marker derivation. The client groups a chronological
//      point series into contiguous same-lot runs (segments); a vertical shift
//      marker sits at every boundary between consecutive segments. This mirrors
//      the ContinuousLeveyJenningsChart segment loop (client VeritaQCAppPage).
//
// Run: node scripts/verify-qc-lot-changeover.js   (exits non-zero on any FAIL)

let failures = 0;
function assert(name, cond, detail) {
  if (cond) {
    console.log(`PASS  ${name}`);
  } else {
    failures++;
    console.log(`FAIL  ${name}${detail ? "  -- " + detail : ""}`);
  }
}
function approx(a, b, eps = 1e-9) { return Math.abs(a - b) <= eps; }

// ── Fixture: one control line (PSA low), two lots across a changeover ────────
// Lot A: mean 4.00, SD 0.30 (retired). Lot B: mean 4.60, SD 0.40 (current).
// The raw values jump ~0.6 at the changeover (new material), but in SDI space
// each lot re-centers, so both lots' in-control points sit near 0 SDI.
const lotA = { id: 15, lot_number: "303071", mfr_mean: 4.0, mfr_sd: 0.3 };
const lotB = { id: 23, lot_number: "303072", mfr_mean: 4.6, mfr_sd: 0.4 };

const rawPoints = [
  { control_lot: lotA, value: 4.00 }, // 0.00 SDI
  { control_lot: lotA, value: 4.15 }, // +0.50 SDI
  { control_lot: lotA, value: 3.91 }, // -0.30 SDI
  // ---- changeover ----
  { control_lot: lotB, value: 4.60 }, // 0.00 SDI (re-centered on lot B mean)
  { control_lot: lotB, value: 4.80 }, // +0.50 SDI
  { control_lot: lotB, value: 5.20 }, // +1.50 SDI
];

// Server-side SDI computation (matches routes.ts GET /qc/line `sdi`).
const points = rawPoints.map((p, i) => ({
  id: 100 + i,
  control_lot_id: p.control_lot.id,
  lot_number: p.control_lot.lot_number,
  result_value: p.value,
  mfr_mean: p.control_lot.mfr_mean,
  mfr_sd: p.control_lot.mfr_sd,
  sdi: p.control_lot.mfr_sd > 0 ? (p.value - p.control_lot.mfr_mean) / p.control_lot.mfr_sd : 0,
}));

// ── 1. Per-own-lot SDI ──────────────────────────────────────────────────────
const expectedSdi = [0.0, 0.5, -0.3, 0.0, 0.5, 1.5];
points.forEach((pt, i) => {
  assert(`sdi[${i}] against own lot mean/SD = ${expectedSdi[i]}`, approx(pt.sdi, expectedSdi[i]),
    `got ${pt.sdi.toFixed(4)}`);
});

// The first point of lot B is 4.60 raw. Measured against the WRONG (lot A) mean
// it would read +2.0 SDI (a false 1-2s/near-2s flag); against its own lot mean
// it correctly reads 0.0. This is the whole point of per-own-lot SDI.
const wrongSdi = (4.6 - lotA.mfr_mean) / lotA.mfr_sd; // = +2.0
assert("re-centering: lot B first point is 0.0 SDI on its own lot, not +2.0 on lot A",
  approx(points[3].sdi, 0.0) && approx(wrongSdi, 2.0),
  `own=${points[3].sdi} wrong=${wrongSdi}`);

// ── 2. Segment + changeover-marker derivation ───────────────────────────────
// Contiguous runs of the same control_lot_id -> segments (matches the client).
function deriveSegments(pts) {
  const segments = [];
  pts.forEach((p, i) => {
    const last = segments[segments.length - 1];
    if (last && last.lotId === p.control_lot_id) last.end = i;
    else segments.push({ lotId: p.control_lot_id, lotNumber: p.lot_number, start: i, end: i });
  });
  return segments;
}

const segs = deriveSegments(points);
assert("two lots -> two segments", segs.length === 2, `got ${segs.length}`);
assert("segment 0 is lot A spanning indices 0..2",
  segs[0].lotId === lotA.id && segs[0].start === 0 && segs[0].end === 2);
assert("segment 1 is lot B spanning indices 3..5",
  segs[1].lotId === lotB.id && segs[1].start === 3 && segs[1].end === 5);
// One boundary marker for two sequential lots (markers = segments - 1).
assert("changeover markers = segments - 1 = 1", segs.length - 1 === 1);
assert("marker sits between the last lot-A point and first lot-B point",
  segs[1].start - 1 === 2 && segs[1].start === 3);

// Single-lot line -> one segment, zero markers (continuous view degrades safely).
const singleLot = deriveSegments(points.slice(0, 3));
assert("single-lot line -> one segment, zero markers",
  singleLot.length === 1 && singleLot.length - 1 === 0);

// Three lots interleaved back-to-back -> three segments, two markers.
const threeLotPts = [
  { control_lot_id: 1, lot_number: "A" }, { control_lot_id: 1, lot_number: "A" },
  { control_lot_id: 2, lot_number: "B" },
  { control_lot_id: 3, lot_number: "C" }, { control_lot_id: 3, lot_number: "C" },
];
const threeSegs = deriveSegments(threeLotPts);
assert("three lots -> three segments, two markers",
  threeSegs.length === 3 && threeSegs.length - 1 === 2, `got ${threeSegs.length} segments`);

// ── Summary ─────────────────────────────────────────────────────────────────
console.log(failures === 0
  ? "\nALL PASS -- per-own-lot SDI + segment/marker derivation verified."
  : `\n${failures} FAILURE(S).`);
process.exit(failures === 0 ? 0 : 1);
