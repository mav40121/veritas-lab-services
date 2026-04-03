import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Triggers a PDF download by navigating directly to the token URL.
 * Direct browser navigation lets Adobe/Edge handle the PDF with a proper title.
 * Do NOT use fetch+blob - that causes about:blank with Adobe.
 */
export function downloadPdfToken(token: string, filename: string): void {
  const a = document.createElement("a");
  a.href = `/api/pdf/${token}`;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
