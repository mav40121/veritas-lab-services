// tests/integration/lab-time-zone.test.ts
//
// STANDING integration test for the per-lab time zone (Michael 2026-10-26, option 1):
//   1. Account Settings reports the zone in effect and where it came from: an Arizona CLIA lab is Arizona time with no
//      prompt; a lab with no CLIA state is Eastern and asked to confirm; a Michigan lab (split state) is Eastern and
//      asked to confirm.
//   2. A lab sets its zone (audited), goes back to automatic with "auto", and an unlisted zone is refused.
//   3. A lab-scoped request stamps the LAB's calendar day: a finding signed off in a Guam lab and one in an American
//      Samoa lab (21 hours apart) each get their own lab's today as the completion date.
//   4. The admin update-lab route sets the zone.
//
// Boots the REAL routes against a throwaway SQLite DB (made-up rows only). Run: npm run test:lab-time-zone

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";
import { labLocalDate } from "../../server/dateLocal";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const sqlite = (db as any).$client;
  const call = async (method: string, p: string, body?: unknown, token?: string, labId?: number) => {
    const r = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(labId ? { "X-Active-Lab-Id": String(labId) } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json: any = {}; try { json = await r.json(); } catch {}
    return { status: r.status, body: json };
  };
  const PW = ["Tz", "ne", "7x!"].join("-");
  const mkLab = async (tag: string, clia: string | null) => {
    const email = `it-tz-${tag}-${Date.now()}@example.com`;
    const reg = await call("POST", "/api/auth/register", { email, password: PW, name: `IT TZ ${tag}`, hipaa_acknowledged: true });
    const labId = Number((await call("POST", "/api/admin/provision-demo-lab", { secret: process.env.ADMIN_SECRET, ownerEmail: email, labName: `IT TZ Lab ${tag}`, plan: "hospital" })).body?.labId);
    if (clia) sqlite.prepare("UPDATE labs SET clia_number = ? WHERE id = ?").run(clia, labId);
    sqlite.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(Number(reg.body?.user?.id));
    const token = (await call("POST", "/api/auth/login", { email, password: PW })).body?.token as string;
    return { labId, token };
  };

  try {
    const az = await mkLab("az", "03D0531813");
    const none = await mkLab("none", null);
    const mi = await mkLab("mi", "23D2310670");
    check("0. labs made", az.labId > 0 && none.labId > 0 && mi.labId > 0);

    // 1. What Account Settings reports
    const s = async (l: any) => (await call("GET", "/api/account/settings", undefined, l.token, l.labId)).body;
    const sAz = await s(az), sNone = await s(none), sMi = await s(mi);
    check("1a. Arizona CLIA: Arizona time, from the CLIA state, no prompt", sAz.time_zone === "America/Phoenix" && sAz.time_zone_source === "clia" && sAz.time_zone_state === "AZ" && sAz.time_zone_needs_confirm === false, JSON.stringify({ tz: sAz.time_zone, src: sAz.time_zone_source }));
    check("1b. its lab_today is the Arizona calendar day", sAz.lab_today === labLocalDate(new Date().toISOString(), false, "America/Phoenix"), String(sAz.lab_today));
    check("1c. no CLIA state: Eastern, asked to confirm", sNone.time_zone === "America/New_York" && sNone.time_zone_source === "default" && sNone.time_zone_needs_confirm === true);
    check("1d. Michigan (split state): Eastern main zone, asked to confirm, Central offered", sMi.time_zone === "America/New_York" && sMi.time_zone_source === "clia_main_zone" && sMi.time_zone_needs_confirm === true && sMi.time_zone_choices.some((c: any) => c.value === "America/Chicago" && c.suggested));

    // 2. Setting it
    // The page always sends the whole form, CLIA number included (a PUT without it clears it).
    const put = async (l: any, body: any) => call("PUT", "/api/account/settings", { clia_lab_name: "IT TZ Lab", clia_number: "23D2310670", accreditation_choice: "CLIA", ...body }, l.token, l.labId);
    const setCt = await put(mi, { time_zone: "America/Chicago" });
    const sMi2 = await s(mi);
    check("2a. a lab sets Central; settings report it as set, no prompt", setCt.status === 200 && sMi2.time_zone === "America/Chicago" && sMi2.time_zone_source === "set" && sMi2.time_zone_needs_confirm === false);
    check("2b. the change is audited", !!sqlite.prepare("SELECT 1 FROM lab_audit_log WHERE lab_id = ? AND field_name = 'time_zone' AND new_value = 'America/Chicago'").get(mi.labId));
    const keep = await put(mi, {});
    check("2c. a save without time_zone keeps it", keep.status === 200 && (sqlite.prepare("SELECT time_zone FROM labs WHERE id = ?").get(mi.labId) as any).time_zone === "America/Chicago");
    const back = await put(mi, { time_zone: "auto" });
    check("2d. auto goes back to the CLIA state", back.status === 200 && (sqlite.prepare("SELECT time_zone FROM labs WHERE id = ?").get(mi.labId) as any).time_zone === null && (await s(mi)).time_zone_source === "clia_main_zone");
    const bad = await put(mi, { time_zone: "Mars/Olympus" });
    check("2e. an unlisted zone is refused", bad.status === 400);

    // 3. Lab-scoped stamps use the lab's day (Guam is UTC+10, American Samoa UTC-11: different days 21 hours of 24).
    sqlite.prepare("UPDATE labs SET time_zone = 'Pacific/Guam' WHERE id = ?").run(az.labId);
    sqlite.prepare("UPDATE labs SET time_zone = 'Pacific/Pago_Pago' WHERE id = ?").run(none.labId);
    const signOff = async (l: any) => {
      const f = await call("POST", `/api/labs/${l.labId}/findings`, { accreditor: "CMS", anchor_date: "2026-10-20", description: "TZ check" }, l.token, l.labId);
      await call("POST", `/api/labs/${l.labId}/findings/${f.body?.id}/signoff`, {}, l.token, l.labId);
      return (sqlite.prepare("SELECT completion_date FROM findings WHERE id = ?").get(Number(f.body?.id)) as any)?.completion_date;
    };
    const guamDay = await signOff(az), samoaDay = await signOff(none);
    const now = new Date().toISOString();
    const wantGuam = labLocalDate(now, false, "Pacific/Guam"), wantSamoa = labLocalDate(now, false, "Pacific/Pago_Pago");
    check("3a. the Guam lab's sign-off is stamped with Guam's day", guamDay === wantGuam, `${guamDay} vs ${wantGuam}`);
    check("3b. the American Samoa lab's sign-off is stamped with Samoa's day", samoaDay === wantSamoa, `${samoaDay} vs ${wantSamoa}`);
    console.log(`      (the two days ${guamDay === samoaDay ? "happen to match at this hour" : "differ, so the check distinguishes the labs"})`);

    // 4. Admin
    const adm = await call("POST", "/api/admin/update-lab", { secret: process.env.ADMIN_SECRET, labId: mi.labId, timeZone: "America/Denver" });
    const admBad = await call("POST", "/api/admin/update-lab", { secret: process.env.ADMIN_SECRET, labId: mi.labId, timeZone: "Nowhere/Here" });
    check("4a. admin update-lab sets the zone and refuses an unlisted one", adm.status === 200 && adm.body?.lab?.time_zone === "America/Denver" && admBad.status === 400, JSON.stringify(adm.body?.lab ?? adm.body).slice(0, 160));
  } finally {
    server.close();
  }
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
