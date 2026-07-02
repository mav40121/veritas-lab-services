// IndexNow auto-submission.
// Pings participating search engines (Bing, Yandex, Seznam, Naver, Yep) through
// the shared api.indexnow.org endpoint the moment site content changes, so they
// re-crawl in hours instead of waiting on their own schedule.
//
// The key is PUBLIC by design: it is hosted at https://<host>/<key>.txt and the
// engines fetch that file to verify ownership. It is NOT a secret, so it lives
// here as a plain constant (not an env secret). The hosted file
// client/public/<key>.txt must contain exactly INDEXNOW_KEY and nothing else, and
// INDEXNOW_KEY_LOCATION must resolve to it exactly.
//
// Trigger: scripts/ping-indexnow.mts, run with the changed URLs at deploy time.
// Site content is static (compiled into the client), so submissions are driven by
// deploys, not by a runtime publish event. Do not ping the whole sitemap on every
// deploy (wasteful and rate-limit-prone); submit only the URLs that changed.

export const INDEXNOW_HOST = "www.veritaslabservices.com";
export const INDEXNOW_KEY = "30613f3e4e04b7e5d8be0038c9d1c51b";
export const INDEXNOW_KEY_LOCATION = `https://${INDEXNOW_HOST}/${INDEXNOW_KEY}.txt`;
export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";

export interface IndexNowResult {
  status: number;
  ok: boolean;
  body: string;
  submitted: string[];
}

/**
 * Submit a batch of changed URLs to IndexNow. Every URL must be on INDEXNOW_HOST.
 * IndexNow returns 200 (OK) or 202 (Accepted, key validation pending); both are
 * treated as success. Throws on a bad URL set or a network failure.
 */
export async function submitToIndexNow(urls: string[]): Promise<IndexNowResult> {
  const clean = urls.map((u) => u.trim()).filter(Boolean);
  if (!clean.length) {
    throw new Error("IndexNow: no URLs to submit");
  }
  const offHost = clean.filter((u) => {
    try {
      return new URL(u).host !== INDEXNOW_HOST;
    } catch {
      return true;
    }
  });
  if (offHost.length) {
    throw new Error(`IndexNow: refusing to submit URLs not on ${INDEXNOW_HOST}: ${offHost.join(", ")}`);
  }
  const payload = {
    host: INDEXNOW_HOST,
    key: INDEXNOW_KEY,
    keyLocation: INDEXNOW_KEY_LOCATION,
    urlList: clean,
  };
  const res = await fetch(INDEXNOW_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  });
  const body = await res.text().catch(() => "");
  return { status: res.status, ok: res.status === 200 || res.status === 202, body, submitted: clean };
}
