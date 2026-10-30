// shared/competencyEl5Samples.ts
//
// Element 5 (blind or PT sample performance) can record more than one sample for one test system: a PT event with
// several challenges, or a blind sample plus a PT sample (Michael Q71 = 1, RFGH). The first sample stays in the
// el5_sample_type / el5_sample_id / el5_acceptable columns, so every reader that predates the list (element status,
// the Staff Portal, sign-off checks) keeps working unchanged. el5_samples_json holds the whole list only when there is
// more than one sample, and sample 1 is always read from the columns, so an edit made through the columns (the Staff
// Portal) is never shadowed by a stale copy in the list.

export interface El5Sample { sampleType: string; sampleId: string; acceptable: boolean | null }

// A guard against a runaway request, far above any real PT event.
export const EL5_MAX_SAMPLES = 25;

const blankSample = (s: El5Sample) => !s.sampleType && !s.sampleId && s.acceptable == null;

function oneSample(raw: any): El5Sample {
  const a = raw?.acceptable;
  return {
    sampleType: String(raw?.sampleType ?? "").trim(),
    sampleId: String(raw?.sampleId ?? "").trim(),
    acceptable: a == null || a === "" ? null : a === true || a === 1 || a === "1",
  };
}

/** Samples as entered: trimmed, fully blank rows dropped, order kept. */
export function cleanEl5Samples(input: unknown): El5Sample[] {
  const list = Array.isArray(input) ? input : [];
  return list.slice(0, EL5_MAX_SAMPLES).map(oneSample).filter((s) => !blankSample(s));
}

/** The values to store for an element 5 row: the first sample's columns, plus the list when there is more than one. */
export function el5Columns(samples: El5Sample[]): { type: string | null; id: string | null; acceptable: number | null; json: string | null } {
  const first = samples[0];
  return {
    type: first?.sampleType || null,
    id: first?.sampleId || null,
    acceptable: first?.acceptable == null ? null : first.acceptable ? 1 : 0,
    json: samples.length > 1 ? JSON.stringify(samples) : null,
  };
}

/** Every sample on a stored item row. Sample 1 comes from the columns; any further samples from el5_samples_json. */
export function el5SamplesFromRow(row: any): El5Sample[] {
  const first: El5Sample = {
    sampleType: String(row?.el5_sample_type ?? "").trim(),
    sampleId: String(row?.el5_sample_id ?? "").trim(),
    acceptable: row?.el5_acceptable == null ? null : !!row.el5_acceptable,
  };
  let more: El5Sample[] = [];
  if (row?.el5_samples_json) {
    try {
      const parsed = JSON.parse(row.el5_samples_json);
      more = cleanEl5Samples(Array.isArray(parsed) ? parsed.slice(1) : []);
    } catch { more = []; }
  }
  if (blankSample(first) && !more.length) return [];
  return [first, ...more];
}
