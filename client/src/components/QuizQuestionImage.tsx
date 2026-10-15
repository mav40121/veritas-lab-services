// client/src/components/QuizQuestionImage.tsx
//
// Pictures on VeritaComp quiz questions (REQ-074). QuizQuestionImage shows a question's picture wherever
// the question is shown; QuizImagePicker adds one in the quiz editor (choose a file, or paste a screenshot)
// and shrinks it before it is saved. Rules (one picture per question, data URL only, size caps) live in
// shared/quizImages.ts and are re-checked on the server.
import { useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isQuizImage, QUIZ_IMAGE_MAX_CHARS } from "@shared/quizImages";

export function QuizQuestionImage({ src, className }: { src?: string | null; className?: string }) {
  if (!isQuizImage(src)) return null;
  return (
    <img
      src={src}
      alt="Picture for this question"
      data-testid="quiz-question-image"
      className={className ?? "my-2 max-h-72 max-w-full rounded border border-border bg-white object-contain"}
    />
  );
}

const MAX_EDGE = 1400;

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file could not be read as a picture")); };
    img.src = url;
  });
}

function encode(img: HTMLImageElement, edge: number, type: "image/png" | "image/jpeg", quality: number): string {
  const scale = Math.min(1, edge / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d")!;
  // JPEG has no transparency; a white page keeps a transparent graph readable.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL(type, quality);
}

/** Shrink a picture to fit one quiz question: PNG for graphs and screenshots when it stays small, else JPEG. */
export async function prepareQuizImage(file: Blob): Promise<string> {
  if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) throw new Error("Use a PNG, JPEG, GIF or WebP picture");
  const img = await loadImage(file);
  const tries: Array<[number, "image/png" | "image/jpeg", number]> = [
    ...(file.type === "image/jpeg" ? [] : [[MAX_EDGE, "image/png", 1] as [number, "image/png", number]]),
    [MAX_EDGE, "image/jpeg", 0.85],
    [1100, "image/jpeg", 0.75],
    [800, "image/jpeg", 0.7],
  ];
  for (const [edge, type, q] of tries) {
    const out = encode(img, edge, type, q);
    // PNG only when it stays small; a photo saved as PNG would crowd out the rest of the quiz.
    if (type === "image/png" ? out.length <= 400_000 : out.length <= QUIZ_IMAGE_MAX_CHARS) return out;
  }
  throw new Error("That picture is too large even after shrinking it");
}

export function QuizImagePicker({
  value,
  onChange,
  onError,
  testId,
}: {
  value?: string | null;
  onChange: (next: string | null) => void;
  onError: (message: string) => void;
  testId?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function take(file: Blob | null | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      onChange(await prepareQuizImage(file));
    } catch (e: any) {
      onError(e?.message || "That picture could not be added");
    } finally {
      setBusy(false);
    }
  }

  if (isQuizImage(value)) {
    return (
      <div className="space-y-1" data-testid={testId}>
        <QuizQuestionImage src={value} className="max-h-48 max-w-full rounded border border-border bg-white object-contain" />
        <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-xs text-destructive" onClick={() => onChange(null)}>
          <X className="h-3.5 w-3.5 mr-1" /> Remove picture
        </Button>
      </div>
    );
  }

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border px-2 py-1.5 text-[11px] text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      tabIndex={0}
      data-testid={testId}
      onPaste={(e) => {
        const item = Array.from(e.clipboardData.items).find((it) => it.type.startsWith("image/"));
        if (item) { e.preventDefault(); take(item.getAsFile()); }
      }}
    >
      <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-xs" disabled={busy} onClick={() => fileRef.current?.click()}>
        <ImagePlus className="h-3.5 w-3.5 mr-1" /> {busy ? "Adding..." : "Add picture"}
      </Button>
      <span>or click here and paste a screenshot (Ctrl+V). No patient names, numbers or dates in pictures.</span>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        onChange={(e) => { take(e.target.files?.[0]); e.target.value = ""; }}
      />
    </div>
  );
}
