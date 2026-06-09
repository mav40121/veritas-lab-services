// client/src/components/InventoryCountWorkflow.tsx
//
// Task #129 (2026-06-09): scan-first count workflow used by BOTH the
// Wave K4 kiosk (/inventory) and the Wave K6 Staff Portal Adjust
// Inventory tile (/staff-access). Three states:
//
//   1. SCAN — big "Open scanner" button + manual barcode entry fallback
//   2. COUNT — item card + new-count input (count_unit-aware, live
//       preview of usage_unit total when pack_size > 1)
//   3. SAVED — "Saved +N {usage_unit}" confirmation, "Scan another"
//
// The component is self-contained: it ships its own html5-qrcode
// scanner so the existing BarcodeScannerModal (tied to /api/inventory/scan
// auto-decrement flow) doesn't have to grow new modes.
//
// Props: parents pass apiBase + authHeaders + the lookup and adjust
// paths for their JWT shape. The shared adjust payload is built from
// extraAdjustBody (initials for kiosk, employee_id for staff portal).

import { useEffect, useRef, useState, type ChangeEvent } from "react";

export interface CountItem {
  id: number;
  item_name: string;
  catalog_number: string | null;
  lot_number: string | null;
  department: string | null;
  storage_location: string | null;
  barcode_value: string | null;
  expiration_date: string | null;
  quantity_on_hand: number;
  unit: string | null;
  count_unit?: string;
  usage_unit?: string;
  units_per_count_unit?: number;
  count_on_hand?: number;
}

export interface InventoryCountWorkflowProps {
  open: boolean;
  onClose: () => void;
  // Authenticated fetch shape
  authHeaders: () => Record<string, string>;
  // Lookup path: GET ${lookupPath}?barcode=XYZ
  lookupPath: string;
  // Adjust path: POST ${adjustPath}/:id/adjust
  adjustItemBasePath: string;
  // Extra body fields to merge into the adjust POST (e.g. { initials: "PW" }
  // for kiosk; { employee_id: 17 } for staff portal). Validated at call site;
  // the workflow doesn't enforce shape.
  extraAdjustBody: Record<string, any>;
  // Disabled label shown when extraAdjustBody is missing required fields
  // (e.g. no initials typed yet). When non-null, the modal renders a
  // disabled save button with this message.
  signerWarning: string | null;
  // Called after a successful adjust so the parent can refresh its list.
  onAdjustComplete?: (updated: CountItem) => void;
}

type Mode = "scan" | "count" | "saved";

export default function InventoryCountWorkflow({
  open,
  onClose,
  authHeaders,
  lookupPath,
  adjustItemBasePath,
  extraAdjustBody,
  signerWarning,
  onAdjustComplete,
}: InventoryCountWorkflowProps) {
  const [mode, setMode] = useState<Mode>("scan");
  const [barcode, setBarcode] = useState("");
  const [manualBarcode, setManualBarcode] = useState("");
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [item, setItem] = useState<CountItem | null>(null);
  const [newCount, setNewCount] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedDelta, setSavedDelta] = useState<number | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [scannerEngine, setScannerEngine] = useState<"native" | "zxing" | null>(null);

  // 2026-06-09 PR #682: ripped out html5-qrcode (was failing on iPhone
  // Safari + Chrome desktop — a dedicated barcode app on the same phone
  // reads the same label fine, so the broken piece was the library, not
  // the camera or the label). New pipeline uses the native BarcodeDetector
  // API directly when present (Safari iOS 17+, Chrome/Edge desktop, Android
  // Chrome) and falls back to @zxing/browser for older browsers. Same
  // path the working scanner apps use under the hood (Apple Vision /
  // ZXing).
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stopScannerRef = useRef<(() => void) | null>(null);

  // Reset modal state every time it opens.
  useEffect(() => {
    if (!open) return;
    setMode("scan");
    setBarcode("");
    setManualBarcode("");
    setLookupError(null);
    setItem(null);
    setNewCount("");
    setSaveError(null);
    setSavedDelta(null);
    setCameraOpen(false);
  }, [open]);

  // Centralized scanner teardown. Stops the per-frame loop / zxing
  // controls, then stops every track on the MediaStream and clears the
  // <video>.srcObject. Idempotent — safe to call from cleanup, the close
  // button, and the success path.
  function teardownScanner() {
    if (stopScannerRef.current) {
      try { stopScannerRef.current(); } catch { /* noop */ }
      stopScannerRef.current = null;
    }
    if (streamRef.current) {
      try { streamRef.current.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
      streamRef.current = null;
    }
    if (videoRef.current) {
      try { videoRef.current.srcObject = null; } catch { /* noop */ }
    }
    setScannerEngine(null);
  }

  // Teardown the scanner when the camera closes or the modal closes.
  useEffect(() => {
    if (cameraOpen) return;
    teardownScanner();
  }, [cameraOpen]);

  // Final teardown on unmount.
  useEffect(() => {
    return () => { teardownScanner(); };
  }, []);

  // Start the camera scanner when cameraOpen flips on.
  // Pipeline (in order of preference):
  //   1. Native BarcodeDetector (Safari iOS 17+, Chrome/Edge desktop,
  //      Android Chrome). Backed by Apple Vision on iOS / Google ML Kit
  //      on Android — the same engines the working barcode apps use.
  //   2. @zxing/browser fallback for older browsers without
  //      window.BarcodeDetector.
  // Both run against the same <video> element fed by a single
  // getUserMedia call requesting 1920x1080 environment-facing.
  useEffect(() => {
    if (!open || !cameraOpen) return;
    let cancelled = false;
    setScannerError(null);

    (async () => {
      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) {
          stream.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
          return;
        }
        video.srcObject = stream;
        video.setAttribute("playsinline", "true");
        video.muted = true;
        try { await video.play(); } catch { /* iOS sometimes throws here; the stream is still live */ }

        const onHit = (text: string) => {
          if (cancelled) return;
          const trimmed = text.trim();
          if (!trimmed) return;
          cancelled = true;
          // Defer teardown so React state updates fire in order.
          setTimeout(() => {
            teardownScanner();
            setCameraOpen(false);
            triggerLookup(trimmed);
          }, 0);
        };

        // ---- Path 1: native BarcodeDetector
        const BDCtor: any = (window as any).BarcodeDetector;
        if (BDCtor) {
          try {
            let supported: string[] = [];
            if (typeof BDCtor.getSupportedFormats === "function") {
              supported = await BDCtor.getSupportedFormats();
            }
            if (supported.length === 0 || supported.includes("code_128")) {
              const detector = new BDCtor({ formats: ["code_128"] });
              setScannerEngine("native");
              let stopped = false;
              const useVfc = typeof (video as any).requestVideoFrameCallback === "function";
              let rafId = 0;
              const tick = async () => {
                if (stopped || cancelled) return;
                try {
                  const codes = await detector.detect(video);
                  if (codes && codes.length > 0) {
                    const t = codes[0].rawValue || codes[0].rawText || "";
                    if (t) {
                      stopped = true;
                      onHit(String(t));
                      return;
                    }
                  }
                } catch { /* per-frame errors are noisy and benign; swallow */ }
                if (useVfc) {
                  rafId = (video as any).requestVideoFrameCallback(tick);
                } else {
                  rafId = window.requestAnimationFrame(tick);
                }
              };
              if (useVfc) {
                rafId = (video as any).requestVideoFrameCallback(tick);
              } else {
                rafId = window.requestAnimationFrame(tick);
              }
              stopScannerRef.current = () => {
                stopped = true;
                try {
                  if (useVfc && typeof (video as any).cancelVideoFrameCallback === "function") {
                    (video as any).cancelVideoFrameCallback(rafId);
                  } else {
                    window.cancelAnimationFrame(rafId);
                  }
                } catch { /* noop */ }
              };
              return;
            }
          } catch { /* fall through to zxing */ }
        }

        // ---- Path 2: @zxing/browser
        const [browserMod, libMod] = await Promise.all([
          import("@zxing/browser"),
          import("@zxing/library"),
        ]);
        if (cancelled) return;
        const { BrowserMultiFormatReader } = browserMod as any;
        const { BarcodeFormat, DecodeHintType } = libMod as any;
        const hints = new Map<any, any>();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128]);
        hints.set(DecodeHintType.TRY_HARDER, true);
        const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 100 });
        setScannerEngine("zxing");
        const controls: any = await reader.decodeFromStream(
          stream,
          video,
          (result: any, _err: any, ctl: any) => {
            if (cancelled) return;
            if (result) {
              try { ctl?.stop?.(); } catch { /* noop */ }
              const text = typeof result.getText === "function" ? result.getText() : String(result);
              onHit(text);
            }
          }
        );
        stopScannerRef.current = () => {
          try { controls?.stop?.(); } catch { /* noop */ }
        };
      } catch (err: any) {
        if (!cancelled) {
          setScannerError(err?.message || "Camera unavailable");
          if (stream) {
            try { stream.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
            streamRef.current = null;
          }
        }
      }
    })();

    return () => {
      cancelled = true;
      teardownScanner();
    };
    // teardownScanner is stable (uses refs); intentionally omitted from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOpen, open]);

  // 2026-06-09: photo-capture fallback for iPhone Safari when the live
  // scanner can't decode (poor lighting, reflective label, old iOS).
  // Triggers iOS's native camera which has Live Text built in; once the
  // user takes a photo, iOS often highlights the barcode and offers to
  // copy it. Even without auto-detection, the photo path gives the user
  // a clear way out (look at the printed VLS- code, type it).
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  function openPhotoCapture() {
    photoInputRef.current?.click();
  }
  function handlePhotoSelected(_e: ChangeEvent<HTMLInputElement>) {
    // We intentionally do NOT decode the photo here (html5-qrcode's still-
    // image decoder is also flaky on iPhone). The photo capture is a
    // "look at your label" affordance — iOS's Live Text will highlight
    // the barcode for the user. After they read it they type into the
    // manual barcode input below.
    // The form field stays empty after selection so they can re-tap.
    if (photoInputRef.current) photoInputRef.current.value = "";
  }

  async function triggerLookup(value: string) {
    if (!value) return;
    setBarcode(value);
    setLookupError(null);
    setItem(null);
    try {
      const r = await fetch(`${lookupPath}?barcode=${encodeURIComponent(value)}`, {
        headers: authHeaders(),
      });
      if (r.status === 404) {
        setLookupError(`No item bound to barcode "${value}" in this lab.`);
        return;
      }
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setLookupError(j.error || `Lookup failed (${r.status})`);
        return;
      }
      const data = await r.json();
      const it: CountItem = data.item;
      setItem(it);
      const startingCount = it.count_on_hand ?? it.quantity_on_hand;
      setNewCount(String(startingCount));
      setMode("count");
    } catch (e: any) {
      setLookupError(e.message || "Network error");
    }
  }

  async function submitAdjust() {
    if (!item) return;
    const parsed = Number(newCount);
    if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
      setSaveError("Enter a whole number, 0 or greater.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const pack = item.units_per_count_unit ?? 1;
      const countUnit = item.count_unit || item.usage_unit || item.unit || "each";
      const usageUnit = item.usage_unit || item.unit || "each";
      const isCountUnit = pack > 1 && countUnit !== usageUnit;
      const payload: any = { ...extraAdjustBody };
      if (isCountUnit) payload.new_count = parsed;
      else payload.new_quantity = parsed;
      const r = await fetch(`${adjustItemBasePath}/${item.id}/adjust`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `Save failed (${r.status})`);
      const updated: CountItem = data.item;
      setItem(updated);
      setSavedDelta(data.adjustment?.delta ?? 0);
      setMode("saved");
      onAdjustComplete?.(updated);
    } catch (e: any) {
      setSaveError(e.message || "Network error");
    } finally {
      setSaving(false);
    }
  }

  function startManual() {
    const v = manualBarcode.trim();
    if (!v) return;
    triggerLookup(v);
  }

  function reset() {
    setMode("scan");
    setBarcode("");
    setManualBarcode("");
    setLookupError(null);
    setItem(null);
    setNewCount("");
    setSaveError(null);
    setSavedDelta(null);
    setCameraOpen(false);
  }

  if (!open) return null;

  const pack = item?.units_per_count_unit ?? 1;
  const countUnit = item?.count_unit || item?.usage_unit || item?.unit || "each";
  const usageUnit = item?.usage_unit || item?.unit || "each";
  const hasPack = pack > 1 && countUnit !== usageUnit;
  const previewQty = Number(newCount);
  const previewValid = Number.isFinite(previewQty) && previewQty >= 0 && Number.isInteger(previewQty);

  return (
    // Fullscreen on mobile (no sm: prefix on sizing classes), centered modal
    // on tablet/desktop. The desktop-zoomed VeritaStock page underneath
    // doesn't matter on mobile because the modal IS the screen.
    <div className="fixed inset-0 z-50 bg-slate-900/80 overflow-auto sm:flex sm:items-center sm:justify-center sm:p-4" data-testid="count-workflow-modal">
      <div className="w-full h-full min-h-screen bg-white p-5 space-y-4 flex flex-col sm:max-w-md sm:h-auto sm:min-h-0 sm:rounded-lg sm:shadow-lg sm:border sm:border-slate-200">
        <div className="flex items-center justify-between">
          <div className="text-lg sm:text-base font-semibold text-slate-900">
            {mode === "scan" && "Scan to count"}
            {mode === "count" && "Update count"}
            {mode === "saved" && "Saved"}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-11 sm:h-auto px-4 sm:px-0 text-base sm:text-xs font-medium sm:font-normal text-slate-700 sm:text-slate-500 border sm:border-0 border-slate-300 rounded-md sm:rounded-none hover:bg-slate-50 sm:hover:bg-transparent sm:hover:underline"
            data-testid="count-workflow-close"
          >
            Done
          </button>
        </div>

        {/* SCAN STATE */}
        {mode === "scan" && (
          <div className="space-y-4">
            {cameraOpen ? (
              <div className="space-y-3">
                <div className="relative w-full h-[55vh] sm:h-auto sm:aspect-video bg-black rounded-md overflow-hidden">
                  <video
                    ref={videoRef}
                    className="w-full h-full object-cover"
                    data-testid="count-workflow-scanner"
                    playsInline
                    muted
                    autoPlay
                  />
                  {/* Wide-short reticle for 1D Code 128 (purely visual; the
                      decoder scans the full frame). */}
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="border-2 border-teal-400/80 rounded-md" style={{ width: "92%", maxWidth: 600, height: 110 }} />
                  </div>
                  {scannerEngine && (
                    <div className="absolute top-2 right-2 text-[10px] uppercase tracking-wide bg-black/60 text-white px-2 py-0.5 rounded">
                      {scannerEngine === "native" ? "Native" : "ZXing"}
                    </div>
                  )}
                </div>
                {scannerError && (
                  <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-2">{scannerError}</div>
                )}
                <button
                  type="button"
                  onClick={() => setCameraOpen(false)}
                  className="w-full h-12 sm:h-10 border border-slate-300 rounded-md text-base sm:text-sm font-medium hover:bg-slate-100"
                  data-testid="count-workflow-cancel-scan"
                >
                  Cancel scan
                </button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setCameraOpen(true)}
                  className="w-full h-20 sm:h-16 bg-teal-700 text-white text-lg sm:text-base font-semibold rounded-md"
                  data-testid="count-workflow-open-scanner"
                >
                  Open scanner
                </button>
                {/* Photo-capture fallback: opens iOS native camera. Live Text
                    highlights the barcode for the user to read out. */}
                <button
                  type="button"
                  onClick={openPhotoCapture}
                  className="w-full h-14 sm:h-12 bg-white border border-slate-300 text-slate-700 text-base sm:text-sm font-medium rounded-md hover:bg-slate-50"
                  data-testid="count-workflow-photo-capture"
                >
                  Take a photo of the label
                </button>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handlePhotoSelected}
                  className="hidden"
                  aria-hidden="true"
                />
                <div className="text-sm sm:text-xs text-slate-500 text-center">or type a barcode</div>
                <form
                  onSubmit={(e) => { e.preventDefault(); startManual(); }}
                  className="flex items-center gap-2"
                >
                  <input
                    type="text"
                    inputMode="text"
                    autoCapitalize="characters"
                    value={manualBarcode}
                    onChange={(e) => setManualBarcode(e.target.value)}
                    placeholder="VLS-00008332"
                    className="flex-1 h-12 sm:h-10 px-3 border border-slate-300 rounded-md text-lg sm:text-base font-mono"
                    data-testid="count-workflow-manual-input"
                  />
                  <button
                    type="submit"
                    disabled={!manualBarcode.trim()}
                    className="h-12 sm:h-10 px-4 sm:px-3 bg-slate-900 text-white rounded-md text-base sm:text-sm font-medium disabled:opacity-50"
                    data-testid="count-workflow-manual-submit"
                  >
                    Lookup
                  </button>
                </form>
                {lookupError && (
                  <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-2" data-testid="count-workflow-lookup-error">
                    {lookupError}
                  </div>
                )}
                {signerWarning && (
                  <div className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded px-2 py-2">
                    {signerWarning}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* COUNT STATE */}
        {mode === "count" && item && (
          <div className="space-y-3" data-testid="count-workflow-count">
            <div className="border border-slate-200 rounded-md p-3 bg-slate-50">
              <div className="text-sm font-semibold text-slate-900">{item.item_name}</div>
              <div className="text-xs text-slate-600 mt-1">
                {item.catalog_number && <>Catalog {item.catalog_number}</>}
                {item.lot_number && <> &middot; Lot {item.lot_number}</>}
                {item.storage_location && <> &middot; {item.storage_location}</>}
              </div>
              <div className="text-xs text-slate-600 mt-1">
                Currently on hand: <span className="font-mono font-semibold">{item.count_on_hand ?? item.quantity_on_hand}</span>{" "}
                {countUnit}{(item.count_on_hand ?? item.quantity_on_hand) === 1 ? "" : "s"}
                {hasPack && <span className="ml-1">({item.quantity_on_hand} {usageUnit}s)</span>}
              </div>
            </div>

            <label className="block text-sm sm:text-xs font-medium text-slate-700">
              New count ({countUnit}s)
            </label>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={newCount}
              onChange={(e) => setNewCount(e.target.value)}
              className="w-full h-16 sm:h-12 px-3 border border-slate-300 rounded-md text-3xl sm:text-lg font-mono text-center"
              data-testid="count-workflow-new-count"
              autoFocus
            />
            {hasPack && previewValid && (
              <div className="text-xs text-slate-500 text-center" data-testid="count-workflow-preview">
                = {previewQty * pack} {usageUnit}s (pack of {pack})
              </div>
            )}

            {saveError && (
              <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-2">{saveError}</div>
            )}
            {signerWarning && (
              <div className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded px-2 py-2">
                {signerWarning}
              </div>
            )}

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={reset}
                className="h-14 sm:h-11 px-4 border border-slate-300 rounded-md text-base sm:text-sm font-medium hover:bg-slate-100"
                data-testid="count-workflow-back"
              >
                Scan again
              </button>
              <button
                type="button"
                onClick={submitAdjust}
                disabled={saving || !!signerWarning}
                className="flex-1 h-14 sm:h-11 bg-teal-700 text-white rounded-md text-lg sm:text-base font-semibold disabled:opacity-50"
                data-testid="count-workflow-save"
              >
                {saving ? "Saving..." : "Save count"}
              </button>
            </div>
          </div>
        )}

        {/* SAVED STATE */}
        {mode === "saved" && item && (
          <div className="space-y-3" data-testid="count-workflow-saved">
            <div className="border border-emerald-200 bg-emerald-50 rounded-md p-4 sm:p-3">
              <div className="text-base sm:text-sm font-semibold text-emerald-900">{item.item_name}</div>
              <div className="text-sm sm:text-xs text-emerald-800 mt-1">
                Saved.{" "}
                {savedDelta != null && savedDelta !== 0 && (
                  <>Delta {savedDelta >= 0 ? "+" : ""}{savedDelta} {usageUnit}s.</>
                )}
                {" "}On hand: {item.count_on_hand ?? item.quantity_on_hand} {countUnit}{(item.count_on_hand ?? item.quantity_on_hand) === 1 ? "" : "s"}
                {hasPack && <> ({item.quantity_on_hand} {usageUnit}s)</>}.
              </div>
            </div>
            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="h-14 sm:h-11 px-4 border border-slate-300 rounded-md text-base sm:text-sm font-medium hover:bg-slate-100"
                data-testid="count-workflow-done"
              >
                Done
              </button>
              <button
                type="button"
                onClick={reset}
                className="flex-1 h-14 sm:h-11 bg-teal-700 text-white rounded-md text-lg sm:text-base font-semibold"
                data-testid="count-workflow-scan-another"
              >
                Scan another
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
