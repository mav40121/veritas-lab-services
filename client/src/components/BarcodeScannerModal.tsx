// client/src/components/BarcodeScannerModal.tsx
//
// parking-lot #29 Phase 3B: VeritaStock camera scanner.
//
// Two modes:
//
//   mode="scan": full scan workflow. The action picker
//   (decrement / increment / lookup_only / correction) is at the
//   top; the camera viewport is below; each scan POSTs to
//   /api/inventory/scan and pushes a result card into a stack
//   below the viewport. Unknown barcode shows a "Bind to item?"
//   inline panel; picking an item PUTs barcode_value to
//   /api/inventory/:id and the user can re-scan to decrement.
//
//   mode="bind": no /api/inventory/scan call. First successful
//   decode fires onBindComplete(value) and closes the modal so
//   the parent form can write the barcode_value into its state.
//   Used by the "Scan to bind" mini-button on the Item Edit
//   dialog.
//
// Layout: full-screen on viewports below 768px (mobile), centered
// 600-ish modal on desktop. Camera viewport is a fixed 4:3 box so
// label aiming feels the same regardless of device.
//
// Lifecycle: useEffect mount instantiates Html5Qrcode, requests
// the rear-facing camera, registers onScanSuccess. useEffect
// unmount stops AND clears the scanner so opening the modal
// twice in one session does not throw "camera in use".

import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Camera, Check, AlertCircle, X, Tag, ImagePlus } from "lucide-react";

const SCANNER_ELEMENT_ID = "vls-barcode-scanner";
const FILE_SCAN_ELEMENT_ID = "vls-file-scan-container";
const DUPLICATE_SCAN_COOLDOWN_MS = 1500;

export type ScanAction = "decrement" | "increment" | "lookup_only" | "correction";

interface InventoryLite {
  id: number;
  item_name: string;
  catalog_number?: string | null;
  vendor?: string | null;
  storage_location?: string | null;
  barcode_value?: string | null;
}

interface ScanResultCard {
  id: string;            // local uuid for React key
  status: "ok" | "reorder" | "unknown" | "error";
  itemName: string | null;
  barcodeValue: string;
  qtyBefore: number | null;
  qtyAfter: number | null;
  needsReorder: boolean;
  message: string | null;
  scanEventId: number | null;
  at: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  mode: "scan" | "bind";
  apiBase: string;
  authHeaders: () => Record<string, string>;
  inventory: InventoryLite[];
  activeLabId?: number | null;
  onScanComplete?: () => void;          // called after each successful scan in mode="scan", so parent can refresh list
  onBindComplete?: (value: string) => void; // called in mode="bind" with the captured barcode value
}

export default function BarcodeScannerModal({
  open,
  onClose,
  mode,
  apiBase,
  authHeaders,
  inventory,
  onScanComplete,
  onBindComplete,
}: Props) {
  const { toast } = useToast();

  const scannerRef = useRef<any>(null);
  const lastScanRef = useRef<{ value: string; at: number }>({ value: "", at: 0 });

  const [action, setAction] = useState<ScanAction>("decrement");
  const [results, setResults] = useState<ScanResultCard[]>([]);
  const [unknownBarcode, setUnknownBarcode] = useState<string | null>(null);
  const [bindQuery, setBindQuery] = useState("");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  // 2026-06-08: typed fallback for iOS Safari where the camera decoder
  // is unreliable. The tech types the VLS code on the label and submits;
  // same handleScan() pipeline as a camera decode, so the action picker,
  // bind panel, and result cards all behave identically.
  const [typedBarcode, setTypedBarcode] = useState("");
  // 2026-06-08: native-camera capture fallback. iPhone barcode scanner
  // apps work because they use AVFoundation directly. We can get close
  // by delegating to the iOS native camera via <input capture> — the
  // user taps a button, iOS opens the native camera app, snaps a
  // photo, and we decode the still image. html5-qrcode's scanFile()
  // decodes a single image off the main video stream, so we stop the
  // live scanner first to avoid getUserMedia conflicts, decode the
  // capture, then restart the live scanner if it was running.
  const captureInputRef = useRef<HTMLInputElement | null>(null);
  const [isDecodingCapture, setIsDecodingCapture] = useState(false);

  // Pause the camera scan callback while the bind panel is open so the
  // tech can search the inventory list without the next frame firing
  // another scan event.
  const paused = !!unknownBarcode;
  const pausedRef = useRef(paused);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  const handleScan = useCallback(
    async (decoded: string) => {
      const now = Date.now();
      if (pausedRef.current) return;
      if (
        decoded === lastScanRef.current.value &&
        now - lastScanRef.current.at < DUPLICATE_SCAN_COOLDOWN_MS
      ) {
        return;
      }
      lastScanRef.current = { value: decoded, at: now };

      // Bind mode: just pass the value up and close.
      if (mode === "bind") {
        onBindComplete?.(decoded);
        onClose();
        return;
      }

      // Scan mode: POST /api/inventory/scan with the current action.
      try {
        const res = await fetch(`${apiBase}/api/inventory/scan`, {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ barcode_value: decoded, action }),
        });
        if (res.status === 404) {
          // Unknown barcode. Pause the camera (via pausedRef set by
          // the unknownBarcode state) and show the bind panel.
          setUnknownBarcode(decoded);
          setResults((prev) => [
            {
              id: `${decoded}-${now}`,
              status: "unknown",
              itemName: null,
              barcodeValue: decoded,
              qtyBefore: null,
              qtyAfter: null,
              needsReorder: false,
              message: "Barcode not bound. Pick an item to bind it to.",
              scanEventId: null,
              at: now,
            },
            ...prev,
          ]);
          return;
        }
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          setResults((prev) => [
            {
              id: `err-${now}`,
              status: "error",
              itemName: null,
              barcodeValue: decoded,
              qtyBefore: null,
              qtyAfter: null,
              needsReorder: false,
              message: err.error || `HTTP ${res.status}`,
              scanEventId: null,
              at: now,
            },
            ...prev,
          ]);
          return;
        }
        const data = await res.json();
        setResults((prev) => [
          {
            id: `${data.scan_event_id ?? decoded}-${now}`,
            status: data.needs_reorder ? "reorder" : "ok",
            itemName: data.item?.item_name ?? null,
            barcodeValue: decoded,
            qtyBefore: data.quantity_before ?? null,
            qtyAfter: data.quantity_after ?? null,
            needsReorder: !!data.needs_reorder,
            message: data.needs_reorder
              ? `Now at or below reorder point (par ${data.reorder_point ?? "?"})`
              : null,
            scanEventId: data.scan_event_id ?? null,
            at: now,
          },
          ...prev,
        ]);
        onScanComplete?.();
      } catch (e: any) {
        setResults((prev) => [
          {
            id: `neterr-${now}`,
            status: "error",
            itemName: null,
            barcodeValue: decoded,
            qtyBefore: null,
            qtyAfter: null,
            needsReorder: false,
            message: e?.message || "Network error",
            scanEventId: null,
            at: now,
          },
          ...prev,
        ]);
      }
    },
    [action, apiBase, authHeaders, mode, onBindComplete, onClose, onScanComplete]
  );

  // Camera lifecycle. Single effect: open => start, close/unmount => stop+clear.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCameraError(null);
    setIsStarting(true);

    const init = async () => {
      try {
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import("html5-qrcode");
        if (cancelled) return;
        // 2026-06-08 iOS scan-fail fix (hotfix 2026-06-08 13:54 AZ).
        //
        // html5-qrcode's start() API has a strict shape contract:
        //
        //   start(cameraIdOrConfig, configuration, success, error)
        //
        // cameraIdOrConfig is either a string device id OR a SINGLE-KEY
        // MediaTrackConstraints object (just `{facingMode}` or just
        // `{deviceId}`). Passing 4 keys throws "cameraIdOrConfig object
        // should have exactly 1 key" the moment the camera tries to
        // start. Additional constraints (focusMode, width, height) go
        // into the SECOND argument under `videoConstraints`, which the
        // library forwards into getUserMedia.
        //
        // Three behavior changes preserved from the original fix:
        //   1) Code 128 only. QR_CODE removed.
        //   2) experimentalFeatures.useBarCodeDetectorIfSupported = true
        //      for the native iOS BarcodeDetector path.
        //   3) Continuous autofocus + 1920x1080 ideal + fps 25 in
        //      videoConstraints inside the configuration arg (not the
        //      camera selector arg).
        const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID, {
          formatsToSupport: [Html5QrcodeSupportedFormats.CODE_128],
          experimentalFeatures: { useBarCodeDetectorIfSupported: true },
          verbose: false,
        } as any);
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          {
            fps: 25,
            qrbox: { width: 280, height: 140 },
            aspectRatio: 4 / 3,
            videoConstraints: {
              facingMode: "environment",
              focusMode: "continuous",
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
          } as any,
          (decoded: string) => { void handleScan(decoded); },
          () => {} // ignore per-frame decode failures
        );
        if (cancelled) {
          await scanner.stop().catch(() => {});
          scanner.clear();
          scannerRef.current = null;
          return;
        }
        setIsStarting(false);
      } catch (e: any) {
        setIsStarting(false);
        setCameraError(e?.message || String(e));
      }
    };
    init();

    return () => {
      cancelled = true;
      const s = scannerRef.current;
      scannerRef.current = null;
      if (s && typeof s.stop === "function") {
        s.stop().then(() => s.clear?.()).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Decode a still image captured via the native iOS camera input.
  // Stops the live scanner first to release getUserMedia, runs
  // Html5Qrcode.scanFile on a hidden DOM container, then restarts
  // the live scanner. Result goes through the same handleScan()
  // pipeline as a live decode.
  const handleCapturedFile = useCallback(async (file: File) => {
    setIsDecodingCapture(true);
    const now = Date.now();
    // Stop the live scanner BEFORE scanFile to free the camera and
    // avoid getUserMedia contention on iOS.
    const live = scannerRef.current;
    let wasRunning = false;
    if (live && typeof live.stop === "function") {
      try {
        await live.stop();
        wasRunning = true;
      } catch { /* may already be stopped */ }
    }
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      // scanFile needs its own DOM container to render the decoded
      // image (the showImage flag controls visibility; pass false so
      // we don't paint it on top of the live viewport).
      const fileScanner = new Html5Qrcode(FILE_SCAN_ELEMENT_ID);
      const decoded = await fileScanner.scanFile(file, false);
      await handleScan(decoded);
    } catch (e: any) {
      // scanFile rejects with a string error on no-decode. Surface
      // it as a result card so the tech sees what happened.
      setResults((prev) => [
        {
          id: `capture-err-${now}`,
          status: "error",
          itemName: null,
          barcodeValue: "",
          qtyBefore: null,
          qtyAfter: null,
          needsReorder: false,
          message: typeof e === "string"
            ? `Could not decode the photo: ${e}. Try again with better lighting or use the typed input above.`
            : `Could not decode the photo. Try again with better lighting or use the typed input above.`,
          scanEventId: null,
          at: now,
        },
        ...prev,
      ]);
    } finally {
      setIsDecodingCapture(false);
      // Restart the live scanner so the camera preview comes back
      // for the next attempt. Mirrors the init() effect's config.
      if (wasRunning && scannerRef.current) {
        try {
          const { Html5QrcodeSupportedFormats } = await import("html5-qrcode");
          await scannerRef.current.start(
            { facingMode: "environment" },
            {
              fps: 25,
              qrbox: { width: 280, height: 140 },
              aspectRatio: 4 / 3,
              videoConstraints: {
                facingMode: "environment",
                focusMode: "continuous",
                width: { ideal: 1920 },
                height: { ideal: 1080 },
              },
              formatsToSupport: [Html5QrcodeSupportedFormats.CODE_128],
            } as any,
            (decoded: string) => { void handleScan(decoded); },
            () => {}
          );
        } catch { /* swallow; user can close + reopen if camera doesn't come back */ }
      }
    }
  }, [handleScan]);

  // Pick an item to bind the unknown barcode to.
  const bindToItem = async (item: InventoryLite) => {
    if (!unknownBarcode) return;
    try {
      const res = await fetch(`${apiBase}/api/inventory/${item.id}`, {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ ...item, barcode_value: unknownBarcode }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({
          title: "Could not bind barcode",
          description: err.error || `HTTP ${res.status}`,
          variant: "destructive",
        });
        return;
      }
      toast({
        title: `Bound ${unknownBarcode} to ${item.item_name}`,
        description: "Scan again to record the decrement.",
      });
      setUnknownBarcode(null);
      setBindQuery("");
      // Reset the cooldown so the user can immediately re-scan the same value.
      lastScanRef.current = { value: "", at: 0 };
      onScanComplete?.();
    } catch (e: any) {
      toast({ title: "Could not bind barcode", description: e?.message || "Network error", variant: "destructive" });
    }
  };

  const filteredBindCandidates = (() => {
    if (!unknownBarcode) return [] as InventoryLite[];
    const q = bindQuery.trim().toLowerCase();
    const pool = inventory.filter((it) => !it.barcode_value || it.barcode_value.trim() === "");
    if (!q) return pool.slice(0, 20);
    return pool
      .filter((it) =>
        (it.item_name || "").toLowerCase().includes(q) ||
        (it.catalog_number || "").toLowerCase().includes(q) ||
        (it.vendor || "").toLowerCase().includes(q) ||
        (it.storage_location || "").toLowerCase().includes(q)
      )
      .slice(0, 20);
  })();

  const close = () => {
    setResults([]);
    setUnknownBarcode(null);
    setBindQuery("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) close(); }}>
      {/* Full-screen on mobile (< 768px); centered modal on >= sm. */}
      <DialogContent className="p-0 sm:max-w-2xl w-screen h-[100dvh] sm:h-auto sm:max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-2 border-b">
          <DialogTitle className="flex items-center gap-2">
            <Camera size={18} style={{ color: "#01696F" }} />
            {mode === "bind" ? "Scan a barcode to bind" : "Scan to update inventory"}
          </DialogTitle>
        </DialogHeader>

        {/* Action picker — only in scan mode */}
        {mode === "scan" && (
          <div className="px-4 py-2 border-b flex items-center gap-2 flex-wrap">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Action</Label>
            <Select value={action} onValueChange={(v) => setAction(v as ScanAction)}>
              <SelectTrigger className="h-8 w-44" data-testid="scan-action-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="decrement">Decrement (-1)</SelectItem>
                <SelectItem value="increment">Increment (+1)</SelectItem>
                <SelectItem value="lookup_only">Lookup only (no change)</SelectItem>
              </SelectContent>
            </Select>
            <div className="ml-auto text-xs text-muted-foreground">
              {results.length === 0 ? "Aim at a Code 128 label or type below" : `${results.length} scan${results.length === 1 ? "" : "s"} this session`}
            </div>
          </div>
        )}

        {/* 2026-06-08: typed-fallback input. iOS Safari runs the slower
            ZXing JS decoder (no native BarcodeDetector) so the camera
            sometimes refuses to decode a clearly-aimed label. Typing
            the VLS code routes through the same handleScan() flow so
            the action picker, bind panel, and result cards stay in
            sync regardless of input source. */}
        <form
          className="px-4 py-2 border-b flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const v = typedBarcode.trim();
            if (!v) return;
            void handleScan(v);
            setTypedBarcode("");
          }}
        >
          <Input
            type="text"
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Type barcode (e.g. VLS-90008332) and press enter"
            value={typedBarcode}
            onChange={(e) => setTypedBarcode(e.target.value)}
            className="h-9 flex-1 font-mono text-sm"
            data-testid="scan-typed-input"
          />
          <Button
            type="submit"
            size="sm"
            disabled={!typedBarcode.trim()}
            style={{ backgroundColor: "#01696F" }}
            className="text-white shrink-0"
            data-testid="scan-typed-submit"
          >
            Submit
          </Button>
        </form>

        {/* Camera viewport: fixed 4:3 box.
            2026-06-08 (hotfix 15:10 AZ): hidden during bind mode so
            the bind panel header + item list fit on iPhone viewport.
            The camera is paused anyway when unknownBarcode is set
            (pausedRef.current=true gates handleScan); rendering its
            empty gray box was just wasting ~290px of vertical space
            and pushing the modal past 100dvh. The SCANNER_ELEMENT_ID
            div stays mounted but display:none so html5-qrcode's
            attached video/canvas elements don't get torn down. */}
        <div className={"relative bg-black flex-shrink-0 " + (unknownBarcode ? "hidden" : "")}>
          <div id={SCANNER_ELEMENT_ID} className="w-full" style={{ aspectRatio: "4 / 3" }} />
          {/* Hidden DOM container used by html5-qrcode's scanFile() for
              the native-camera-capture path. Never visually rendered. */}
          <div id={FILE_SCAN_ELEMENT_ID} className="hidden" />
          {isStarting && !cameraError && (
            <div className="absolute inset-0 flex items-center justify-center text-white text-sm">
              Starting camera...
            </div>
          )}
          {cameraError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-white text-sm p-4 text-center">
              <AlertCircle size={28} className="mb-2" />
              <div>Camera unavailable: {cameraError}</div>
              <div className="text-xs opacity-70 mt-1">Check the site has camera permission for this browser.</div>
            </div>
          )}
        </div>

        {/* 2026-06-08: "Tap to capture" native-camera fallback. On iOS,
            html5-qrcode's continuous decode loop on the live video
            stream is unreliable because Safari runs the slow ZXing JS
            decoder. The native iPhone camera app uses AVFoundation
            with hardware-accelerated barcode detection; we can get
            close by delegating capture to that app via
            <input capture="environment">. ZXing decodes a sharp still
            image reliably; the failure mode was only the streaming
            loop. Same handleScan() pipeline as a live decode.
            2026-06-08 (hotfix 15:10 AZ): hidden during bind mode for
            the same viewport-height reason as the camera viewport. */}
        {!unknownBarcode && (
          <div className="px-4 py-2 border-b">
            <input
              ref={captureInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              data-testid="scan-capture-input"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                await handleCapturedFile(file);
                // Reset so the same image can be re-picked if needed
                if (captureInputRef.current) captureInputRef.current.value = "";
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-full"
              disabled={isDecodingCapture}
              onClick={() => captureInputRef.current?.click()}
              data-testid="scan-capture-button"
            >
              <ImagePlus size={14} className="mr-1.5" />
              {isDecodingCapture ? "Decoding photo..." : "Tap to capture (use iPhone camera)"}
            </Button>
          </div>
        )}

        {/* Unknown barcode bind panel takes over the result stack area when active. */}
        {unknownBarcode ? (
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-amber-50 dark:bg-amber-950/30">
            <div className="flex items-start gap-2">
              <Tag size={18} className="text-amber-700 mt-0.5" />
              <div className="text-sm">
                <div className="font-semibold">Unknown barcode: <span className="font-mono">{unknownBarcode}</span></div>
                <div className="text-muted-foreground">Pick the inventory item this barcode belongs to. The item will be bound and you can re-scan to record the action.</div>
              </div>
            </div>
            <Input
              placeholder="Search item name, catalog, vendor, location"
              value={bindQuery}
              onChange={(e) => setBindQuery(e.target.value)}
              data-testid="scan-bind-search"
              autoFocus
            />
            <div className="border rounded divide-y bg-white dark:bg-background">
              {filteredBindCandidates.length === 0 ? (
                <div className="p-3 text-sm text-muted-foreground">
                  No unbound items match. (Items that already have a barcode are hidden here.)
                </div>
              ) : (
                filteredBindCandidates.map((it) => (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => bindToItem(it)}
                    className="w-full text-left p-2 hover:bg-muted flex items-center justify-between gap-3"
                  >
                    <div>
                      <div className="font-medium">{it.item_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {[it.vendor, it.catalog_number, it.storage_location].filter(Boolean).join(" · ") || "no metadata"}
                      </div>
                    </div>
                    <span className="text-xs text-teal-700">Bind</span>
                  </button>
                ))
              )}
            </div>
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="outline" onClick={() => { setUnknownBarcode(null); setBindQuery(""); }}>
                <X size={14} className="mr-1" /> Cancel bind
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
            {results.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-6">
                Scan results will appear here. Newest scan on top.
              </div>
            ) : (
              results.map((r) => (
                <div
                  key={r.id}
                  className={
                    "border rounded p-3 flex items-start gap-3 " +
                    (r.status === "reorder" ? "border-amber-400 bg-amber-50 dark:bg-amber-950/30"
                      : r.status === "unknown" ? "border-red-300 bg-red-50 dark:bg-red-950/30"
                      : r.status === "error" ? "border-red-400 bg-red-50 dark:bg-red-950/30"
                      : "border-green-300 bg-green-50 dark:bg-green-950/30")
                  }
                  data-testid="scan-result-card"
                >
                  <div className="mt-0.5">
                    {r.status === "ok" || r.status === "reorder" ? <Check size={16} className="text-green-700" /> : <AlertCircle size={16} className="text-red-700" />}
                  </div>
                  <div className="text-sm flex-1">
                    <div className="font-medium">
                      {r.itemName ?? "Unknown barcode"}
                    </div>
                    <div className="font-mono text-xs text-muted-foreground">{r.barcodeValue}</div>
                    {r.qtyBefore != null && r.qtyAfter != null && (
                      <div className="mt-1">
                        Qty: <span className="font-mono">{r.qtyBefore}</span> &rarr; <span className="font-mono font-bold">{r.qtyAfter}</span>
                      </div>
                    )}
                    {r.message && <div className="mt-1 text-xs">{r.message}</div>}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        <div className="px-4 py-2 border-t flex justify-end">
          <Button size="sm" variant="outline" onClick={close}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
