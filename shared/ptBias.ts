// shared/ptBias.ts
//
// A VeritaPT result against its peer group (B11, 2026-11-24), worked out on the server from the numbers entered.
//   difference          result - peer mean
//   percent difference  difference / |peer mean| x 100 (the sign says above or below; none when the mean is 0)
//   SDI                 difference / peer SD, two decimals, as VeritaPT has always worked it out (none without an SD above 0)
// Without a peer mean there is no peer data and nothing is worked out: a missing number is never zero. The program's own
// acceptance range, when the event carries one, is read on the same scale. No allowable-error limit is used here: the range is
// the program's, and what a difference means is the laboratory's to say.
//
// Two flags, each "flag for review" with its rule on the screen. Neither says a method is biased or unacceptable.
//   Same event    every result of one event with peer data is on the same side of its peer mean, three results or more. Asked
//                 of the event's results of one analyte, and of all the event's results.
//   Three events  an analyte's results are on the same side of the peer mean in three events in a row, among its events with
//                 peer data. An event whose own results fall on both sides, or on the mean, breaks the run.

export interface PtBiasInput {
  your_result: number | null;
  peer_mean: number | null;
  peer_sd: number | null;
  acceptable_low: number | null;
  acceptable_high: number | null;
}

export interface PtBias {
  difference: number | null;
  percent: number | null;
  sdi: number | null;
  /** The program's acceptance range as a percent difference and as an SDI. */
  range_percent: [number | null, number | null];
  range_sdi: [number | null, number | null];
  side: "above" | "below" | "on" | null;
}

const round = (v: number, places: number): number => { const f = 10 ** places; const r = Math.round((v + Number.EPSILON * Math.sign(v)) * f) / f; return r === 0 ? 0 : r; };
const NONE: PtBias = { difference: null, percent: null, sdi: null, range_percent: [null, null], range_sdi: [null, null], side: null };

export function ptBias(r: PtBiasInput): PtBias {
  const { your_result: x, peer_mean: mean, peer_sd: sd } = r;
  if (x == null || mean == null) return NONE;
  const percentOf = (v: number | null) => (v == null || mean === 0 ? null : round(((v - mean) / Math.abs(mean)) * 100, 2));
  const sdiOf = (v: number | null) => (v == null || sd == null || !(sd > 0) ? null : round((v - mean) / sd, 2));
  // Six decimals on the difference: it clears binary noise (4.1 - 4.0) and keeps what was entered.
  const difference = round(x - mean, 6);
  return {
    difference, percent: percentOf(x), sdi: sdiOf(x),
    range_percent: [percentOf(r.acceptable_low), percentOf(r.acceptable_high)], range_sdi: [sdiOf(r.acceptable_low), sdiOf(r.acceptable_high)],
    side: difference > 0 ? "above" : difference < 0 ? "below" : "on",
  };
}

export const PT_FLAG_RULES = {
  same_event: "Flag for review when every result of one event that has peer data is on the same side of its peer mean, three results or more.",
  three_events: "Flag for review when an analyte's results are on the same side of the peer mean in three events in a row, among its events with peer data.",
} as const;

export type PtSide = "above" | "below";
type Sided = { side: PtBias["side"] };

/** The one side a set of results is on, or null: on both, on the mean, or with no peer data. */
export function ptOneSide(list: Sided[]): PtSide | null {
  const withPeer = list.filter((r) => r.side != null);
  if (!withPeer.length) return null;
  return withPeer.every((r) => r.side === "above") ? "above" : withPeer.every((r) => r.side === "below") ? "below" : null;
}

/** Same event: three or more results with peer data, all on one side. */
export function ptSameEventFlag(list: Sided[]): { side: PtSide; count: number } | null {
  const withPeer = list.filter((r) => r.side != null), side = ptOneSide(list);
  return side && withPeer.length >= 3 ? { side, count: withPeer.length } : null;
}

/** Three events: the runs of three or more in an analyte's events, oldest first; an event with no peer data is not in the run. */
export function ptEventRuns<T extends { results: Sided[] }>(events: T[]): Array<{ side: PtSide; events: T[] }> {
  const runs: Array<{ side: PtSide; events: T[] }> = [];
  let run: { side: PtSide; events: T[] } | null = null;
  const close = () => { if (run && run.events.length >= 3) runs.push(run); run = null; };
  for (const e of events.filter((x) => x.results.some((r) => r.side != null))) {
    const side = ptOneSide(e.results);
    if (run && side === run.side) { run.events.push(e); continue; }
    close();
    if (side) run = { side, events: [e] };
  }
  close();
  return runs;
}
