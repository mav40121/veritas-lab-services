// shared/labTimeZone.ts
//
// Per-lab time zone (Michael 2026-10-26, option 1): every lab used America/Phoenix (left from the SCAHC engagement),
// so an Eastern lab's "today" rolled over at 3 AM. A lab's zone is, in order:
//   1. labs.time_zone, when the lab (or Veritas) set it;
//   2. its CLIA state, when that state lies in one zone;
//   3. for a state split across zones, the state's main zone, flagged so Account Settings asks the lab to confirm;
//   4. America/New_York when the CLIA number gives no state (missing, placeholder, or an unknown code), also flagged.
// The first two digits of a CLIA number are the CMS (SSA) state code; the table below is CMS's PRVDR_STATE_CD list
// (bluebutton.cms.gov/resources/variables/prvdr_state_cd), including the overflow codes 67 to 74 and 80.
// No em dashes in any user-facing string (CLAUDE.md section 3).

export const DEFAULT_LAB_TIME_ZONE = "America/New_York";

export const TIME_ZONE_CHOICES: { value: string; label: string }[] = [
  { value: "America/New_York", label: "Eastern" },
  { value: "America/Chicago", label: "Central" },
  { value: "America/Denver", label: "Mountain" },
  { value: "America/Phoenix", label: "Arizona (Mountain, no daylight saving)" },
  { value: "America/Los_Angeles", label: "Pacific" },
  { value: "America/Anchorage", label: "Alaska" },
  { value: "Pacific/Honolulu", label: "Hawaii" },
  { value: "America/Puerto_Rico", label: "Atlantic (Puerto Rico, U.S. Virgin Islands)" },
  { value: "Pacific/Guam", label: "Chamorro (Guam, Northern Mariana Islands)" },
  { value: "Pacific/Pago_Pago", label: "Samoa (American Samoa)" },
];
export function timeZoneLabel(tz: string | null | undefined): string {
  return TIME_ZONE_CHOICES.find((c) => c.value === tz)?.label || String(tz || "");
}

// CMS state code -> USPS state.
export const CLIA_STATE_BY_CODE: Record<string, string> = {
  "01": "AL", "02": "AK", "03": "AZ", "04": "AR", "05": "CA", "06": "CO", "07": "CT", "08": "DE", "09": "DC", "10": "FL",
  "11": "GA", "12": "HI", "13": "ID", "14": "IL", "15": "IN", "16": "IA", "17": "KS", "18": "KY", "19": "LA", "20": "ME",
  "21": "MD", "22": "MA", "23": "MI", "24": "MN", "25": "MS", "26": "MO", "27": "MT", "28": "NE", "29": "NV", "30": "NH",
  "31": "NJ", "32": "NM", "33": "NY", "34": "NC", "35": "ND", "36": "OH", "37": "OK", "38": "OR", "39": "PA", "40": "PR",
  "41": "RI", "42": "SC", "43": "SD", "44": "TN", "45": "TX", "46": "UT", "47": "VT", "48": "VI", "49": "VA", "50": "WA",
  "51": "WV", "52": "WI", "53": "WY", "55": "CA", "64": "AS", "65": "GU", "66": "MP", "67": "TX", "68": "FL", "69": "FL",
  "70": "KS", "71": "LA", "72": "OH", "73": "PA", "74": "TX", "80": "MD", "97": "MP", "98": "GU",
};

// State -> zones. One entry: the whole state is in that zone. More than one: the state is split; the first is where
// most of it is, used until the lab confirms in Account Settings.
const ET = "America/New_York", CT = "America/Chicago", MT = "America/Denver", PT = "America/Los_Angeles";
export const ZONES_BY_STATE: Record<string, string[]> = {
  AL: [CT], AK: ["America/Anchorage"], AZ: ["America/Phoenix"], AR: [CT], CA: [PT], CO: [MT], CT: [ET], DE: [ET],
  DC: [ET], FL: [ET, CT], GA: [ET], HI: ["Pacific/Honolulu"], ID: [MT, PT], IL: [CT], IN: [ET, CT], IA: [CT],
  KS: [CT, MT], KY: [ET, CT], LA: [CT], ME: [ET], MD: [ET], MA: [ET], MI: [ET, CT], MN: [CT], MS: [CT], MO: [CT],
  MT: [MT], NE: [CT, MT], NV: [PT], NH: [ET], NJ: [ET], NM: [MT], NY: [ET], NC: [ET], ND: [CT, MT], OH: [ET],
  OK: [CT], OR: [PT, MT], PA: [ET], PR: ["America/Puerto_Rico"], RI: [ET], SC: [ET], SD: [CT, MT], TN: [CT, ET],
  TX: [CT, MT], UT: [MT], VT: [ET], VI: ["America/Puerto_Rico"], VA: [ET], WA: [PT], WV: [ET], WI: [CT], WY: [MT],
  AS: ["Pacific/Pago_Pago"], GU: ["Pacific/Guam"], MP: ["Pacific/Guam"],
};
// Arizona counts as one zone (no daylight saving, SCAHC included); a Navajo Nation lab, which keeps daylight saving,
// sets Mountain in Account Settings.

export interface LabTimeZoneInfo {
  timeZone: string;
  source: "set" | "clia" | "clia_main_zone" | "default";
  state: string | null;
  // True when the lab should confirm its zone in Account Settings (a split state, or no CLIA state).
  needsConfirm: boolean;
  // The zones offered first (the state's zones, or every zone).
  choices: string[];
}

export function isValidLabTimeZone(tz: unknown): tz is string {
  return typeof tz === "string" && TIME_ZONE_CHOICES.some((c) => c.value === tz);
}

export function cliaState(clia: string | null | undefined): string | null {
  const m = String(clia ?? "").trim().toUpperCase().match(/^(\d{2})D\d{7}$/);
  return m ? CLIA_STATE_BY_CODE[m[1]] ?? null : null;
}

export function labTimeZoneInfo(lab: { time_zone?: string | null; clia_number?: string | null } | null | undefined): LabTimeZoneInfo {
  const state = cliaState(lab?.clia_number);
  const zones = state ? ZONES_BY_STATE[state] ?? [] : [];
  const choices = zones.length ? zones : TIME_ZONE_CHOICES.map((c) => c.value);
  if (isValidLabTimeZone(lab?.time_zone)) return { timeZone: lab!.time_zone!, source: "set", state, needsConfirm: false, choices };
  if (zones.length === 1) return { timeZone: zones[0], source: "clia", state, needsConfirm: false, choices };
  if (zones.length > 1) return { timeZone: zones[0], source: "clia_main_zone", state, needsConfirm: true, choices };
  return { timeZone: DEFAULT_LAB_TIME_ZONE, source: "default", state, needsConfirm: true, choices };
}
