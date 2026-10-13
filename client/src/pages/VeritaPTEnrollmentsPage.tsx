// client/src/pages/VeritaPTEnrollmentsPage.tsx
//
// Dedicated PT enrollments screen (Michael 2026-10-12: "veritaPT add enrollment needs a dedicated screen where you can
// scroll more effectively. I do not want the overlay, i want its own screen."). Replaces the "PT Program Enrollments"
// dialog on the VeritaPT page, which had no height limit and ran off the screen for a lab with many enrollments
// (Redington-Fairview). Add form at the top, the full list below with a filter, normal page scrolling. Same API:
//   GET/POST /api/labs/:labId/pt/enrollments, DELETE /api/labs/:labId/pt/enrollments/:id,
//   GET /api/veritapt/programs?vendor= (vendor program catalog for the Program Name dropdown).
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useIsReadOnly } from "@/components/SubscriptionBanner";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { useLabRoute } from "@/hooks/useLabRoute";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronLeft, ChevronsUpDown, Plus, Search, Trash2 } from "lucide-react";
import { PT_CATEGORIES, VENDORS } from "@/lib/veritaptConstants";

// Program search: an item's value is "CODE | Program Name". An exact code ranks first, then a code that starts with
// the search, then any program whose code or name contains it. Plain substring, not fuzzy, so "151" finds 151 only.
const programFilter = (value: string, search: string): number => {
  const s = search.trim().toLowerCase();
  if (!s) return 1;
  const v = value.toLowerCase();
  const code = v.split(" | ")[0].trim();
  if (code && code === s) return 1;
  if (code && code.startsWith(s)) return 0.8;
  return v.includes(s) ? 0.5 : 0;
};

type Enrollment = { id: number; vendor: string; program_name: string; pt_category: string; year_enrolled: number };
type VendorProgram = { programCode: string | null; programName: string; ptCategory: string; analytes: string[] };

export default function VeritaPTEnrollmentsPage() {
  const isReadOnly = useIsReadOnly("veritapt");
  const activeLabId = useActiveLabId();
  const labRoute = useLabRoute();
  const { toast } = useToast();
  const ptApi = activeLabId ? `${API_BASE}/api/labs/${activeLabId}/pt` : `${API_BASE}/api/pt`;

  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [vendorFilter, setVendorFilter] = useState("all");

  // Add form
  const [newVendor, setNewVendor] = useState("CAP");
  const [newProgramName, setNewProgramName] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [newYear, setNewYear] = useState(String(new Date().getFullYear()));
  const [vendorPrograms, setVendorPrograms] = useState<VendorProgram[]>([]);
  const [selectedProgram, setSelectedProgram] = useState<VendorProgram | null>(null);
  const [programOpen, setProgramOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${ptApi}/enrollments`, { headers: authHeaders() });
      const j = r.ok ? await r.json() : [];
      setEnrollments(Array.isArray(j) ? j : []);
    } catch {
      setEnrollments([]);
    } finally {
      setLoading(false);
    }
  };
  // Reload on a lab switch (module pages do not remount; see the lab-switch stale-state class).
  useEffect(() => { load(); }, [ptApi]); // eslint-disable-line react-hooks/exhaustive-deps

  // The selected vendor's program catalog (vendor-global, so the fixed /api/veritapt path). "Other" has none.
  useEffect(() => {
    if (newVendor === "Other") { setVendorPrograms([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/api/veritapt/programs?vendor=${encodeURIComponent(newVendor)}`, { headers: authHeaders() });
        const j = r.ok ? await r.json() : null;
        if (!cancelled) setVendorPrograms(Array.isArray(j?.programs) ? j.programs : []);
      } catch { if (!cancelled) setVendorPrograms([]); }
    })();
    return () => { cancelled = true; };
  }, [newVendor]);

  const handleAdd = async () => {
    if (!newVendor || !newProgramName.trim() || !newCategory || !newYear) return;
    setSaving(true);
    try {
      const r = await fetch(`${ptApi}/enrollments`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ vendor: newVendor, program_name: newProgramName.trim(), pt_category: newCategory, year_enrolled: Number(newYear) }),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `HTTP ${r.status}`); }
      toast({ title: "Enrollment added", description: `${newVendor}: ${newProgramName.trim()}` });
      // Stay on the screen for the next one: keep the vendor and year, clear the program.
      setNewProgramName("");
      setNewCategory("");
      setSelectedProgram(null);
      await load();
    } catch (e: any) {
      toast({ title: "Could not add the enrollment", description: String(e?.message || e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (id: number) => {
    await fetch(`${ptApi}/enrollments/${id}`, { method: "DELETE", headers: authHeaders() });
    await load();
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return enrollments
      .filter((e) => vendorFilter === "all" || e.vendor === vendorFilter)
      .filter((e) => !q || `${e.vendor} ${e.program_name} ${e.pt_category} ${e.year_enrolled}`.toLowerCase().includes(q))
      .sort((a, b) => a.vendor.localeCompare(b.vendor) || a.pt_category.localeCompare(b.pt_category) || a.program_name.localeCompare(b.program_name));
  }, [enrollments, query, vendorFilter]);
  const vendorsOnFile = useMemo(() => Array.from(new Set(enrollments.map((e) => e.vendor))).sort(), [enrollments]);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5" data-testid="pt-enrollments-page">
      <Link href={labRoute("/veritapt/app")} className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1" data-testid="pt-enrollments-back">
        <ChevronLeft size={14} /> VeritaPT&trade;
      </Link>
      <div>
        <h1 className="text-2xl font-bold">PT Program Enrollments</h1>
        <p className="text-sm text-muted-foreground mt-1">
          The proficiency testing programs this lab is enrolled in. VeritaPT&trade; matches them to your VeritaMap&trade; test menu for coverage.
        </p>
      </div>

      {!isReadOnly && (
        <Card>
          <CardContent className="p-4 space-y-3" data-testid="pt-enrollment-add">
            <p className="text-sm font-semibold">Add Enrollment</p>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Vendor</Label>
                <Select value={newVendor} onValueChange={(v) => { setNewVendor(v); setNewProgramName(""); setNewCategory(""); setSelectedProgram(null); }}>
                  <SelectTrigger className="h-9 text-sm" data-testid="pt-enroll-vendor"><SelectValue /></SelectTrigger>
                  <SelectContent>{VENDORS.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs">Program Name</Label>
                {newVendor !== "Other" && vendorPrograms.length > 0 ? (
                  // Type-to-search picker (Redington, 10/12): the catalog runs to hundreds of programs, so the lab finds one
                  // by its program name or its vendor code (JAT, 151) instead of scrolling a dropdown.
                  <Popover open={programOpen} onOpenChange={setProgramOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" role="combobox" aria-expanded={programOpen}
                        className="h-9 w-full justify-between text-sm font-normal" data-testid="pt-enroll-program-select">
                        <span className={`truncate ${newProgramName ? "" : "text-muted-foreground"}`}>
                          {newProgramName
                            ? `${newProgramName}${selectedProgram?.programCode ? ` (${selectedProgram.programCode})` : ""}`
                            : `Search ${newVendor} programs by name or code`}
                        </span>
                        <ChevronsUpDown size={14} className="ml-2 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)]" align="start">
                      <Command filter={programFilter}>
                        <CommandInput placeholder="Type a name or code, e.g. Transfusion or JAT" data-testid="pt-enroll-program-search" />
                        <CommandList className="max-h-72">
                          <CommandEmpty>No {newVendor} program matches. Check the code, or pick Other to type the name.</CommandEmpty>
                          <CommandGroup>
                            {vendorPrograms.map((p) => (
                              <CommandItem key={p.programName} value={`${p.programCode ?? ""} | ${p.programName}`} data-testid="pt-enroll-program-option"
                                onSelect={() => {
                                  setNewProgramName(p.programName);
                                  setSelectedProgram(p);
                                  setNewCategory(p.ptCategory);
                                  setProgramOpen(false);
                                }}>
                                <Check size={14} className={`mr-2 shrink-0 ${newProgramName === p.programName ? "opacity-100" : "opacity-0"}`} />
                                <span className="flex-1">{p.programName}</span>
                                {p.programCode && <span className="ml-2 font-mono text-xs opacity-70">{p.programCode}</span>}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                ) : (
                  <Input value={newProgramName} onChange={(e) => { setNewProgramName(e.target.value); setSelectedProgram(null); }}
                    placeholder="e.g. CAP Chemistry Survey (C)" className="h-9 text-sm" data-testid="pt-enroll-program-input" />
                )}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Year Enrolled</Label>
                <Input type="text" inputMode="numeric" value={newYear} onChange={(e) => setNewYear(e.target.value)} className="h-9 text-sm" data-testid="pt-enroll-year" />
              </div>
              <div className="space-y-1 sm:col-span-4">
                <Label className="text-xs">PT Category</Label>
                {selectedProgram ? (
                  <div className="rounded-md border px-3 py-2 text-sm bg-background">
                    <span className="font-medium" data-testid="pt-enroll-category-from-program">{newCategory}</span>
                    <span className="text-xs text-muted-foreground"> (from program)</span>
                    {selectedProgram.analytes.length > 0 && (
                      <div className="mt-2">
                        <p className="text-xs text-muted-foreground mb-1">Tests included ({selectedProgram.analytes.length}):</p>
                        <div className="flex flex-wrap gap-1">
                          {selectedProgram.analytes.map((a) => <Badge key={a} variant="secondary" className="text-[10px] font-normal">{a}</Badge>)}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <Select value={newCategory} onValueChange={setNewCategory}>
                    <SelectTrigger className="h-9 text-sm sm:max-w-sm" data-testid="pt-enroll-category"><SelectValue placeholder="Select category" /></SelectTrigger>
                    <SelectContent>{PT_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                )}
                {newVendor !== "Other" && vendorPrograms.length === 0 && (
                  <p className="text-xs text-muted-foreground">No {newVendor} catalog loaded yet. Type the program name, or ask Veritas to load the {newVendor} catalog.</p>
                )}
              </div>
            </div>
            <Button size="sm" className="bg-[#006064] hover:bg-[#004d50] text-white" onClick={handleAdd}
              disabled={saving || !newVendor || !newProgramName.trim() || !newCategory || !newYear} data-testid="pt-enroll-add">
              <Plus size={14} className="mr-1.5" />{saving ? "Saving..." : "Add Enrollment"}
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by program, category or year" className="h-9 pl-8 text-sm" data-testid="pt-enroll-filter" />
        </div>
        <Select value={vendorFilter} onValueChange={setVendorFilter}>
          <SelectTrigger className="h-9 w-40 text-sm" data-testid="pt-enroll-vendor-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All vendors</SelectItem>
            {vendorsOnFile.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground" data-testid="pt-enroll-count">
          {shown.length === enrollments.length ? `${enrollments.length} enrollments` : `${shown.length} of ${enrollments.length} enrollments`}
        </span>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
      ) : enrollments.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">No enrollments recorded yet.</p>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm" data-testid="pt-enroll-table">
            <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
              <tr className="text-muted-foreground border-b text-xs">
                <th className="text-left py-2 px-3">Vendor</th>
                <th className="text-left py-2 pr-3">Program Name</th>
                <th className="text-left py-2 pr-3">Category</th>
                <th className="text-left py-2 pr-3">Year</th>
                {!isReadOnly && <th className="py-2 pr-3" />}
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e.id} className="border-b border-border/50" data-testid="pt-enroll-row">
                  <td className="py-2 px-3 font-medium">{e.vendor}</td>
                  <td className="py-2 pr-3">{e.program_name}</td>
                  <td className="py-2 pr-3 text-muted-foreground text-xs">{e.pt_category}</td>
                  <td className="py-2 pr-3 text-muted-foreground">{e.year_enrolled}</td>
                  {!isReadOnly && (
                    <td className="py-2 pr-3 text-right">
                      <ConfirmDialog title="Remove Enrollment?" message="Remove this PT enrollment? Your coverage analysis will be updated." confirmLabel="Remove" onConfirm={() => handleRemove(e.id)}>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500 hover:text-red-700" aria-label={`Remove ${e.program_name}`}>
                          <Trash2 size={13} />
                        </Button>
                      </ConfirmDialog>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
