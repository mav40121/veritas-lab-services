import { lazy as reactLazy, type ComponentType, type LazyExoticComponent } from "react";

// Load a dynamic import() with a few backoff retries. A hashed chunk can be
// briefly unavailable during a deploy cutover (the fresh index.html already
// references the new hash while the chunk file is still propagating). Retrying
// rides that out without a jarring full-page reload.
// Exported for scripts/verify-lazy-chunk-retry.ts.
export async function loadWithRetry<T>(
  factory: () => Promise<T>,
  retries = 2,
  delayMs = 500,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await factory();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

// Self-heal stale lazy chunks after a deploy. Retries the import first (cutover
// propagation), then forces ONE full reload to fetch the fresh index.html + chunk
// list if the chunk from a previous build is truly gone. sessionStorage guards
// against an infinite reload loop if a chunk is genuinely broken; the flag clears
// on any successful import so a later deploy self-heals again. This is why lazy
// routes could show "Something went wrong" across a run of rapid deploys.
export function lazyWithReload<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return reactLazy(async () => {
    try {
      const mod = await loadWithRetry(factory);
      try { sessionStorage.removeItem("chunk-reload-once"); } catch { /* ignore */ }
      return mod;
    } catch (err) {
      let alreadyReloaded = true;
      try {
        alreadyReloaded = sessionStorage.getItem("chunk-reload-once") === "1";
        if (!alreadyReloaded) sessionStorage.setItem("chunk-reload-once", "1");
      } catch { /* sessionStorage unavailable: fall through and rethrow */ }
      if (!alreadyReloaded) {
        window.location.reload();
        return { default: (() => null) as unknown as T };
      }
      throw err;
    }
  });
}
