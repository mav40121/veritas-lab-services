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

import { useEffect, useRef, useState } from "react";

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

  const scannerDivId = "inventory-count-scanner";
  const scannerRef = useRef<any>(null);

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

  // Teardown the scanner when the camera closes or the modal closes.
  useEffect(() => {
    if (cameraOpen) return;
    const r = scannerRef.current;
    if (r) {
      try { r.stop().catch(() => {}); } catch { /* noop */ }
      scannerRef.current = null;
    }
  }, [cameraOpen]);

  useEffect(() => {
    return () => {
      const r = scannerRef.current;
      if (r) {
        try { r.stop().catch(() => {}); } catch { /* noop */ }
      }
    };
  }, []);

  // Start the camera scanner when cameraOpen flips on.
  useEffect(() => {
    if (!open || !cameraOpen) return;
    let cancelled = false;
    setScannerError(null);
    (async () => {
      try {
        const mod = await import("html5-qrcode");
        if (cancelled) return;
        const Html5Qrcode = (mod as any).Html5Qrcode;
        const Html5QrcodeSupportedFormats = (mod as any).Html5QrcodeSupportedFormats;
        const scanner = new Html5Qrcode(scannerDivId, {
          formatsToSupport: [Html5QrcodeSupportedFormats.CODE_128],
          experimentalFeatures: { useBarCodeDetectorIfSupported: true },
        });
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          { fps: 25, qrbox: { width: 280, height: 140 }, videoConstraints: { facingMode: { ideal: "environment" } } },
          (decodedText: string) => {
            // First successful read wins; stop the camera and trigger lookup
            try { scanner.stop().catch(() => {}); } catch { /* noop */ }
            scannerRef.current = null;
            setCameraOpen(false);
            triggerLookup(decodedText.trim());
          },
          () => { /* scan errors per frame — ignore */ }
        );
      } catch (err: any) {
        if (!cancelled) setScannerError(err?.message || "Camera unavailable");
      }
    })();
    return () => { cancelled = true; };
  }, [cameraOpen, open]);

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
    <div className="fixed inset-0 z-50 bg-slate-900/80 flex items-center justify-center p-4 overflow-auto" data-testid="count-workflow-modal">
      <div className="w-full max-w-md bg-white rounded-lg shadow-lg border border-slate-200 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-base font-semibold text-slate-900">
            {mode === "scan" && "Scan to count"}
            {mode === "count" && "Update count"}
            {mode === "saved" && "Saved"}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-slate-500 hover:underline"
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
                <div id={scannerDivId} className="w-full aspect-video bg-black rounded-md overflow-hidden" data-testid="count-workflow-scanner" />
                {scannerError && (
                  <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-2">{scannerError}</div>
                )}
                <button
                  type="button"
                  onClick={() => setCameraOpen(false)}
                  className="w-full h-10 border border-slate-300 rounded-md text-sm font-medium hover:bg-slate-100"
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
                  className="w-full h-16 bg-teal-700 text-white text-base font-semibold rounded-md"
                  data-testid="count-workflow-open-scanner"
                >
                  Open scanner
                </button>
                <div className="text-xs text-slate-500 text-center">or type a barcode</div>
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
                    className="flex-1 h-10 px-3 border border-slate-300 rounded-md text-base font-mono"
                    data-testid="count-workflow-manual-input"
                  />
                  <button
                    type="submit"
                    disabled={!manualBarcode.trim()}
                    className="h-10 px-3 bg-slate-900 text-white rounded-md text-sm font-medium disabled:opacity-50"
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

            <label className="block text-xs font-medium text-slate-700">
              New count ({countUnit}s)
            </label>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={newCount}
              onChange={(e) => setNewCount(e.target.value)}
              className="w-full h-12 px-3 border border-slate-300 rounded-md text-lg font-mono text-center"
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

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={reset}
                className="h-11 px-4 border border-slate-300 rounded-md text-sm font-medium hover:bg-slate-100"
                data-testid="count-workflow-back"
              >
                Scan again
              </button>
              <button
                type="button"
                onClick={submitAdjust}
                disabled={saving || !!signerWarning}
                className="flex-1 h-11 bg-teal-700 text-white rounded-md text-base font-semibold disabled:opacity-50"
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
            <div className="border border-emerald-200 bg-emerald-50 rounded-md p-3">
              <div className="text-sm font-semibold text-emerald-900">{item.item_name}</div>
              <div className="text-xs text-emerald-800 mt-1">
                Saved.{" "}
                {savedDelta != null && savedDelta !== 0 && (
                  <>Delta {savedDelta >= 0 ? "+" : ""}{savedDelta} {usageUnit}s.</>
                )}
                {" "}On hand: {item.count_on_hand ?? item.quantity_on_hand} {countUnit}{(item.count_on_hand ?? item.quantity_on_hand) === 1 ? "" : "s"}
                {hasPack && <> ({item.quantity_on_hand} {usageUnit}s)</>}.
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="h-11 px-4 border border-slate-300 rounded-md text-sm font-medium hover:bg-slate-100"
                data-testid="count-workflow-done"
              >
                Done
              </button>
              <button
                type="button"
                onClick={reset}
                className="flex-1 h-11 bg-teal-700 text-white rounded-md text-base font-semibold"
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
