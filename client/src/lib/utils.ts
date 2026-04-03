import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Fetches a PDF from a one-time token URL and triggers a browser download.
 * Avoids the about:blank tab issue caused by navigating directly to the token URL.
 */
export async function downloadPdfToken(token: string, filename: string): Promise<void> {
  const res = await fetch(`/api/pdf/${token}`);
  if (!res.ok) throw new Error(`PDF fetch failed: ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
