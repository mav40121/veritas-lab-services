// Download for the Testing Personnel Competency Register (Michael Q74 = 1, plan part C, 2026-10-11).
// GET /api/labs/:labId/staff/competency-register.xlsx (server/competencyRegisterExcel.ts). Read-only, so it is
// not gated by useIsReadOnly: anyone who can see the roster can download the register.
import { useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { useToast } from "@/hooks/use-toast";

export function CompetencyRegisterButton({ size = "sm", variant = "outline" }: { size?: "sm" | "default"; variant?: "outline" | "default" }) {
  const activeLabId = useActiveLabId();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  if (!activeLabId) return null;

  async function download() {
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/labs/${activeLabId}/staff/competency-register.xlsx`, { headers: authHeaders() });
      if (!res.ok) {
        const t = await res.text();
        let msg = t; try { msg = JSON.parse(t).error || t; } catch {}
        throw new Error(msg);
      }
      const cd = res.headers.get("Content-Disposition") || "";
      const name = /filename="([^"]+)"/.exec(cd)?.[1] || "Competency_Register.xlsx";
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast({ title: "Could not download the competency register", description: err.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant={variant} size={size} onClick={download} disabled={busy} data-testid="button-competency-register"
      title="Excel register of every testing person: hire date, orientation/training, initial, 6-month, 1st annual, annual, what is due next">
      <FileSpreadsheet size={14} className="mr-1.5" /> {busy ? "Preparing..." : "Competency Register"}
    </Button>
  );
}
