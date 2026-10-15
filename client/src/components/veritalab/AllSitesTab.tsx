// VeritaLab "All sites" tab (St. Charles REQ-072, 2026-10-14): every CLIA site (lab) the signed-in person
// manages, one line each, with what needs attention first. Server: GET /api/veritalab/sites-overview
// (server/veritalabRegistry.ts siteSummary). A site opens its own VeritaLab page.
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { ExternalLink, AlertTriangle, CheckCircle2 } from "lucide-react";
import { FEE_TYPE_LABELS } from "./SiteRegistryTab";

interface SiteLine {
  lab_id: number;
  lab_name: string;
  clia_number: string | null;
  clia_certificate_type: string | null;
  clia_expiration: string | null;
  certificate_link: string | null;
  director: string | null;
  next_fee: { due_date: string; amount: number | null; fee_type: string } | null;
  overdue_fees: number;
  last_menu_change: { change_date: string; description: string } | null;
  contact: { name: string; role: string | null; phone: string | null; email: string | null } | null;
  attention: string[];
}

const CERT_TYPE_LABELS: Record<string, string> = {
  waiver: "Waiver",
  ppm: "PPM",
  compliance: "Compliance",
  accreditation: "Accreditation",
  registration: "Registration",
};
const fmtDate = (d?: string | null) => (d ? new Date(d + "T00:00:00").toLocaleDateString() : "");

export function AllSitesTab() {
  const [sites, setSites] = useState<SiteLine[] | null>(null);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<"all" | "attention">("all");

  useEffect(() => {
    fetch(`${API_BASE}/api/veritalab/sites-overview`, { headers: authHeaders() })
      .then(async (r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((d) => setSites(d.sites || []))
      .catch(() => setError(true));
  }, []);

  const shown = useMemo(() => {
    const list = [...(sites || [])].sort((a, b) => b.attention.length - a.attention.length || a.lab_name.localeCompare(b.lab_name));
    return filter === "attention" ? list.filter((s) => s.attention.length > 0) : list;
  }, [sites, filter]);

  if (error) return <div className="text-sm text-destructive py-8 text-center">Could not load your sites. Refresh to try again.</div>;
  if (!sites) return <div className="text-sm text-muted-foreground py-8 text-center">Loading sites...</div>;

  const needing = sites.filter((s) => s.attention.length > 0).length;
  return (
    <div className="space-y-3" data-testid="all-sites">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {sites.length} site{sites.length === 1 ? "" : "s"} you manage; {needing} need{needing === 1 ? "s" : ""} attention.
        </p>
        <div className="flex gap-1 text-xs">
          {(["all", "attention"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2.5 py-1 rounded-md border ${filter === f ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-muted"}`}
            >
              {f === "all" ? "All sites" : "Needs attention"}
            </button>
          ))}
        </div>
      </div>
      {shown.map((s) => (
        <Card key={s.lab_id} data-testid={`site-${s.lab_id}`}>
          <CardContent className="p-4">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{s.lab_name}</span>
                  {s.clia_number && <span className="text-xs text-muted-foreground">CLIA {s.clia_number}</span>}
                  {s.clia_certificate_type && (
                    <Badge variant="outline" className="text-[10px]">{CERT_TYPE_LABELS[s.clia_certificate_type] || s.clia_certificate_type}</Badge>
                  )}
                  {s.attention.length === 0 && (
                    <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-700 border-emerald-500/20"><CheckCircle2 size={10} className="mr-1" />Up to date</Badge>
                  )}
                </div>
                <div className="grid sm:grid-cols-2 gap-x-6 gap-y-0.5 text-xs text-muted-foreground">
                  <div><span className="font-medium text-foreground">Certificate expires:</span> {s.clia_expiration ? fmtDate(s.clia_expiration) : "not on file"}</div>
                  <div><span className="font-medium text-foreground">Director:</span> {s.director || "not on file"}</div>
                  <div>
                    <span className="font-medium text-foreground">Next fee:</span>{" "}
                    {s.next_fee ? `${FEE_TYPE_LABELS[s.next_fee.fee_type] || s.next_fee.fee_type}${s.next_fee.amount != null ? `, $${Number(s.next_fee.amount).toLocaleString()}` : ""}, due ${fmtDate(s.next_fee.due_date)}` : "none open"}
                  </div>
                  <div>
                    <span className="font-medium text-foreground">Last menu change:</span>{" "}
                    {s.last_menu_change ? `${fmtDate(s.last_menu_change.change_date)}, ${s.last_menu_change.description}` : "none recorded"}
                  </div>
                  <div className="sm:col-span-2">
                    <span className="font-medium text-foreground">Contact:</span>{" "}
                    {s.contact ? [s.contact.name, s.contact.role, s.contact.phone, s.contact.email].filter(Boolean).join(", ") : "none recorded"}
                  </div>
                </div>
                {s.attention.length > 0 && (
                  <ul className="text-xs text-amber-700 dark:text-amber-400 space-y-0.5 pt-1">
                    {s.attention.map((a) => <li key={a} className="flex items-center gap-1"><AlertTriangle size={11} /> {a}</li>)}
                  </ul>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0 text-xs">
                {s.certificate_link && (
                  <a href={s.certificate_link} target="_blank" rel="noopener noreferrer" className="text-primary underline flex items-center gap-1">
                    Certificate <ExternalLink size={11} />
                  </a>
                )}
                <Link href={`/labs/${s.lab_id}/veritalab-app`} className="px-2.5 py-1 rounded-md border border-border hover:bg-muted">Open site</Link>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
      {shown.length === 0 && <div className="text-sm text-muted-foreground py-6 text-center">Nothing needs attention.</div>}
    </div>
  );
}
