import { useState, useEffect } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/components/AuthContext";
import { ModuleHowToCard } from "@/components/ModuleHowToCard";
import { useIsReadOnly } from "@/components/SubscriptionBanner";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { useLabRoute } from "@/hooks/useLabRoute";
import { useMemberships, allowedAccreditorsForMembership } from "@/hooks/useMemberships";
import { downloadPdfToken } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Plus, Trash2, ChevronLeft, Users, Lock, FileDown, Building2,
  CheckCircle2, AlertTriangle, Clock, UserPlus, Edit2, Calendar,
  Download, X, Upload, FileSpreadsheet, FileText, ExternalLink, Archive,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DocumentLinkDialog, STAFF_DOC_TYPES, expirationStatus } from "@/components/DocumentLinkDialog";
import { EmployeeInstrumentsPickerDialog, type LabInstrument, instrumentLabel } from "@/components/EmployeeInstrumentsPickerDialog";
import { getStaffTitleLabel, getStaffTitleGroups } from "@shared/staffTitles";

// ── Types ──────────────────────────────────────────────────────────────
interface Lab {
  id: number;
  user_id: number;
  lab_name: string;
  clia_number: string;
  lab_address_street: string;
  lab_address_city: string;
  lab_address_state: string;
  lab_address_zip: string;
  lab_phone: string;
  certificate_type: string;
  accreditation_body: string;
  accreditation_body_other: string;
  includes_nys: number;
  complexity: string;
}

interface Role {
  id: number;
  employee_id: number;
  role: string;
  specialty_number: number | null;
}

interface CompetencySchedule {
  id: number;
  employee_id: number;
  initial_completed_at: string | null;
  initial_signed_by: string | null;
  six_month_due_at: string | null;
  six_month_completed_at: string | null;
  six_month_signed_by: string | null;
  first_annual_due_at: string | null;
  first_annual_completed_at: string | null;
  first_annual_signed_by: string | null;
  annual_due_at: string | null;
  last_annual_completed_at: string | null;
  last_annual_signed_by: string | null;
  nys_six_month_due_at: string | null;
  notes: string | null;
}

interface Employee {
  id: number;
  lab_id: number;
  last_name: string;
  first_name: string;
  middle_initial: string | null;
  title: string | null;
  /** Wave F PR F2: codified credential family. Nullable when the lab has not
   *  picked one yet (legacy free-text title still rendered as fallback). */
  title_code: string | null;
  hire_date: string | null;
  /** Wave H PR H1: soft-delete metadata. Nullable for active employees. */
  terminated_at: string | null;
  termination_reason: string | null;
  qualifications_text: string | null;
  highest_complexity: string;
  performs_testing: number;
  status: string;
  roles: Role[];
  competencySchedule: CompetencySchedule | null;
}

const CMS_SPECIALTIES: Record<number, string> = {
  1: "Bacteriology", 2: "Mycobacteriology", 3: "Mycology", 4: "Parasitology",
  5: "Virology", 6: "Diagnostic Immunology", 7: "Chemistry", 8: "Hematology",
  9: "Immunohematology", 10: "Radiobioassay", 11: "Cytology", 12: "Histopathology",
  13: "Dermatopathology", 14: "Ophthalmic Pathology", 15: "Oral Pathology",
  16: "Histocompatibility", 17: "Clinical Cytogenetics",
};

const ACCREDITORS = [
  { value: "TJC", label: "The Joint Commission (TJC)" },
  { value: "CAP", label: "College of American Pathologists (CAP)" },
  { value: "COLA", label: "COLA" },
  { value: "CLIA_ONLY", label: "CLIA Only" },
  { value: "OTHER", label: "Other" },
];

function getCompetencyStatus(schedule: CompetencySchedule | null): { label: string; color: string } {
  // The other branches all return text + bg + border so the Badge renders
  // legibly against any page surface. The "Not set" branch used to return
  // only `text-muted-foreground`, which let the default Badge variant
  // paint the badge teal (bg-primary) and the text muted gray, producing
  // gray-on-teal that failed contrast in both light and dark modes
  // (customer report 2026-06-05 on San Carlos / Ria's session).
  if (!schedule) return { label: "Not set", color: "text-muted-foreground bg-muted/40 border-muted-foreground/30" };

  const now = new Date();
  const checkDue = (dueStr: string | null, completedStr: string | null) => {
    if (!dueStr) return null;
    if (completedStr) return null; // completed
    const due = new Date(dueStr);
    const daysUntil = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (daysUntil < 0) return "overdue";
    if (daysUntil <= 30) return "due-soon";
    return "current";
  };

  const statuses = [
    checkDue(schedule.six_month_due_at, schedule.six_month_completed_at),
    checkDue(schedule.first_annual_due_at, schedule.first_annual_completed_at),
    checkDue(schedule.annual_due_at, schedule.last_annual_completed_at),
  ].filter(Boolean);

  if (statuses.includes("overdue")) return { label: "Overdue", color: "text-red-600 bg-red-500/10 border-red-500/20" };
  if (statuses.includes("due-soon")) return { label: "Due Soon", color: "text-amber-600 bg-amber-500/10 border-amber-500/20" };
  return { label: "Current", color: "text-emerald-600 bg-emerald-500/10 border-emerald-500/20" };
}

// ── Main Component ──────────────────────────────────────────────────────

export default function VeritaStaffAppPage() {
  const { user, isLoggedIn } = useAuth();
  const readOnly = useIsReadOnly('veritastaff');
  const [, navigate] = useLocation();
  const params = useParams<{ employeeId?: string }>();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [showLabSetup, setShowLabSetup] = useState(false);
  const [showAddEmployee, setShowAddEmployee] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [showCompetency, setShowCompetency] = useState<Employee | null>(null);
  const [generating209, setGenerating209] = useState(false);
  const [generatingPacket, setGeneratingPacket] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);

  // Auth + plan check
  const hasAccess = isLoggedIn && !!user?.plan && user.plan !== "free" && user.plan !== "per_study";

  // Multi-Lab Tier 2 Phase 3.9b: entry-surface lab-scope. staff_labs uses
  // tier2_lab_id (FK to labs) since the legacy lab_id column on
  // staff_employees / staff_roles points at staff_labs(id), not labs(id).
  const activeLabId = useActiveLabId();
  const labRoute = useLabRoute();
  const labKey = activeLabId ? `/api/labs/${activeLabId}/staff/lab` : `/api/staff/lab`;
  const empKey = activeLabId ? `/api/labs/${activeLabId}/staff/employees` : `/api/staff/employees`;

  // Lab-aware accreditor gating: filter the staff_labs accreditation dropdown
  // to the bodies the master labs record is flagged for, plus always-allowed
  // CLIA_ONLY (every lab holds CLIA) and OTHER (escape hatch). The helper
  // returns CMS/Other in its always-allowed set; translate to this module's
  // value names (CLIA_ONLY/OTHER). VeritaStaff has no AABB option, so AABB
  // from the flag set is simply ignored here.
  const { data: memberships } = useMemberships();
  const activeMembership = memberships?.find(m => m.labId === activeLabId) ?? null;
  const labFlagAllowed = allowedAccreditorsForMembership(activeMembership);
  const isStaffAccreditorAllowed = (value: string): boolean => {
    if (value === 'CLIA_ONLY' || value === 'OTHER') return true;
    return labFlagAllowed.has(value); // CAP, TJC, COLA matched 1:1
  };

  // Fetch lab
  const { data: lab, isLoading: labLoading } = useQuery<Lab | null>({
    queryKey: [labKey],
    enabled: !!hasAccess,
  });

  // Fetch employees
  const { data: employees = [], isLoading: empLoading } = useQuery<Employee[]>({
    queryKey: [empKey],
    enabled: !!hasAccess && !!lab,
  });

  // PR E2 hotfix (2026-06-05): the dashboard-stats endpoint is the single
  // source of truth for the overdue set. Both the tile on the dashboard and
  // the ?filter=overdue list in this page share it, so the counts cannot
  // drift. Without this, the client-side getCompetencyStatus helper (which
  // does not check Initial competency) classified zero employees as overdue
  // while the server classified three.
  const dashStatsUrl = activeLabId ? `/api/labs/${activeLabId}/competency/dashboard-stats` : null;
  const { data: dashStats } = useQuery<{ overdueIds: number[] }>({
    queryKey: [dashStatsUrl ?? "no-dash-stats"],
    queryFn: async () => {
      if (!dashStatsUrl) return { overdueIds: [] };
      const r = await fetch(`${API_BASE}${dashStatsUrl}`, { headers: authHeaders() });
      if (!r.ok) return { overdueIds: [] };
      return r.json();
    },
    enabled: !!dashStatsUrl,
  });
  const overdueIdsSet = new Set<number>(dashStats?.overdueIds ?? []);

  // Wave F PR F3 (2026-06-06): same single-source-of-truth pattern as PR
  // E2's overdueIds. The credentials-dashboard-stats endpoint owns the
  // expiringEmployeeIds set so the tile count and the ?filter=expiring
  // banner cannot drift. Window is the server's default 60 days.
  const credStatsUrl = activeLabId ? `/api/labs/${activeLabId}/staff/credentials-dashboard-stats` : null;
  const { data: credStats } = useQuery<{ expiringEmployeeIds: number[] }>({
    queryKey: [credStatsUrl ?? "no-cred-stats"],
    queryFn: async () => {
      if (!credStatsUrl) return { expiringEmployeeIds: [] };
      const r = await fetch(`${API_BASE}${credStatsUrl}`, { headers: authHeaders() });
      if (!r.ok) return { expiringEmployeeIds: [] };
      return r.json();
    },
    enabled: !!credStatsUrl,
  });
  const expiringEmployeeIdsSet = new Set<number>(credStats?.expiringEmployeeIds ?? []);

  // If URL has employeeId, show that employee detail
  const selectedEmployee = params.employeeId
    ? employees.find((e) => e.id === Number(params.employeeId))
    : null;

  // Auto-show lab setup if no lab exists
  useEffect(() => {
    if (!labLoading && hasAccess && lab === null) {
      setShowLabSetup(true);
    }
  }, [lab, labLoading, hasAccess]);

  if (!isLoggedIn) {
    return (
      <div className="container-default py-20 text-center">
        <Lock size={40} className="text-muted-foreground mx-auto mb-4" />
        <h2 className="font-serif text-2xl font-bold mb-2">Sign in to use VeritaStaff{"™"}</h2>
        <p className="text-muted-foreground mb-6">Manage your laboratory personnel, CLIA roles, and CMS 209 reports.</p>
        <Button asChild><Link href="/login">Sign In</Link></Button>
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="container-default py-20 text-center">
        <Lock size={40} className="text-muted-foreground mx-auto mb-4" />
        <h2 className="font-serif text-2xl font-bold mb-2">VeritaStaff{"™"} requires a Professional plan or above</h2>
        <p className="text-muted-foreground mb-6">Upgrade your subscription to access personnel management features.</p>
        <Button asChild><Link href="/veritastaff">Learn More</Link></Button>
      </div>
    );
  }

  // ── Employee Detail View ──
  if (selectedEmployee) {
    return (
      <>
        <EmployeeDetailView
          employee={selectedEmployee}
          lab={lab!}
          onBack={() => navigate(activeLabId ? `/labs/${activeLabId}/veritastaff-app` : "/veritastaff-app")}
          onEdit={() => setEditingEmployee(selectedEmployee)}
          onCompetency={() => setShowCompetency(selectedEmployee)}
        />
        {/* Edit dialog — must be mounted here so the Edit button inside the detail view actually opens it. */}
        <EmployeeDialog
          open={!!editingEmployee}
          onOpenChange={(open) => { if (!open) setEditingEmployee(null); }}
          employee={editingEmployee}
          lab={lab ?? null}
        />
        {/* Competency dialog — same reasoning: detail-view's onCompetency only works if it is mounted in this branch. */}
        {showCompetency && (
          <CompetencyDialog
            open={!!showCompetency}
            onOpenChange={(open) => { if (!open) setShowCompetency(null); }}
            employee={showCompetency}
            lab={lab!}
          />
        )}
      </>
    );
  }

  return (
    <div className="container-default py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="font-serif text-3xl font-bold flex items-center gap-2">
            <Building2 size={28} className="text-primary" />
            VeritaStaff{"™"}
          </h1>
          {lab && (
            <p className="text-muted-foreground mt-1">
              {lab.lab_name} &middot; CLIA: {lab.clia_number}
              <button onClick={() => setShowLabSetup(true)} className="ml-2 text-primary text-xs hover:underline">(Edit Lab)</button>
            </p>
          )}
        </div>
      <ModuleHowToCard
        moduleKey="veritastaff"
        moduleName="VeritaStaff™"
        whatItDoes="VeritaStaff is the personnel roster with CLIA role assignments (Laboratory Director, Technical Consultant, Technical Supervisor, General Supervisor, Testing Personnel) and specialty tracking. Auto-generates the CMS 209 Laboratory Personnel Report."
        howToUse={[
          "Add each staff member with their CLIA role, qualifications, and assigned specialties.",
          "Update credentials, license expirations, and training records as they change.",
          "Generate the CMS 209 Laboratory Personnel Report with one click when CMS asks.",
          "Cross-link to VeritaComp for the competency side of each staff member.",
          "Run the roster view weekly to see who is current, who is due, and who is overdue."
        ]}
      />

        <div className="flex gap-2">
          {lab && (
            <>
              <Button variant="outline" size="sm" onClick={() => setShowAddEmployee(true)} disabled={readOnly}>
                <UserPlus size={14} className="mr-1.5" /> Add Employee
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowBulkImport(true)} disabled={readOnly}>
                <Upload size={14} className="mr-1.5" /> Bulk Import
              </Button>
              <Button size="sm" className="bg-primary hover:bg-primary/90" onClick={handleGenerate209} disabled={generating209 || readOnly}>
                <FileDown size={14} className="mr-1.5" /> {generating209 ? "Generating..." : "Generate CMS 209"}
              </Button>
              {/* Wave G PR G5 (2026-06-06): one-click Day-1 survey packet.
                  Surveyor walks in, lab director clicks once, downloads
                  appear: CMS-209 personnel report + locked competency
                  bundle (last 12 months). Two files because the bundle is
                  already a zip; wrapping a zip in another zip is the
                  worst experience for the surveyor on the other end. */}
              <Button
                size="sm"
                variant="outline"
                onClick={handleDayOnePacket}
                disabled={generatingPacket || readOnly}
                title="One click: CMS-209 + locked competency bundle (last 12 months)"
              >
                <Archive size={14} className="mr-1.5" />
                {generatingPacket ? "Building packet..." : "Day-1 Survey Packet"}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* PR E2 (2026-06-05): respect ?filter=overdue from the dashboard tile
          drilldown. Limits the rendered list to performs_testing employees
          whose competency status resolves to Overdue. Shows a "Showing overdue
          only" banner with a Clear link so the user can return to the full
          roster without typing in the address bar. */}
      {(() => {
        const filter = (typeof window !== "undefined") ? new URLSearchParams(window.location.search).get("filter") : null;
        if (filter !== "overdue") return null;
        return (
          <div className="mb-3 flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
            <AlertTriangle size={12} className="text-amber-600" />
            <span className="font-medium">Showing {overdueIdsSet.size} overdue testing personnel.</span>
            <button
              onClick={() => navigate(labRoute("/veritastaff-app"))}
              className="ml-auto text-primary hover:underline"
            >
              Clear filter
            </button>
          </div>
        );
      })()}

      {/* Wave F PR F3: same banner pattern for ?filter=expiring driven by the
          CredentialExpirationTile drilldown. Limits to employees with at
          least one credential expired or expiring within 60 days. */}
      {(() => {
        const filter = (typeof window !== "undefined") ? new URLSearchParams(window.location.search).get("filter") : null;
        if (filter !== "expiring") return null;
        return (
          <div className="mb-3 flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
            <Clock size={12} className="text-amber-600" />
            <span className="font-medium">Showing {expiringEmployeeIdsSet.size} personnel with credentials expiring within 60 days.</span>
            <button
              onClick={() => navigate(labRoute("/veritastaff-app"))}
              className="ml-auto text-primary hover:underline"
            >
              Clear filter
            </button>
          </div>
        );
      })()}

      {/* Employee List */}
      {empLoading ? (
        <p className="text-muted-foreground">Loading employees...</p>
      ) : employees.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Users size={40} className="text-muted-foreground mx-auto mb-4" />
            <h3 className="font-semibold text-lg mb-2">No employees yet</h3>
            <p className="text-sm text-muted-foreground mb-4">Add your first employee to get started with CLIA role assignments.</p>
            <Button onClick={() => setShowAddEmployee(true)} disabled={readOnly}>
              <UserPlus size={14} className="mr-1.5" /> Add Employee
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {employees
            .filter(emp => {
              const filter = (typeof window !== "undefined") ? new URLSearchParams(window.location.search).get("filter") : null;
              if (filter === "overdue") return overdueIdsSet.has(emp.id);
              if (filter === "expiring") return expiringEmployeeIdsSet.has(emp.id);
              return true;
            })
            .map((emp) => {
            const compStatus = getCompetencyStatus(emp.competencySchedule);
            const roleNames = Array.from(new Set(emp.roles.map((r) => r.role)));
            return (
              <Card key={emp.id} className="hover:border-primary/30 transition-colors cursor-pointer" onClick={() => navigate(labRoute(`/veritastaff-app/${emp.id}`))}>
                <CardContent className="py-4 px-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div>
                        <div className="font-semibold">
                          {emp.last_name}, {emp.first_name}{emp.middle_initial ? ` ${emp.middle_initial}.` : ""}
                          {emp.title && <span className="text-muted-foreground font-normal ml-1.5">{emp.title}</span>}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          Hired: {emp.hire_date || "N/A"} &middot; {emp.highest_complexity === "H" ? "High" : "Moderate"} complexity
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {roleNames.map((r) => (
                        <Badge key={r} variant="outline" className="font-mono text-xs">{r}</Badge>
                      ))}
                      {emp.performs_testing === 1 && (
                        <Badge className={`text-xs border ${compStatus.color}`}>{compStatus.label}</Badge>
                      )}
                      <Badge variant="outline" className="text-xs">{emp.highest_complexity}</Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Lab Setup Dialog */}
      <LabSetupDialog open={showLabSetup} onOpenChange={setShowLabSetup} lab={lab ?? null} isStaffAccreditorAllowed={isStaffAccreditorAllowed} />

      {/* Add/Edit Employee Dialog */}
      <EmployeeDialog
        open={showAddEmployee || !!editingEmployee}
        onOpenChange={(open) => { if (!open) { setShowAddEmployee(false); setEditingEmployee(null); } }}
        employee={editingEmployee}
        lab={lab ?? null}
      />

      {/* Competency Dialog */}
      {showCompetency && (
        <CompetencyDialog
          open={!!showCompetency}
          onOpenChange={(open) => { if (!open) setShowCompetency(null); }}
          employee={showCompetency}
          lab={lab!}
        />
      )}

      {/* Bulk Import Dialog */}
      {lab && (
        <BulkImportDialog
          open={showBulkImport}
          onOpenChange={setShowBulkImport}
          lab={lab}
        />
      )}
    </div>
  );

  async function handleGenerate209() {
    setGenerating209(true);
    try {
      const cms209Url = activeLabId
        ? `${API_BASE}/api/labs/${activeLabId}/staff/cms209`
        : `${API_BASE}/api/staff/cms209`;
      const res = await fetch(cms209Url, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error(await res.text());
      const { token } = await res.json();
      downloadPdfToken(token, `CMS_209_${lab?.clia_number || "report"}_${new Date().toISOString().split("T")[0]}.pdf`);
      toast({ title: "CMS 209 generated", description: "Your personnel report has been downloaded." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setGenerating209(false);
    }
  }

  // Wave G PR G5 (2026-06-06). Day-1 survey packet: one click, two
  // downloads — CMS-209 personnel report + the last-12-months VeritaComp
  // locked survey bundle. Composed client-side rather than server-side
  // because the survey bundle is already a zip, and wrapping a zip in
  // another zip is hostile UX for the surveyor on the other end (extra
  // unzip step, blurred file dates, lost folder structure).
  //
  //
  // The two downloads land in the browser's downloads tray side by side,
  // both stamped with today's date and the lab's CLIA number so the lab
  // director can drop them straight into a shared folder for the survey
  // visit.
  async function handleDayOnePacket() {
    if (!activeLabId) {
      toast({ title: "Active lab required", description: "Switch to the lab you are preparing for survey." });
      return;
    }
    setGeneratingPacket(true);
    try {
      const today = new Date().toISOString().split("T")[0];
      const cliaTag = lab?.clia_number || "lab";

      // Step 1: CMS-209 personnel report.
      const cms209Res = await fetch(`${API_BASE}/api/labs/${activeLabId}/staff/cms209`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
      });
      if (!cms209Res.ok) throw new Error(`CMS-209: ${await cms209Res.text()}`);
      const cms209Json = await cms209Res.json();
      downloadPdfToken(cms209Json.token, `Day1_Packet_${cliaTag}_${today}_1of2_CMS_209.pdf`);

      // Step 2: VeritaComp locked survey bundle (last 12 months).
      const bundleRes = await fetch(`${API_BASE}/api/labs/${activeLabId}/competency/survey-bundle`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ periodMonths: 12 }),
      });
      if (!bundleRes.ok) {
        // 404 with periodMonths means no locked assessments in the
        // window — surface that as an info toast, not an error, because
        // the CMS-209 part still succeeded.
        if (bundleRes.status === 404) {
          toast({
            title: "Day-1 packet partially ready",
            description: "CMS-209 downloaded. No locked competency assessments in the last 12 months. Sign and complete some, then re-run for the bundle.",
          });
          return;
        }
        throw new Error(`Survey bundle: ${await bundleRes.text()}`);
      }
      const bundleJson = await bundleRes.json();
      // Survey-bundle returns its own filename and uses the same token
      // store; we just open the zip endpoint with the token.
      const a = document.createElement("a");
      a.href = `${API_BASE}/api/zip/${bundleJson.token}`;
      a.download = `Day1_Packet_${cliaTag}_${today}_2of2_${bundleJson.filename || "Bundle.zip"}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      toast({
        title: "Day-1 packet ready",
        description: `2 files downloaded: CMS-209 + ${bundleJson.count} locked competency assessment(s) covering the last 12 months.`,
      });
    } catch (err: any) {
      toast({ title: "Packet failed", description: err.message, variant: "destructive" });
    } finally {
      setGeneratingPacket(false);
    }
  }
}

// ── Lab Setup Dialog ──────────────────────────────────────────────────

function LabSetupDialog({ open, onOpenChange, lab, isStaffAccreditorAllowed }: { open: boolean; onOpenChange: (v: boolean) => void; lab: Lab | null; isStaffAccreditorAllowed: (value: string) => boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const activeLabId = useActiveLabId();
  const [form, setForm] = useState({
    labName: lab?.lab_name || "",
    cliaNumber: lab?.clia_number || "",
    street: lab?.lab_address_street || "",
    city: lab?.lab_address_city || "",
    state: lab?.lab_address_state || "",
    zip: lab?.lab_address_zip || "",
    phone: lab?.lab_phone || "",
    certificateType: lab?.certificate_type || "compliance",
    accreditationBody: lab?.accreditation_body || "CLIA_ONLY",
    accreditationBodyOther: lab?.accreditation_body_other || "",
    includesNys: lab?.includes_nys === 1,
    complexity: lab?.complexity || "high",
  });
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (lab) {
      setForm({
        labName: lab.lab_name, cliaNumber: lab.clia_number,
        street: lab.lab_address_street, city: lab.lab_address_city,
        state: lab.lab_address_state, zip: lab.lab_address_zip,
        phone: lab.lab_phone, certificateType: lab.certificate_type,
        accreditationBody: lab.accreditation_body,
        accreditationBodyOther: lab.accreditation_body_other || "",
        includesNys: lab.includes_nys === 1, complexity: lab.complexity,
      });
    }
  }, [lab]);

  async function loadSuggestions() {
    try {
      const suggestionsUrl = activeLabId
        ? `${API_BASE}/api/labs/${activeLabId}/staff/veritamap-suggestions`
        : `${API_BASE}/api/staff/veritamap-suggestions`;
      const res = await fetch(suggestionsUrl, { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setSuggestions(data);
        if (data.length > 0) toast({ title: "VeritaMap™ departments found", description: `${data.length} department(s) can be mapped to CMS specialties.` });
        else toast({ title: "No VeritaMap™ departments", description: "No maps found. You can still set up specialties manually." });
      }
    } catch {}
  }

  async function handleSave() {
    if (!form.labName.trim() || !form.cliaNumber.trim()) {
      toast({ title: "Error", description: "Lab name and CLIA number are required.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const labUrl = activeLabId
        ? `${API_BASE}/api/labs/${activeLabId}/staff/lab`
        : `${API_BASE}/api/staff/lab`;
      const res = await fetch(labUrl, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(await res.text());
      await queryClient.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).endsWith('/staff/lab') });
      toast({ title: "Lab saved" });
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{lab ? "Edit Lab Setup" : "Lab Setup"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">Lab Name *</label>
            <Input value={form.labName} onChange={(e) => setForm({ ...form, labName: e.target.value })} placeholder="e.g., Riverside Regional Medical Center" />
          </div>
          <div>
            <label className="text-sm font-medium">CLIA Number *</label>
            <Input value={form.cliaNumber} onChange={(e) => setForm({ ...form, cliaNumber: e.target.value })} placeholder="e.g., 05D2187634" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Street</label>
              <Input value={form.street} onChange={(e) => setForm({ ...form, street: e.target.value })} />
            </div>
            <div>
              <label className="text-sm font-medium">City</label>
              <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-sm font-medium">State</label>
              <Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} maxLength={2} />
            </div>
            <div>
              <label className="text-sm font-medium">ZIP</label>
              <Input value={form.zip} onChange={(e) => setForm({ ...form, zip: e.target.value })} />
            </div>
            <div>
              <label className="text-sm font-medium">Phone</label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">Accreditation Body</label>
            <Select value={form.accreditationBody} onValueChange={(v) => setForm({ ...form, accreditationBody: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ACCREDITORS
                  .filter(a => isStaffAccreditorAllowed(a.value) || a.value === form.accreditationBody)
                  .map((a) => {
                    const isLegacy = !isStaffAccreditorAllowed(a.value);
                    return (
                      <SelectItem key={a.value} value={a.value}>
                        {a.label}{isLegacy ? " (legacy, lab no longer flagged)" : ""}
                      </SelectItem>
                    );
                  })}
              </SelectContent>
            </Select>
          </div>
          {form.accreditationBody === "OTHER" && (
            <div>
              <label className="text-sm font-medium">Other Accreditation Body</label>
              <Input value={form.accreditationBodyOther} onChange={(e) => setForm({ ...form, accreditationBodyOther: e.target.value })} />
            </div>
          )}
          <div className="flex items-center gap-2">
            <input type="checkbox" checked={form.includesNys} onChange={(e) => setForm({ ...form, includesNys: e.target.checked })} id="nys" />
            <label htmlFor="nys" className="text-sm">Also operates under New York State requirements</label>
          </div>
          <div>
            <label className="text-sm font-medium">Testing Complexity</label>
            <Select value={form.complexity} onValueChange={(v) => setForm({ ...form, complexity: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="moderate">Moderate</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="both">Both</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" size="sm" onClick={loadSuggestions} className="w-full">
            Import departments from VeritaMap{"™"}
          </Button>
          {suggestions.length > 0 && (
            <div className="bg-muted/50 rounded-lg p-3 text-sm">
              <p className="font-medium mb-2">Suggested CMS Specialties from VeritaMap™:</p>
              {suggestions.map((s: any) => (
                <div key={s.department} className="flex gap-2 text-xs mb-1">
                  <span className="font-medium">{s.department}:</span>
                  <span className="text-muted-foreground">{s.specialties.map((sp: any) => `${sp.number} (${sp.name})`).join(", ")}</span>
                </div>
              ))}
              <p className="text-xs text-muted-foreground mt-2">These will be suggested when assigning TC/TS specialties to employees.</p>
            </div>
          )}
          <div className="flex gap-2 pt-2">
            <Button onClick={handleSave} disabled={saving} className="flex-1">{saving ? "Saving..." : "Save Lab"}</Button>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Add/Edit Employee Dialog ──────────────────────────────────────────

function EmployeeDialog({ open, onOpenChange, employee, lab }: {
  open: boolean; onOpenChange: (v: boolean) => void; employee: Employee | null; lab: Lab | null;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const activeLabId = useActiveLabId();
  const isEdit = !!employee;

  const [form, setForm] = useState({
    lastName: "", firstName: "", middleInitial: "", title: "", titleCode: "",
    hireDate: "", qualificationsText: "", highestComplexity: "H",
    performsTesting: true,
  });
  const [roles, setRoles] = useState<{ role: string; specialtyNumber: number | null }[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (employee) {
      setForm({
        lastName: employee.last_name, firstName: employee.first_name,
        middleInitial: employee.middle_initial || "", title: employee.title || "",
        titleCode: employee.title_code || "",
        hireDate: employee.hire_date || "", qualificationsText: employee.qualifications_text || "",
        highestComplexity: employee.highest_complexity, performsTesting: employee.performs_testing === 1,
      });
      setRoles(employee.roles.map((r) => ({ role: r.role, specialtyNumber: r.specialty_number })));
    } else {
      setForm({ lastName: "", firstName: "", middleInitial: "", title: "", titleCode: "", hireDate: "", qualificationsText: "", highestComplexity: "H", performsTesting: true });
      setRoles([]);
    }
  }, [employee, open]);

  const complexity = lab?.complexity || "high";
  const availableRoles = (() => {
    if (complexity === "moderate") return ["LD", "CC", "TC", "TP"];
    if (complexity === "high") return ["LD", "CC", "TS", "GS", "TP"];
    return ["LD", "CC", "TC", "TS", "GS", "TP"]; // both
  })();

  function toggleRole(role: string) {
    const existing = roles.filter((r) => r.role === role);
    if (existing.length > 0) {
      setRoles(roles.filter((r) => r.role !== role));
    } else {
      if (role === "TC" || role === "TS") {
        setRoles([...roles, { role, specialtyNumber: null }]);
      } else {
        setRoles([...roles, { role, specialtyNumber: null }]);
      }
    }
  }

  function addSpecialty(role: string, specNum: number) {
    if (roles.some((r) => r.role === role && r.specialtyNumber === specNum)) return;
    setRoles([...roles, { role, specialtyNumber: specNum }]);
  }

  function removeSpecialty(role: string, specNum: number) {
    setRoles(roles.filter((r) => !(r.role === role && r.specialtyNumber === specNum)));
  }

  async function handleSave() {
    if (!form.lastName.trim() || !form.firstName.trim()) {
      toast({ title: "Error", description: "Name is required.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const baseUrl = activeLabId
        ? `${API_BASE}/api/labs/${activeLabId}/staff/employees`
        : `${API_BASE}/api/staff/employees`;
      const url = isEdit ? `${baseUrl}/${employee!.id}` : baseUrl;
      const method = isEdit ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, roles }),
      });
      if (!res.ok) throw new Error(await res.text());
      await queryClient.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).endsWith('/staff/employees') });
      toast({ title: isEdit ? "Employee updated" : "Employee added" });
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const hasLD = roles.some((r) => r.role === "LD");
  const tcSpecs = roles.filter((r) => r.role === "TC").map((r) => r.specialtyNumber).filter(Boolean) as number[];
  const tsSpecs = roles.filter((r) => r.role === "TS").map((r) => r.specialtyNumber).filter(Boolean) as number[];
  const hasTC = roles.some((r) => r.role === "TC");
  const hasTS = roles.some((r) => r.role === "TS");

  // Wave G PR G6 (2026-06-06). Inline CLIA role qualification reminders.
  // Paraphrased from 42 CFR §§493.1405, 493.1411, 493.1417, 493.1441,
  // 493.1443, 493.1447, 493.1449, 493.1461, 493.1489. Specific board
  // certifications and grandfather clauses are summarized; the cite gives
  // the lab director the exact regulation to consult before hiring.
  // Surfaced only when a role is selected so the dialog stays compact for
  // labs that just want to add a TP and move on.
  const CLIA_ROLE_QUALIFICATIONS: Record<string, { high: string; moderate: string }> = {
    LD: {
      high: "MD/DO/DPM with 1 year of high-complexity laboratory training/experience after residency; or PhD in a chemical/biological/clinical lab science with board certification (ABCC, ABMG, ABMM, ABMS, etc.). 42 CFR §493.1443.",
      moderate: "MD/DO/DPM, or PhD with board certification, or MS/BS in chemical/biological/clinical lab science with documented training and experience. 42 CFR §493.1405.",
    },
    CC: {
      high: "MD/DO with current license and qualified by training and experience to consult on patient testing. 42 CFR §493.1417.",
      moderate: "Same as high complexity. 42 CFR §493.1417.",
    },
    TC: {
      high: "Not used at high complexity (see TS instead).",
      moderate: "MD/DO/DPM; or PhD/MS/BS in chemical/biological/clinical lab science with 1-2 years experience in the assigned specialty. 42 CFR §493.1411.",
    },
    TS: {
      high: "MD/DO/DPM with 1 year specialty experience; or PhD with 1 year experience and specialty-specific board certification; or MS with 2 years of high-complexity testing experience in the specialty. 42 CFR §493.1449.",
      moderate: "Not used at moderate complexity (see TC instead).",
    },
    GS: {
      high: "MD/DO/DPM, or PhD/MS, or BS with 2 years of high-complexity testing experience, or AS with 2 years of high-complexity experience plus 20 CEUs. 42 CFR §493.1461.",
      moderate: "Not used at moderate complexity. 42 CFR §493.1459.",
    },
    TP: {
      high: "MD/DO/DPM, or PhD/MS/BS in chemical/biological/clinical lab science, or AS/equivalent with documented training and experience. 42 CFR §493.1489.",
      moderate: "MD/DO/DPM, PhD/MS/BS, AS, or high school diploma/GED with documented training before reporting patient results. 42 CFR §§493.1421-1423.",
    },
  };
  const complexityForQual: "high" | "moderate" = complexity === "moderate" ? "moderate" : "high";
  const activeRolesForReminder = Array.from(new Set(roles.map(r => r.role)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Employee" : "Add Employee"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-5 gap-3">
            <div className="col-span-2">
              <label className="text-sm font-medium">Last Name *</label>
              <Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
            </div>
            <div className="col-span-2">
              <label className="text-sm font-medium">First Name *</label>
              <Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
            </div>
            <div>
              <label className="text-sm font-medium">MI</label>
              <Input value={form.middleInitial} onChange={(e) => setForm({ ...form, middleInitial: e.target.value })} maxLength={1} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Credentials/Title</label>
              {/* Wave F PR F2: controlled vocabulary with free-text "Other" escape hatch.
                  Picking a canonical code populates `title` with the display label so the
                  surveyor-facing rendering (employee cards, list rows) stays unchanged.
                  Picking OTHER reveals the free-text Input below, which writes directly
                  to `title` while title_code stays "OTHER" for query stability. */}
              <Select
                value={form.titleCode || "__none"}
                onValueChange={(v) => {
                  if (v === "__none") {
                    setForm({ ...form, titleCode: "", title: "" });
                  } else if (v === "OTHER") {
                    // Keep whatever the lab already typed in `title`; only the code changes.
                    setForm({ ...form, titleCode: "OTHER" });
                  } else {
                    setForm({ ...form, titleCode: v, title: getStaffTitleLabel(v) });
                  }
                }}
              >
                <SelectTrigger><SelectValue placeholder="Select credential…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">(not specified)</SelectItem>
                  {Object.entries(getStaffTitleGroups()).map(([group, opts]) => (
                    <SelectGroup key={group}>
                      <SelectLabel>{group}</SelectLabel>
                      {opts.map((o) => (
                        <SelectItem key={o.code} value={o.code}>{o.label}</SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
              {form.titleCode === "OTHER" && (
                <Input
                  className="mt-2"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="Type credential exactly as written…"
                />
              )}
            </div>
            <div>
              <label className="text-sm font-medium">Hire Date</label>
              <Input type="date" value={form.hireDate} onChange={(e) => setForm({ ...form, hireDate: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">Qualifications</label>
            <Textarea value={form.qualificationsText} onChange={(e) => setForm({ ...form, qualificationsText: e.target.value })} placeholder="Degree, certification, years of experience..." rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Highest Complexity</label>
              <Select value={form.highestComplexity} onValueChange={(v) => setForm({ ...form, highestComplexity: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="M">Moderate (M)</SelectItem>
                  <SelectItem value="H">High (H)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end pb-2">
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={form.performsTesting} onChange={(e) => setForm({ ...form, performsTesting: e.target.checked })} id="performs-testing" />
                <label htmlFor="performs-testing" className="text-sm">Performs patient testing</label>
              </div>
            </div>
          </div>

          {/* Role Assignment */}
          <div>
            <label className="text-sm font-medium mb-2 block">CLIA Role Assignments</label>
            {hasLD && (
              <p className="text-xs text-amber-600 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-1 mb-2">
                The Laboratory Director does not need to be listed as CC, TC, TS, or GS. Those are delegated positions.
              </p>
            )}
            <div className="flex flex-wrap gap-2 mb-3">
              {availableRoles.map((r) => {
                const active = roles.some((ro) => ro.role === r);
                return (
                  <button key={r} onClick={() => toggleRole(r)}
                    className={`px-3 py-1.5 rounded-md text-xs font-mono font-bold border transition-colors ${active ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border hover:border-primary/50"}`}>
                    {r}
                  </button>
                );
              })}
            </div>

            {/* Wave G PR G6 (2026-06-06): inline CLIA qualification reminders.
                Surfaces minimum personnel requirements per selected role at
                the lab's complexity, paraphrased from 42 CFR §493 Subpart M.
                The dialog stays compact when no role is selected. */}
            {activeRolesForReminder.length > 0 && (
              <div className="mb-3 rounded-md border border-blue-500/30 bg-blue-500/5 px-3 py-2">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-blue-800 mb-1.5">
                  Minimum CLIA qualifications ({complexityForQual} complexity)
                </div>
                <ul className="space-y-1 text-[11px] text-blue-900">
                  {activeRolesForReminder.map(role => {
                    const entry = CLIA_ROLE_QUALIFICATIONS[role];
                    if (!entry) return null;
                    return (
                      <li key={role} className="flex gap-1.5">
                        <span className="font-mono font-bold shrink-0">{role}:</span>
                        <span className="leading-snug">{entry[complexityForQual]}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* TC Specialties */}
            {hasTC && (
              <div className="mb-3">
                <label className="text-xs font-medium text-muted-foreground mb-1 block">TC Specialties (moderate complexity)</label>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(CMS_SPECIALTIES).map(([num, name]) => {
                    const n = Number(num);
                    const active = tcSpecs.includes(n);
                    return (
                      <button key={`tc-${n}`} onClick={() => active ? removeSpecialty("TC", n) : addSpecialty("TC", n)}
                        className={`px-2 py-0.5 rounded text-xs border transition-colors ${active ? "bg-blue-500/20 text-blue-700 border-blue-500/30" : "bg-card border-border hover:border-blue-500/30"}`}>
                        {n}. {name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* TS Specialties */}
            {hasTS && (
              <div className="mb-3">
                <label className="text-xs font-medium text-muted-foreground mb-1 block">TS Specialties (high complexity)</label>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(CMS_SPECIALTIES).map(([num, name]) => {
                    const n = Number(num);
                    const active = tsSpecs.includes(n);
                    return (
                      <button key={`ts-${n}`} onClick={() => active ? removeSpecialty("TS", n) : addSpecialty("TS", n)}
                        className={`px-2 py-0.5 rounded text-xs border transition-colors ${active ? "bg-emerald-500/20 text-emerald-700 border-emerald-500/30" : "bg-card border-border hover:border-emerald-500/30"}`}>
                        {n}. {name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <p className="text-xs text-muted-foreground">Use a separate line on the CMS 209 for each specialty. VeritaStaff{"™"} handles this automatically.</p>
          </div>

          <div className="flex gap-2 pt-2">
            <Button onClick={handleSave} disabled={saving} className="flex-1">{saving ? "Saving..." : isEdit ? "Update Employee" : "Add Employee"}</Button>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Competency Schedule Dialog ──────────────────────────────────────

function CompetencyDialog({ open, onOpenChange, employee, lab }: {
  open: boolean; onOpenChange: (v: boolean) => void; employee: Employee; lab: Lab;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const activeLabId = useActiveLabId();
  const s = employee.competencySchedule;
  const includesTJCorCAP = ["TJC", "CAP"].includes(lab.accreditation_body);

  const [form, setForm] = useState({
    initialCompletedAt: s?.initial_completed_at || "",
    initialSignedBy: s?.initial_signed_by || "",
    sixMonthCompletedAt: s?.six_month_completed_at || "",
    sixMonthSignedBy: s?.six_month_signed_by || "",
    firstAnnualCompletedAt: s?.first_annual_completed_at || "",
    firstAnnualSignedBy: s?.first_annual_signed_by || "",
    lastAnnualCompletedAt: s?.last_annual_completed_at || "",
    lastAnnualSignedBy: s?.last_annual_signed_by || "",
    notes: s?.notes || "",
  });
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const competencyUrl = activeLabId
        ? `${API_BASE}/api/labs/${activeLabId}/staff/competency/${employee.id}`
        : `${API_BASE}/api/staff/competency/${employee.id}`;
      const res = await fetch(competencyUrl, {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(await res.text());
      await queryClient.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).endsWith('/staff/employees') });
      toast({ title: "Competency schedule updated" });
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  function MilestoneRow({ label, dueDate, completedValue, completedKey, signedByValue, signedByKey }: any) {
    const isDue = dueDate && !completedValue;
    const isOverdue = isDue && new Date(dueDate) < new Date();
    return (
      <div className="grid grid-cols-3 gap-2 items-end">
        <div>
          <label className="text-xs font-medium flex items-center gap-1">
            {label}
            {dueDate && <span className="text-xs text-muted-foreground">(Due: {dueDate})</span>}
            {isOverdue && <AlertTriangle size={12} className="text-red-500" />}
            {completedValue && <CheckCircle2 size={12} className="text-emerald-500" />}
          </label>
        </div>
        <div>
          <Input type="date" value={completedValue} onChange={(e) => setForm({ ...form, [completedKey]: e.target.value })} className="text-xs" />
        </div>
        <div>
          <Input value={signedByValue} onChange={(e) => setForm({ ...form, [signedByKey]: e.target.value })} placeholder="Signed by" className="text-xs" />
        </div>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Competency Schedule: {employee.first_name} {employee.last_name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="bg-muted/50 rounded-lg p-3 text-xs">
            <p><strong>Accreditor:</strong> {lab.accreditation_body}{lab.includes_nys ? " + NYS" : ""}</p>
            <p><strong>Hire Date:</strong> {employee.hire_date || "Not set"}</p>
            {includesTJCorCAP && <p className="text-amber-600">TJC/CAP: Initial competency required before patient testing.</p>}
          </div>

          <div className="grid grid-cols-3 gap-2 text-xs font-medium text-muted-foreground border-b pb-1">
            <div>Milestone</div><div>Completed</div><div>Signed By</div>
          </div>

          {includesTJCorCAP && (
            <MilestoneRow label="Initial" dueDate={null}
              completedValue={form.initialCompletedAt} completedKey="initialCompletedAt"
              signedByValue={form.initialSignedBy} signedByKey="initialSignedBy" />
          )}

          <MilestoneRow label="6-Month" dueDate={s?.six_month_due_at}
            completedValue={form.sixMonthCompletedAt} completedKey="sixMonthCompletedAt"
            signedByValue={form.sixMonthSignedBy} signedByKey="sixMonthSignedBy" />

          {includesTJCorCAP && (
            <MilestoneRow label="1st Annual" dueDate={s?.first_annual_due_at}
              completedValue={form.firstAnnualCompletedAt} completedKey="firstAnnualCompletedAt"
              signedByValue={form.firstAnnualSignedBy} signedByKey="firstAnnualSignedBy" />
          )}

          <MilestoneRow label="Annual" dueDate={s?.annual_due_at}
            completedValue={form.lastAnnualCompletedAt} completedKey="lastAnnualCompletedAt"
            signedByValue={form.lastAnnualSignedBy} signedByKey="lastAnnualSignedBy" />

          {lab.includes_nys === 1 && s?.nys_six_month_due_at && (
            <div className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1">
              NYS 6-month due: {s.nys_six_month_due_at}
            </div>
          )}

          <div>
            <label className="text-sm font-medium">Notes</label>
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          </div>

          <div className="flex gap-2 pt-2">
            <Button onClick={handleSave} disabled={saving} className="flex-1">{saving ? "Saving..." : "Save"}</Button>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Employee Detail View ──────────────────────────────────────────

function EmployeeDetailView({ employee, lab, onBack, onEdit, onCompetency }: {
  employee: Employee; lab: Lab; onBack: () => void; onEdit: () => void; onCompetency: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const activeLabId = useActiveLabId();
  const readOnly = useIsReadOnly('veritastaff');
  const [showCompetency, setShowCompetency] = useState(false);

  const roleNames = Array.from(new Set(employee.roles.map((r) => r.role)));
  const tcSpecs = employee.roles.filter((r) => r.role === "TC" && r.specialty_number);
  const tsSpecs = employee.roles.filter((r) => r.role === "TS" && r.specialty_number);
  const compStatus = getCompetencyStatus(employee.competencySchedule);
  // Wave H PR H1: termination state for the dialog. The Remove button
  // opens the dialog instead of immediately calling DELETE so the lab
  // director can capture date + reason for the surveyor record.
  const [terminateOpen, setTerminateOpen] = useState(false);
  const [terminatedAt, setTerminatedAt] = useState(() => new Date().toISOString().split("T")[0]);
  const [terminationReason, setTerminationReason] = useState("");
  const [terminating, setTerminating] = useState(false);

  async function handleDelete() {
    setTerminating(true);
    try {
      const deleteUrl = activeLabId
        ? `${API_BASE}/api/labs/${activeLabId}/staff/employees/${employee.id}`
        : `${API_BASE}/api/staff/employees/${employee.id}`;
      const res = await fetch(deleteUrl, {
        method: "DELETE",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ terminatedAt, terminationReason }),
      });
      if (!res.ok) throw new Error(await res.text());
      await queryClient.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).endsWith('/staff/employees') });
      toast({ title: "Employee terminated", description: `Records preserved per CMS records-retention rules. Status set to terminated as of ${terminatedAt}.` });
      setTerminateOpen(false);
      onBack();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setTerminating(false);
    }
  }

  return (
    <div className="container-default py-8">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ChevronLeft size={14} /> Back to Roster
      </button>

      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="font-serif text-3xl font-bold">
            {employee.last_name}, {employee.first_name}{employee.middle_initial ? ` ${employee.middle_initial}.` : ""}
          </h1>
          {employee.title && <p className="text-lg text-muted-foreground">{employee.title}</p>}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onEdit} disabled={readOnly}>
            <Edit2 size={14} className="mr-1" /> Edit
          </Button>
          {/* Wave H PR H1 (2026-06-06): Terminate replaces Remove. Soft-delete
              preserves the employee row + competency schedule + assessment
              history + linked credential URLs so the CMS §493.1105 +
              TJC HR.01.07.01 records-retention chain stays intact. */}
          <Button
            variant="outline"
            size="sm"
            disabled={readOnly}
            className="text-red-600 hover:text-red-700"
            onClick={() => setTerminateOpen(true)}
          >
            <Trash2 size={14} className="mr-1" /> Terminate
          </Button>
        </div>
      </div>

      {/* Wave H PR H1: termination dialog. Date defaults to today; reason is
          a free-text textarea so the lab director can capture the specifics
          (resigned, retired, ended employment, position eliminated, etc.).
          Empty reason is allowed for backwards compat with quick-removes. */}
      <Dialog open={terminateOpen} onOpenChange={setTerminateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Terminate Employee</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              {employee.first_name} {employee.last_name} will be marked as terminated. Their roles, competency schedule, assessment history, and linked credentials are preserved for CMS records retention (42 CFR §493.1105). The employee will not appear on the active roster or CMS 209.
            </div>
            <div>
              <label className="text-sm font-medium">Termination date</label>
              <Input
                type="date"
                value={terminatedAt}
                onChange={(e) => setTerminatedAt(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Reason (optional)</label>
              <Textarea
                rows={3}
                placeholder="e.g., Resigned, Retired, End of contract, Position eliminated"
                value={terminationReason}
                onChange={(e) => setTerminationReason(e.target.value)}
              />
            </div>
            <div className="flex gap-2 pt-2">
              <Button onClick={handleDelete} disabled={terminating} className="flex-1 bg-red-600 hover:bg-red-700 text-white">
                {terminating ? "Terminating..." : "Terminate Employee"}
              </Button>
              <Button variant="outline" onClick={() => setTerminateOpen(false)} disabled={terminating}>
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Wave G PR G3 (2026-06-06): NYS Department of Health surfacing.
          When the lab carries a New York State clinical lab permit
          (staff_labs.includes_nys = 1) AND the employee performs testing,
          remind the lab director of the NYS-specific cadence: initial
          competency assessed within 6 months of hire AND a second
          biennial-cycle competency every 2 years thereafter. CLIA
          annual cadence still applies in parallel; this banner is the
          adjunct NYS layer, not a replacement.
          Reg anchors: 10 NYCRR Part 58-1.10 (clinical laboratory technical
          personnel competency), DOH Wadsworth Center CLEP guidance. */}
      {lab.includes_nys === 1 && employee.performs_testing === 1 && (
        <div className="mb-6 flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm">
          <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-amber-900">NYS Clinical Laboratory Evaluation Program (CLEP) cadence applies</div>
            <div className="text-amber-800 text-xs mt-1">
              In addition to CLIA, NYS requires initial competency within 6 months of hire and a biennial (every 2 years) re-evaluation. Track both alongside the standard CLIA initial / 6-month / 1st annual / annual cycle.
            </div>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Info Card */}
        <Card>
          <CardContent className="p-5">
            <h3 className="font-semibold mb-3">Employee Information</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Hire Date</span><span>{employee.hire_date || "Not set"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Complexity</span><Badge variant="outline">{employee.highest_complexity === "H" ? "High" : "Moderate"}</Badge></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Performs Testing</span><span>{employee.performs_testing ? "Yes" : "No"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Qualifications</span><span className="text-right max-w-[60%]">{employee.qualifications_text || "N/A"}</span></div>
            </div>
          </CardContent>
        </Card>

        {/* Roles Card */}
        <Card>
          <CardContent className="p-5">
            <h3 className="font-semibold mb-3">CLIA Role Assignments</h3>
            <div className="flex flex-wrap gap-2 mb-3">
              {roleNames.map((r) => (
                <Badge key={r} className="font-mono text-sm">{r}</Badge>
              ))}
            </div>
            {tcSpecs.length > 0 && (
              <div className="mb-2">
                <p className="text-xs font-medium text-muted-foreground mb-1">TC Specialties:</p>
                {tcSpecs.map((r) => (
                  <p key={r.id} className="text-xs">{r.specialty_number}. {CMS_SPECIALTIES[r.specialty_number!]}</p>
                ))}
              </div>
            )}
            {tsSpecs.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">TS Specialties:</p>
                {tsSpecs.map((r) => (
                  <p key={r.id} className="text-xs">{r.specialty_number}. {CMS_SPECIALTIES[r.specialty_number!]}</p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Competency Card */}
        {employee.performs_testing === 1 && (
          <Card className="lg:col-span-2">
            <CardContent className="p-5">
              <div className="flex justify-between items-center mb-3">
                <h3 className="font-semibold">Competency Schedule</h3>
                <div className="flex items-center gap-2">
                  <Badge className={`border ${compStatus.color}`}>{compStatus.label}</Badge>
                  <Button variant="outline" size="sm" onClick={() => setShowCompetency(true)} disabled={readOnly}>
                    <Calendar size={14} className="mr-1" /> Update
                  </Button>
                </div>
              </div>
              {employee.competencySchedule ? (
                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {["TJC", "CAP"].includes(lab.accreditation_body) && (
                    <MilestoneCard label="Initial" completed={employee.competencySchedule.initial_completed_at} signedBy={employee.competencySchedule.initial_signed_by} />
                  )}
                  <MilestoneCard label="6-Month" due={employee.competencySchedule.six_month_due_at} completed={employee.competencySchedule.six_month_completed_at} signedBy={employee.competencySchedule.six_month_signed_by} />
                  {["TJC", "CAP"].includes(lab.accreditation_body) && (
                    <MilestoneCard label="1st Annual" due={employee.competencySchedule.first_annual_due_at} completed={employee.competencySchedule.first_annual_completed_at} signedBy={employee.competencySchedule.first_annual_signed_by} />
                  )}
                  <MilestoneCard label="Annual" due={employee.competencySchedule.annual_due_at} completed={employee.competencySchedule.last_annual_completed_at} signedBy={employee.competencySchedule.last_annual_signed_by} />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No competency schedule set up yet.</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* PR C: Credentials / Documents card. Linked URLs only; files stay in the lab's own storage. */}
        <EmployeeDocumentsCard employeeId={employee.id} />

        {/* PR D: Assigned Instruments card. Many-to-many to VeritaMap instruments. */}
        <AssignedInstrumentsCard employeeId={employee.id} />
      </div>

      {showCompetency && (
        <CompetencyDialog
          open={showCompetency}
          onOpenChange={(open) => setShowCompetency(open)}
          employee={employee}
          lab={lab}
        />
      )}
    </div>
  );
}

// EmployeeDocumentsCard
//
// PR C of the VeritaComp customer-blockers wave (2026-06-05, item #7).
// Surveyor-defensible credential storage by URL pointer. The lab links
// the file from their own SharePoint / Drive; we keep metadata only.
// Renders a list with expiration badge so the lab can spot a license
// that is expiring before TJC asks about it.
type EmployeeDocument = {
  id: number;
  employee_id: number;
  doc_type: string;
  title: string | null;
  url: string;
  storage_provider: string | null;
  expiration_date: string | null;
  created_at: string;
};

function EmployeeDocumentsCard({ employeeId }: { employeeId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const activeLabId = useActiveLabId();
  const readOnly = useIsReadOnly('veritastaff');
  const [linkOpen, setLinkOpen] = useState(false);

  const listUrl = activeLabId ? `/api/labs/${activeLabId}/staff/employees/${employeeId}/documents` : null;
  const { data: docs } = useQuery<EmployeeDocument[]>({
    queryKey: [listUrl ?? "no-employee-docs"],
    queryFn: async () => {
      if (!listUrl) return [];
      const r = await fetch(`${API_BASE}${listUrl}`, { headers: authHeaders() });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!listUrl,
  });

  async function deleteDoc(id: number) {
    if (!activeLabId) return;
    const r = await fetch(`${API_BASE}/api/labs/${activeLabId}/staff/employee-documents/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      toast({ title: "Delete failed", description: err.error || `HTTP ${r.status}`, variant: "destructive" });
      return;
    }
    toast({ title: "Document unlinked" });
    queryClient.invalidateQueries({ queryKey: [listUrl] });
  }

  async function createDoc(payload: { docType: string; title: string; url: string; storageProvider: string; expirationDate: string }) {
    if (!activeLabId) throw new Error("Active lab required");
    const r = await fetch(`${API_BASE}/api/labs/${activeLabId}/staff/employees/${employeeId}/documents`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${r.status}`);
    }
    toast({ title: "Document linked" });
    queryClient.invalidateQueries({ queryKey: [listUrl] });
  }

  const docTypeLabel = (v: string) => STAFF_DOC_TYPES.find(t => t.value === v)?.label || v;

  return (
    <Card className="lg:col-span-2">
      <CardContent className="p-5">
        <div className="flex justify-between items-center mb-3">
          <div className="flex items-center gap-2">
            <FileText size={16} className="text-primary" />
            <h3 className="font-semibold">Credentials &amp; Documents</h3>
          </div>
          <Button variant="outline" size="sm" onClick={() => setLinkOpen(true)} disabled={readOnly}>
            <Plus size={14} className="mr-1.5" /> Link Document
          </Button>
        </div>
        {(docs?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">
            No documents linked yet. Link state licenses, ASCP cards, diplomas, or training certificates so they are at hand during a survey. Files stay in your own SharePoint or Drive; we store only the URL.
          </p>
        ) : (
          <div className="space-y-2">
            {docs!.map(d => {
              const status = expirationStatus(d.expiration_date);
              const tone = status.tone === "expired" ? "text-red-700 bg-red-500/10 border-red-500/30"
                : status.tone === "due_soon" ? "text-amber-700 bg-amber-500/10 border-amber-500/30"
                : status.tone === "active" ? "text-emerald-700 bg-emerald-500/10 border-emerald-500/30"
                : "";
              return (
                <div key={d.id} className="flex items-center gap-2 border border-border rounded-md p-2">
                  <Badge variant="outline" className="text-[10px]">{docTypeLabel(d.doc_type)}</Badge>
                  <div className="flex-1 min-w-0">
                    <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-primary hover:underline truncate inline-flex items-center gap-1">
                      <ExternalLink size={12} />
                      {d.title || d.url}
                    </a>
                    {status.label && (
                      <Badge variant="outline" className={`ml-2 text-[10px] border ${tone}`}>{status.label}</Badge>
                    )}
                  </div>
                  <ConfirmDialog
                    title="Unlink document?"
                    message="This removes the link from VeritaStaff. The underlying file in your own storage is not affected."
                    confirmLabel="Unlink"
                    onConfirm={() => deleteDoc(d.id)}
                  >
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" disabled={readOnly} title="Unlink">
                      <Trash2 size={12} />
                    </Button>
                  </ConfirmDialog>
                </div>
              );
            })}
          </div>
        )}
        <DocumentLinkDialog
          open={linkOpen}
          onOpenChange={setLinkOpen}
          title="Link Credential / Document"
          docTypes={STAFF_DOC_TYPES}
          onSubmit={createDoc}
        />
      </CardContent>
    </Card>
  );
}

// AssignedInstrumentsCard
//
// PR D of the VeritaComp customer-blockers wave (2026-06-05, item #8).
// Renders the employee's assigned VeritaMap instruments + an Edit button
// that opens the multi-select picker.
function AssignedInstrumentsCard({ employeeId }: { employeeId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const activeLabId = useActiveLabId();
  const readOnly = useIsReadOnly('veritastaff');
  const [pickerOpen, setPickerOpen] = useState(false);

  const assignedUrl = activeLabId ? `/api/labs/${activeLabId}/staff/employees/${employeeId}/instruments` : null;
  const availableUrl = activeLabId ? `/api/labs/${activeLabId}/veritamap/instruments-flat` : null;

  const { data: assigned } = useQuery<LabInstrument[]>({
    queryKey: [assignedUrl ?? "no-assigned-instruments"],
    queryFn: async () => {
      if (!assignedUrl) return [];
      const r = await fetch(`${API_BASE}${assignedUrl}`, { headers: authHeaders() });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!assignedUrl,
  });

  const { data: available } = useQuery<LabInstrument[]>({
    queryKey: [availableUrl ?? "no-available-instruments"],
    queryFn: async () => {
      if (!availableUrl) return [];
      const r = await fetch(`${API_BASE}${availableUrl}`, { headers: authHeaders() });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: pickerOpen && !!availableUrl,
  });

  async function syncAssignments(instrumentIds: number[]) {
    if (!activeLabId) throw new Error("Active lab required");
    const r = await fetch(`${API_BASE}/api/labs/${activeLabId}/staff/employees/${employeeId}/instruments`, {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ instrumentIds }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${r.status}`);
    }
    toast({ title: "Instrument assignments saved" });
    queryClient.invalidateQueries({ queryKey: [assignedUrl] });
  }

  return (
    <Card className="lg:col-span-2">
      <CardContent className="p-5">
        <div className="flex justify-between items-center mb-3">
          <div className="flex items-center gap-2">
            <FileSpreadsheet size={16} className="text-primary" />
            <h3 className="font-semibold">Assigned Instruments</h3>
          </div>
          <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)} disabled={readOnly}>
            <Edit2 size={14} className="mr-1.5" /> Edit
          </Button>
        </div>
        {(assigned?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">
            No instruments assigned yet. Pick the instruments this employee actually runs so the New Assessment dialog shows that context to the supervisor.
          </p>
        ) : (() => {
          // Wave G PR G4 (2026-06-06). Visual grouping for manual methods.
          // Heuristic: a row is a manual method if it has no serial_number
          // OR its instrument_name starts with "Manual " (case-insensitive,
          // matches the seed convention used in seedDemo.ts for Manual
          // Differential and similar bench procedures). Everything else is
          // instrument-based. We render the two sub-groups only when both
          // are non-empty; otherwise fall back to the single-group layout
          // so existing labs see no visual churn.
          const isManual = (i: LabInstrument) => {
            const noSn = !i.serial_number || i.serial_number.trim() === "";
            const nameSignal = /^manual\b/i.test(i.instrument_name || "");
            return noSn || nameSignal;
          };
          const manuals = assigned!.filter(isManual);
          const instruments = assigned!.filter(i => !isManual(i));
          const renderBadge = (i: LabInstrument) => (
            <Badge key={i.id} variant="outline" className="text-xs">
              {i.instrument_name}
              {i.nickname && <span className="ml-1 text-muted-foreground">({i.nickname})</span>}
              {i.category && <span className="ml-1 text-muted-foreground">- {i.category}</span>}
            </Badge>
          );
          if (manuals.length === 0 || instruments.length === 0) {
            // Single group fallback — preserves the pre-G4 layout when the
            // lab only does one or the other.
            return (
              <div className="flex flex-wrap gap-1.5">
                {assigned!.map(renderBadge)}
              </div>
            );
          }
          return (
            <div className="space-y-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                  Instrument-based ({instruments.length})
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {instruments.map(renderBadge)}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                  Manual methods ({manuals.length})
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {manuals.map(renderBadge)}
                </div>
              </div>
            </div>
          );
        })()}
        <EmployeeInstrumentsPickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          available={available ?? []}
          initiallySelected={(assigned ?? []).map(i => i.id)}
          onSubmit={syncAssignments}
        />
      </CardContent>
    </Card>
  );
}

function MilestoneCard({ label, due, completed, signedBy }: { label: string; due?: string | null; completed?: string | null; signedBy?: string | null }) {
  const isCompleted = !!completed;
  const isOverdue = !isCompleted && due && new Date(due) < new Date();
  const isDueSoon = !isCompleted && due && !isOverdue && (new Date(due).getTime() - Date.now()) / (1000 * 60 * 60 * 24) <= 30;

  return (
    <div className={`rounded-lg border p-3 ${isCompleted ? "border-emerald-500/30 bg-emerald-500/5" : isOverdue ? "border-red-500/30 bg-red-500/5" : isDueSoon ? "border-amber-500/30 bg-amber-500/5" : "border-border"}`}>
      <div className="flex items-center gap-1.5 mb-1">
        {isCompleted ? <CheckCircle2 size={14} className="text-emerald-500" /> :
         isOverdue ? <AlertTriangle size={14} className="text-red-500" /> :
         isDueSoon ? <Clock size={14} className="text-amber-500" /> :
         <Clock size={14} className="text-muted-foreground" />}
        <span className="text-xs font-semibold">{label}</span>
      </div>
      {due && <p className="text-xs text-muted-foreground">Due: {due}</p>}
      {completed && <p className="text-xs text-emerald-600">Completed: {completed}</p>}
      {signedBy && <p className="text-xs text-muted-foreground">By: {signedBy}</p>}
    </div>
  );
}

// ── Bulk Import Dialog ──────────────────────────────────────────────────
interface BulkValidatedRow {
  rowNumber: number;
  status: "ok" | "warning" | "error";
  parsed: {
    employeeId: number | null;
    lastName: string;
    firstName: string;
    middleInitial: string | null;
    title: string | null;
    hireDate: string | null;
    qualificationsText: string | null;
    highestComplexity: string;
    performsTesting: number;
    roles: { role: string; specialtyNumber: number | null }[];
  };
  issues: { field?: string; severity: "error" | "warning"; message: string }[];
  willInsert: boolean;
  willUpdate: boolean;
  duplicateOfEmployeeId?: number | null;
}

interface BulkPreview {
  rows: BulkValidatedRow[];
  summary: { total: number; ok: number; warning: number; error: number; willInsert: number; willUpdate: number };
  fatal?: string;
}

function BulkImportDialog({ open, onOpenChange, lab }: { open: boolean; onOpenChange: (o: boolean) => void; lab: Lab }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<BulkPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);

  useEffect(() => {
    if (!open) {
      setFile(null);
      setPreview(null);
      setPreviewing(false);
      setCommitting(false);
    }
  }, [open]);

  async function handleDownloadTemplate() {
    setDownloadingTemplate(true);
    try {
      const res = await fetch(`${API_BASE}/api/staff/employees/template`, { headers: authHeaders() });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "VeritaStaff_Bulk_Import_Template.xlsx";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast({ title: "Could not download template", description: err.message, variant: "destructive" });
    } finally {
      setDownloadingTemplate(false);
    }
  }

  async function handlePreview() {
    if (!file) return;
    setPreviewing(true);
    setPreview(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${API_BASE}/api/staff/employees/bulk-preview`, {
        method: "POST",
        headers: authHeaders(),
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.fatal) {
          setPreview({ rows: [], summary: { total: 0, ok: 0, warning: 0, error: 0, willInsert: 0, willUpdate: 0 }, fatal: data.fatal });
        } else {
          throw new Error(data.error || data.message || "Preview failed");
        }
      } else {
        setPreview(data);
      }
    } catch (err: any) {
      toast({ title: "Preview failed", description: err.message, variant: "destructive" });
    } finally {
      setPreviewing(false);
    }
  }

  async function handleCommit() {
    if (!file || !preview || preview.summary.error > 0) return;
    setCommitting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${API_BASE}/api/staff/employees/bulk-commit`, {
        method: "POST",
        headers: authHeaders(),
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || "Commit failed");
      toast({
        title: "Import complete",
        description: `${data.inserted} added, ${data.updated} updated.`,
      });
      qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).endsWith('/staff/employees') });
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      setCommitting(false);
    }
  }

  const canCommit = !!preview && preview.summary.error === 0 && (preview.summary.willInsert + preview.summary.willUpdate) > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk Import Staff</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Card>
            <CardContent className="py-4 space-y-3">
              <div className="flex items-start gap-3">
                <FileSpreadsheet size={20} className="text-primary mt-0.5" />
                <div className="text-sm flex-1">
                  <p className="font-medium">Step 1. Download the template</p>
                  <p className="text-muted-foreground text-xs mt-1">
                    The template has dropdowns and instructions built in. Have your lab fill in one row per employee, save as .xlsx, and upload below.
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={handleDownloadTemplate} disabled={downloadingTemplate}>
                  <Download size={14} className="mr-1.5" />
                  {downloadingTemplate ? "Preparing..." : "Download template"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="py-4 space-y-3">
              <div className="flex items-start gap-3">
                <Upload size={20} className="text-primary mt-0.5" />
                <div className="text-sm flex-1">
                  <p className="font-medium">Step 2. Upload the completed file</p>
                  <p className="text-muted-foreground text-xs mt-1">
                    We will validate every row before saving anything. You can review the preview below and only commit if it looks right.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={(e) => { setFile(e.target.files?.[0] || null); setPreview(null); }}
                />
                <Button size="sm" onClick={handlePreview} disabled={!file || previewing}>
                  {previewing ? "Validating..." : "Preview"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {preview?.fatal && (
            <Card className="border-destructive">
              <CardContent className="py-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={18} className="text-destructive mt-0.5" />
                  <div>
                    <p className="font-medium text-sm text-destructive">Could not read the file</p>
                    <p className="text-xs text-muted-foreground mt-1">{preview.fatal}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {preview && !preview.fatal && (
            <Card>
              <CardContent className="py-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex flex-wrap gap-3 text-xs">
                    <span><strong>{preview.summary.total}</strong> rows</span>
                    <span className="text-emerald-600"><strong>{preview.summary.ok}</strong> ok</span>
                    <span className="text-amber-600"><strong>{preview.summary.warning}</strong> with warnings</span>
                    <span className="text-destructive"><strong>{preview.summary.error}</strong> with errors</span>
                    <span className="text-muted-foreground">|</span>
                    <span><strong>{preview.summary.willInsert}</strong> to add</span>
                    <span><strong>{preview.summary.willUpdate}</strong> to update</span>
                  </div>
                  <Button size="sm" onClick={handleCommit} disabled={!canCommit || committing}>
                    {committing ? "Importing..." : preview.summary.error > 0 ? "Fix errors first" : "Commit import"}
                  </Button>
                </div>

                <div className="border rounded-md overflow-x-auto max-h-[400px] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="px-2 py-1.5 text-left">Row</th>
                        <th className="px-2 py-1.5 text-left">Status</th>
                        <th className="px-2 py-1.5 text-left">Action</th>
                        <th className="px-2 py-1.5 text-left">Name</th>
                        <th className="px-2 py-1.5 text-left">Complexity</th>
                        <th className="px-2 py-1.5 text-left">Tests?</th>
                        <th className="px-2 py-1.5 text-left">Roles</th>
                        <th className="px-2 py-1.5 text-left">Issues</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((r) => {
                        const rowClass =
                          r.status === "error" ? "bg-destructive/5" :
                          r.status === "warning" ? "bg-amber-50 dark:bg-amber-900/10" :
                          "";
                        const action = r.willUpdate ? "Update" : r.willInsert ? "Add" : "Skip";
                        const roleSummary = Array.from(new Set(r.parsed.roles.map((x) => x.role))).join(", ") || "-";
                        return (
                          <tr key={r.rowNumber} className={`border-t ${rowClass}`}>
                            <td className="px-2 py-1.5">{r.rowNumber}</td>
                            <td className="px-2 py-1.5">
                              {r.status === "ok" && <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200">OK</Badge>}
                              {r.status === "warning" && <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">Warning</Badge>}
                              {r.status === "error" && <Badge variant="outline" className="text-xs bg-red-50 text-red-700 border-red-200">Error</Badge>}
                            </td>
                            <td className="px-2 py-1.5">{action}</td>
                            <td className="px-2 py-1.5">
                              {r.parsed.lastName || r.parsed.firstName ? `${r.parsed.lastName}, ${r.parsed.firstName}` : <span className="text-muted-foreground">-</span>}
                            </td>
                            <td className="px-2 py-1.5">{r.parsed.highestComplexity}</td>
                            <td className="px-2 py-1.5">{r.parsed.performsTesting === 1 ? "Yes" : "No"}</td>
                            <td className="px-2 py-1.5 font-mono text-xs">{roleSummary}</td>
                            <td className="px-2 py-1.5">
                              {r.issues.length === 0 ? <span className="text-muted-foreground">-</span> : (
                                <ul className="space-y-0.5">
                                  {r.issues.map((iss, i) => (
                                    <li key={i} className={iss.severity === "error" ? "text-destructive" : "text-amber-600"}>
                                      {iss.field ? `${iss.field}: ` : ""}{iss.message}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
