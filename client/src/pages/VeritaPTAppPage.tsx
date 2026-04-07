import { useState, useEffect } from "react";
import { useAuth } from "@/components/AuthContext";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FlaskConical,
  Info,
  Plus,
  Trash2,
  RefreshCw,
} from "lucide-react";
import { Link } from "wouter";

const PT_CATEGORIES = [
  "General Chemistry",
  "Special Chemistry",
  "Endocrinology",
  "Toxicology / TDM",
  "Hematology",
  "Coagulation",
  "Blood Bank / Immunohematology",
  "Microbiology",
  "Immunology / Serology",
  "Urinalysis",
];

const VENDORS = ["CAP", "API", "Other"];

type FilterType = "all" | "gaps" | "covered" | "waived";

export default function VeritaPTAppPage() {
  const { user } = useAuth();
  const [coverage, setCoverage] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [enrollments, setEnrollments] = useState<any[]>([]);
  const [filter, setFilter] = useState<FilterType>("all");
  const [loading, setLoading] = useState(true);
  const [showEnrollModal, setShowEnrollModal] = useState(false);
  const [saving, setSaving] = useState(false);

  // New enrollment form state
  const [newVendor, setNewVendor] = useState("CAP");
  const [newProgramName, setNewProgramName] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [newYear, setNewYear] = useState(String(new Date().getFullYear()));

  const hasPlanAccess = !!user?.plan && user.plan !== "free" && user.plan !== "per_study";

  const fetchData = async () => {
    setLoading(true);
    try {
      const [covRes, enrollRes] = await Promise.all([
        fetch(`${API_BASE}/api/pt/coverage`, { headers: authHeaders() }),
        fetch(`${API_BASE}/api/pt/enrollments`, { headers: authHeaders() }),
      ]);
      const covData = await covRes.json();
      const enrollData = await enrollRes.json();
      setCoverage(covData.coverage ?? []);
      setSummary(covData.summary ?? null);
      setEnrollments(Array.isArray(enrollData) ? enrollData : []);
    } catch {
      // silent fail
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (hasPlanAccess) {
      fetchData();
    } else {
      setLoading(false);
    }
  }, [hasPlanAccess]);

  const handleAddEnrollment = async () => {
    if (!newVendor || !newProgramName.trim() || !newCategory || !newYear) return;
    setSaving(true);
    try {
      await fetch(`${API_BASE}/api/pt/enrollments`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          vendor: newVendor,
          program_name: newProgramName.trim(),
          pt_category: newCategory,
          year_enrolled: Number(newYear),
        }),
      });
      setNewVendor("CAP");
      setNewProgramName("");
      setNewCategory("");
      setNewYear(String(new Date().getFullYear()));
      setShowEnrollModal(false);
      await fetchData();
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveEnrollment = async (id: number) => {
    if (!confirm("Remove this enrollment? This will update your coverage analysis.")) return;
    await fetch(`${API_BASE}/api/pt/enrollments/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    await fetchData();
  };

  // Filter coverage rows
  const filteredCoverage = coverage.filter((row) => {
    if (filter === "all") return true;
    if (filter === "gaps") return row.status === "gap" || row.status === "recommended";
    if (filter === "covered") return row.status === "covered";
    if (filter === "waived") return row.status === "waived";
    return true;
  });

  // Plan gate
  if (!hasPlanAccess) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <FlaskConical size={48} className="mx-auto mb-4 text-[#006064]" />
        <h2 className="text-2xl font-bold mb-2">VeritaPT™</h2>
        <p className="text-muted-foreground mb-6">
          PT coverage analysis is available on all paid plans. Upgrade to see your proficiency testing gaps and program recommendations.
        </p>
        <Button asChild className="bg-[#006064] hover:bg-[#004d50] text-white">
          <Link href="/account/settings">Upgrade Plan</Link>
        </Button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <RefreshCw size={20} className="animate-spin mr-2" />
        Analyzing PT coverage...
      </div>
    );
  }

  // No test menu state
  if (!loading && coverage.length === 0) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <FlaskConical size={48} className="mx-auto mb-4 text-[#006064]" />
        <h2 className="text-2xl font-bold mb-2">VeritaPT™</h2>
        <p className="text-muted-foreground mb-6">
          No test menu found. Add your instruments and tests in VeritaMap™ to see your PT coverage analysis here.
        </p>
        <Button asChild className="bg-[#006064] hover:bg-[#004d50] text-white">
          <Link href="/veritamap">Go to VeritaMap™</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">VeritaPT™</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Proficiency Testing Coverage Analysis</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchData}
            disabled={loading}
          >
            <RefreshCw size={14} className={`mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            size="sm"
            className="bg-[#006064] hover:bg-[#004d50] text-white"
            onClick={() => setShowEnrollModal(true)}
          >
            <Plus size={14} className="mr-1.5" />
            Manage Enrollments
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4 text-center">
            <div className={`text-3xl font-bold ${(summary?.regulatedGaps ?? 0) > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
              {summary?.regulatedGaps ?? 0}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Required PT Gaps</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 text-center">
            <div className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">
              {summary?.regulatedCovered ?? 0}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Required PT Covered</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 text-center">
            <div className={`text-3xl font-bold ${(summary?.recommendedGaps ?? 0) > 0 ? "text-amber-600 dark:text-amber-400" : "text-foreground"}`}>
              {summary?.recommendedGaps ?? 0}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Recommended (Not Enrolled)</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 text-center">
            <div className="text-3xl font-bold text-muted-foreground">
              {summary?.waived ?? 0}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Waived Tests</div>
          </CardContent>
        </Card>
      </div>

      {/* Alert if regulated gaps exist */}
      {(summary?.regulatedGaps ?? 0) > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/10 dark:border-red-800 p-4">
          <AlertTriangle size={18} className="text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
          <div className="text-sm text-red-800 dark:text-red-300">
            <span className="font-semibold">{summary.regulatedGaps} regulated analyte{summary.regulatedGaps !== 1 ? "s" : ""} without PT enrollment.</span>{" "}
            CLIA requires PT enrollment for these tests. Use the program links below to find a HHS-approved program and add your enrollment.
          </div>
        </div>
      )}

      {/* Filter + Coverage Table */}
      <Card>
        <CardHeader className="py-4 px-4 border-b">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <CardTitle className="text-base font-semibold">PT Coverage by Analyte</CardTitle>
            <div className="flex gap-1.5 flex-wrap">
              {(["all", "gaps", "covered", "waived"] as FilterType[]).map((f) => (
                <Button
                  key={f}
                  variant={filter === f ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFilter(f)}
                  className={filter === f ? "bg-[#006064] hover:bg-[#004d50] text-white h-7 text-xs px-3" : "h-7 text-xs px-3"}
                >
                  {f === "all" ? "All" : f === "gaps" ? "Gaps" : f === "covered" ? "Covered" : "Waived"}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: 700 }}>
              <thead>
                <tr className="text-muted-foreground border-b text-xs bg-muted/30">
                  <th className="text-left py-2.5 px-4">Analyte</th>
                  <th className="text-left py-2.5 pr-4">Specialty</th>
                  <th className="text-left py-2.5 pr-4">PT Category</th>
                  <th className="text-left py-2.5 pr-4">Status</th>
                  <th className="text-left py-2.5 pr-4">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredCoverage.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-muted-foreground text-sm">
                      No analytes match this filter.
                    </td>
                  </tr>
                )}
                {filteredCoverage.map((row, idx) => (
                  <tr key={idx} className="border-b border-border/50 hover:bg-muted/20">
                    <td className="py-3 px-4 font-medium">
                      {row.analyteName}
                      {row.notes && (
                        <div className="text-xs text-amber-700 dark:text-amber-400 mt-0.5 flex items-start gap-1">
                          <Info size={11} className="mt-0.5 shrink-0" />
                          {row.notes}
                        </div>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-xs text-muted-foreground">{row.subspecialty || row.specialty}</td>
                    <td className="py-3 pr-4 text-xs text-muted-foreground">{row.ptCategory || "-"}</td>
                    <td className="py-3 pr-4">
                      {row.status === "gap" && (
                        <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 text-xs whitespace-nowrap font-medium">
                          PT Required - Not Enrolled
                        </Badge>
                      )}
                      {row.status === "recommended" && (
                        <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 text-xs whitespace-nowrap font-medium">
                          PT Recommended
                        </Badge>
                      )}
                      {row.status === "covered" && (
                        <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-xs whitespace-nowrap font-medium">
                          <CheckCircle2 size={11} className="mr-1" />
                          Enrolled
                        </Badge>
                      )}
                      {row.status === "waived" && (
                        <Badge className="bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400 text-xs whitespace-nowrap">
                          Waived
                        </Badge>
                      )}
                      {row.status === "no_pt_required" && (
                        <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-xs whitespace-nowrap">
                          {row.complexity ? row.complexity.charAt(0) + row.complexity.slice(1).toLowerCase() : "Moderate"} - PT Not Required
                        </Badge>
                      )}
                      {row.status === "unmatched" && (
                        <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 text-xs whitespace-nowrap">
                          Verify Complexity
                        </Badge>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      {(row.status === "gap" || row.status === "recommended") && row.ptCategory && (
                        <div className="flex items-center gap-2 flex-wrap">
                          <a
                            href="https://www.cap.org/laboratory-improvement/proficiency-testing/find-a-pt-program"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-[#006064] underline hover:no-underline"
                          >
                            CAP <ExternalLink size={10} />
                          </a>
                          <span className="text-muted-foreground text-xs">|</span>
                          <a
                            href="https://www.api-pt.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-[#006064] underline hover:no-underline"
                          >
                            API <ExternalLink size={10} />
                          </a>
                        </div>
                      )}
                      {row.status === "covered" && row.enrolledProgram && (
                        <span className="text-xs text-muted-foreground">{row.enrolledProgram}</span>
                      )}
                      {row.status === "waived" && (
                        <span className="text-xs text-muted-foreground">PT not required per CLIA</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Info Banner */}
      <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-900/10 dark:border-amber-800 p-4">
        <Info size={16} className="text-amber-700 dark:text-amber-400 mt-0.5 shrink-0" />
        <p className="text-sm text-amber-800 dark:text-amber-300">
          Unregulated nonwaived tests are not required to have PT under CLIA Subpart I, but enrolling in a PT program is strongly recommended as standard practice and may be required by your accreditation organization.
        </p>
      </div>

      {/* Manage Enrollments Modal */}
      <Dialog open={showEnrollModal} onOpenChange={setShowEnrollModal}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>PT Program Enrollments</DialogTitle>
          </DialogHeader>

          {/* Existing enrollments */}
          <div className="space-y-3">
            {enrollments.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No enrollments recorded yet.</p>
            ) : (
              <div className="overflow-x-auto rounded border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-muted-foreground border-b text-xs bg-muted/30">
                      <th className="text-left py-2 px-3">Vendor</th>
                      <th className="text-left py-2 pr-3">Program Name</th>
                      <th className="text-left py-2 pr-3">Category</th>
                      <th className="text-left py-2 pr-3">Year</th>
                      <th className="py-2 pr-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {enrollments.map((e) => (
                      <tr key={e.id} className="border-b border-border/50">
                        <td className="py-2 px-3 font-medium">{e.vendor}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{e.program_name}</td>
                        <td className="py-2 pr-3 text-muted-foreground text-xs">{e.pt_category}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{e.year_enrolled}</td>
                        <td className="py-2 pr-3">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-red-500 hover:text-red-700"
                            onClick={() => handleRemoveEnrollment(e.id)}
                          >
                            <Trash2 size={13} />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Add new enrollment */}
            <div className="rounded-lg border p-4 space-y-3 bg-muted/20">
              <p className="text-sm font-medium">Add Enrollment</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Vendor</Label>
                  <Select value={newVendor} onValueChange={setNewVendor}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {VENDORS.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Year Enrolled</Label>
                  <Input
                    type="number"
                    value={newYear}
                    onChange={(e) => setNewYear(e.target.value)}
                    className="h-8 text-sm"
                    min={2020}
                    max={2030}
                  />
                </div>
                <div className="space-y-1 col-span-2">
                  <Label className="text-xs">Program Name</Label>
                  <Input
                    value={newProgramName}
                    onChange={(e) => setNewProgramName(e.target.value)}
                    placeholder="e.g. CAP Chemistry Survey (C)"
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1 col-span-2">
                  <Label className="text-xs">PT Category</Label>
                  <Select value={newCategory} onValueChange={setNewCategory}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      {PT_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Enrolling by category covers all regulated analytes in that group.</p>
                </div>
              </div>
              <Button
                size="sm"
                className="bg-[#006064] hover:bg-[#004d50] text-white"
                onClick={handleAddEnrollment}
                disabled={saving || !newVendor || !newProgramName.trim() || !newCategory || !newYear}
              >
                {saving ? "Saving..." : "Add Enrollment"}
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEnrollModal(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
