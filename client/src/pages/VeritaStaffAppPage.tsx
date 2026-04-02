import { useState, useEffect } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/components/AuthContext";
import { useIsReadOnly } from "@/components/SubscriptionBanner";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Plus, Trash2, ChevronLeft, Users, Lock, FileDown, Building2,
  CheckCircle2, AlertTriangle, Clock, UserPlus, Edit2, Calendar,
  Download, X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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
  hire_date: string | null;
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
  if (!schedule) return { label: "Not set", color: "text-muted-foreground" };

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

  // Auth + plan check
  const hasAccess = isLoggedIn && !!user?.plan && user.plan !== "free" && user.plan !== "per_study";

  // Fetch lab
  const { data: lab, isLoading: labLoading } = useQuery<Lab | null>({
    queryKey: ["/api/staff/lab"],
    enabled: !!hasAccess,
  });

  // Fetch employees
  const { data: employees = [], isLoading: empLoading } = useQuery<Employee[]>({
    queryKey: ["/api/staff/employees"],
    enabled: !!hasAccess && !!lab,
  });

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
      <EmployeeDetailView
        employee={selectedEmployee}
        lab={lab!}
        onBack={() => navigate("/veritastaff-app")}
        onEdit={() => setEditingEmployee(selectedEmployee)}
        onCompetency={() => setShowCompetency(selectedEmployee)}
      />
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
        <div className="flex gap-2">
          {lab && (
            <>
              <Button variant="outline" size="sm" onClick={() => setShowAddEmployee(true)} disabled={readOnly}>
                <UserPlus size={14} className="mr-1.5" /> Add Employee
              </Button>
              <Button size="sm" className="bg-primary hover:bg-primary/90" onClick={handleGenerate209} disabled={generating209 || readOnly}>
                <FileDown size={14} className="mr-1.5" /> {generating209 ? "Generating..." : "Generate CMS 209"}
              </Button>
            </>
          )}
        </div>
      </div>

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
          {employees.map((emp) => {
            const compStatus = getCompetencyStatus(emp.competencySchedule);
            const roleNames = [...new Set(emp.roles.map((r) => r.role))];
            return (
              <Card key={emp.id} className="hover:border-primary/30 transition-colors cursor-pointer" onClick={() => navigate(`/veritastaff-app/${emp.id}`)}>
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
      <LabSetupDialog open={showLabSetup} onOpenChange={setShowLabSetup} lab={lab} />

      {/* Add/Edit Employee Dialog */}
      <EmployeeDialog
        open={showAddEmployee || !!editingEmployee}
        onOpenChange={(open) => { if (!open) { setShowAddEmployee(false); setEditingEmployee(null); } }}
        employee={editingEmployee}
        lab={lab}
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
    </div>
  );

  async function handleGenerate209() {
    setGenerating209(true);
    try {
      const res = await fetch(`${API_BASE}/api/staff/cms209`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error(await res.text());
      const { token } = await res.json();
      const a = document.createElement("a");
      a.href = `/api/pdf/${token}`;
      a.download = `CMS_209_${lab?.clia_number || "report"}_${new Date().toISOString().split("T")[0]}.pdf`;
      a.click();
      toast({ title: "CMS 209 generated", description: "Your personnel report has been downloaded." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setGenerating209(false);
    }
  }
}

// ── Lab Setup Dialog ──────────────────────────────────────────────────

function LabSetupDialog({ open, onOpenChange, lab }: { open: boolean; onOpenChange: (v: boolean) => void; lab: Lab | null }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
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
      const res = await fetch(`${API_BASE}/api/staff/veritamap-suggestions`, { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setSuggestions(data);
        if (data.length > 0) toast({ title: "VeritaMap departments found", description: `${data.length} department(s) can be mapped to CMS specialties.` });
        else toast({ title: "No VeritaMap departments", description: "No maps found. You can still set up specialties manually." });
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
      const res = await fetch(`${API_BASE}/api/staff/lab`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(await res.text());
      await queryClient.invalidateQueries({ queryKey: ["/api/staff/lab"] });
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
                {ACCREDITORS.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
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
              <p className="font-medium mb-2">Suggested CMS Specialties from VeritaMap:</p>
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
  const isEdit = !!employee;

  const [form, setForm] = useState({
    lastName: "", firstName: "", middleInitial: "", title: "",
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
        hireDate: employee.hire_date || "", qualificationsText: employee.qualifications_text || "",
        highestComplexity: employee.highest_complexity, performsTesting: employee.performs_testing === 1,
      });
      setRoles(employee.roles.map((r) => ({ role: r.role, specialtyNumber: r.specialty_number })));
    } else {
      setForm({ lastName: "", firstName: "", middleInitial: "", title: "", hireDate: "", qualificationsText: "", highestComplexity: "H", performsTesting: true });
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
    if (roles.some((r) => r.role === role && r.specialty_number === specNum)) return;
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
      const url = isEdit ? `${API_BASE}/api/staff/employees/${employee!.id}` : `${API_BASE}/api/staff/employees`;
      const method = isEdit ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, roles }),
      });
      if (!res.ok) throw new Error(await res.text());
      await queryClient.invalidateQueries({ queryKey: ["/api/staff/employees"] });
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
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g., MLS(ASCP)" />
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
                The Laboratory Director does not need to be listed as CC, TC, TS, or GS -- those are delegated positions.
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
      const res = await fetch(`${API_BASE}/api/staff/competency/${employee.id}`, {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(await res.text());
      await queryClient.invalidateQueries({ queryKey: ["/api/staff/employees"] });
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
  const readOnly = useIsReadOnly('veritastaff');
  const [showCompetency, setShowCompetency] = useState(false);

  const roleNames = [...new Set(employee.roles.map((r) => r.role))];
  const tcSpecs = employee.roles.filter((r) => r.role === "TC" && r.specialty_number);
  const tsSpecs = employee.roles.filter((r) => r.role === "TS" && r.specialty_number);
  const compStatus = getCompetencyStatus(employee.competencySchedule);

  async function handleDelete() {
    if (!confirm(`Remove ${employee.first_name} ${employee.last_name} from the roster?`)) return;
    try {
      const res = await fetch(`${API_BASE}/api/staff/employees/${employee.id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(await res.text());
      await queryClient.invalidateQueries({ queryKey: ["/api/staff/employees"] });
      toast({ title: "Employee removed" });
      onBack();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
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
          <Button variant="outline" size="sm" onClick={handleDelete} disabled={readOnly} className="text-red-600 hover:text-red-700">
            <Trash2 size={14} className="mr-1" /> Remove
          </Button>
        </div>
      </div>

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
