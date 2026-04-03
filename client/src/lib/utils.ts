import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { saveAs } from "file-saver";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Fetches a PDF from a one-time token URL and forces a download using file-saver.
 * Uses saveAs() which is reliable across Edge, Chrome, Firefox, and Safari.
 */
export async function downloadPdfToken(token: string, filename: string): Promise<void> {
  const res = await fetch(`/api/pdf/${token}`);
  if (!res.ok) throw new Error(`PDF fetch failed: ${res.status}`);
  const blob = await res.blob();
  saveAs(blob, filename);
}
