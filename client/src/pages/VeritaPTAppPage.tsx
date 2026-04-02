import { useState, useEffect } from "react";
import { Link } from "wouter";
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
  Plus,
  Trash2,
  Lock,
  FileDown,
  FlaskConical,
  ClipboardList,
  AlertTriangle,
  CheckCircle2,
  Pencil,
  Loader2,
  Sparkles,
} from "lucide-react";

// ── Types ───────────────────────────────────────────────────────────────────

interface PTEnrollment {
  id: number;
  user_id: number;
  analyte: string;
  specialty: string;
  pt_provider: string;
  program_code: string | null;
  enrollment_year: number;
  enrollment_date: string;
  status: string;
}

interface PTEvent {
  id: number;
  enrollment_id: number;
  user_id: number;
  event_id: string | null;
  event_name: string | null;
  event_date: string;
  analyte: string;
  your_result: number | null;
  your_method: string | null;
  peer_mean: number | null;
  peer_sd: number | null;
  peer_n: number | null;
  acceptable_low: number | null;
  acceptable_high: number | null;
  sdi: number | null;
  pass_fail: string;
  notes: string | null;
}

interface PTCorrectiveAction {
  id: number;
  event_id: number;
  user_id: number;
  root_cause: string | null;
  corrective_action: string;
  preventive_action: string | null;
  responsible_person: string | null;
  date_initiated: string;
  date_completed: string | null;
  status: string;
  verified_by: string | null;
  verified_date: string | null;
}

interface PTSummary {
  totalEnrollments: number;
  eventsThisYear: number;
  passRate: number;
  openCorrectiveActions: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function PassFailBadge({ value }: { value: string }) {
  if (value === "pass") return <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 border text-xs">PASS</Badge>;
  if (value === "fail") return <Badge className="bg-red-500/10 text-red-600 border-red-500/20 border text-xs">FAIL</Badge>;
  return <Badge variant="outline" className="text-xs text-muted-foreground">PENDING</Badge>;
}

function StatusBadge({ value }: { value: string }) {
  if (value === "active") return <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 border text-xs">Active</Badge>;
  if (value === "completed") return <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 border text-xs">Completed</Badge>;
  if (value === "open") return <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20 border text-xs">Open</Badge>;
  return <Badge variant="outline" className="text-xs text-muted-foreground">{value}</Badge>;
}

function trunc(s: string | null | undefined, n: number) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "..." : s;
}

const SPECIALTIES = ["Chemistry", "Hematology", "Coagulation", "Urinalysis", "Microbiology", "Blood Bank", "Other"];
const PROVIDERS = ["CAP", "AAFP", "API", "Warde Medical", "AAB", "COLA", "Other"];

// ── Enrollment Dialog ────────────────────────────────────────────────────────

function EnrollmentDialog({
  enrollment,
  open,
  onClose,
  onSaved,
  defaultProvider = "CAP",
}: {
  enrollment: PTEnrollment | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  defaultProvider?: string;
}) {
  const isReadOnly = useIsReadOnly('veritapt');
  const queryClient = useQueryClient();
  const [analyte, setAnalyte] = useState(enrollment?.analyte ?? "");
  const [specialty, setSpecialty] = useState(enrollment?.specialty ?? "Chemistry");
  const [provider, setProvider] = useState(enrollment?.pt_provider ?? defaultProvider);
  const [programCode, setProgramCode] = useState(enrollment?.program_code ?? "");
  const [year, setYear] = useState(enrollment?.enrollment_year ?? new Date().getFullYear());
  const [status, setStatus] = useState(enrollment?.status ?? "active");

  const mutation = useMutation({
    mutationFn: async () => {
      const url = enrollment
        ? `${API_BASE}/api/veritapt/enrollments/${enrollment.id}`
        : `${API_BASE}/api/veritapt/enrollments`;
      const res = await fetch(url, {
        method: enrollment ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          analyte,
          specialty,
          pt_provider: provider,
          program_code: programCode || null,
          enrollment_year: year,
          enrollment_date: new Date().toISOString().split("T")[0],
          status,
        }),
      });
      if (!res.ok) throw new Error("Failed to save enrollment");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/veritapt/enrollments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/veritapt/summary"] });
      onSaved();
      onClose();
    },
  });

  // Reset form when dialog opens with new data
  useEffect(() => {
    if (open) {
      setAnalyte(enrollment?.analyte ?? "");
      setSpecialty(enrollment?.specialty ?? "Chemistry");
      setProvider(enrollment?.pt_provider ?? defaultProvider);
      setProgramCode(enrollment?.program_code ?? "");
      setYear(enrollment?.enrollment_year ?? new Date().getFullYear());
      setStatus(enrollment?.status ?? "active");
    }
  }, [open, enrollment, defaultProvider]);

  const handleOpenChange = (v: boolean) => {
    if (!v) onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{enrollment ? "Edit Enrollment" : "Add PT Enrollment"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label>Analyte</Label>
            <Input value={analyte} onChange={e => setAnalyte(e.target.value)} placeholder="e.g. Glucose" />
          </div>
          <div className="space-y-1">
            <Label>Specialty</Label>
            <Select value={specialty} onValueChange={setSpecialty}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{SPECIALTIES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>PT Provider</Label>
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PROVIDERS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Program Code <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input value={programCode} onChange={e => setProgramCode(e.target.value)} placeholder="e.g. C-CHM-PT" />
          </div>
          <div className="space-y-1">
            <Label>Enrollment Year</Label>
            <Input type="number" value={year} onChange={e => setYear(Number(e.target.value))} />
          </div>
          <div className="space-y-1">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!analyte.trim() || mutation.isPending || isReadOnly}>
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : (enrollment ? "Save Changes" : "Add Enrollment")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Event Dialog ─────────────────────────────────────────────────────────────

function EventDialog({
  event,
  enrollments,
  open,
  onClose,
}: {
  event: PTEvent | null;
  enrollments: PTEnrollment[];
  open: boolean;
  onClose: () => void;
}) {
  const isReadOnly = useIsReadOnly('veritapt');
  const queryClient = useQueryClient();
  const [enrollmentId, setEnrollmentId] = useState(event?.enrollment_id?.toString() ?? (enrollments[0]?.id?.toString() ?? ""));
  const [eventId, setEventId] = useState(event?.event_id ?? "");
  const [eventName, setEventName] = useState(event?.event_name ?? "");
  const [eventDate, setEventDate] = useState(event?.event_date ?? new Date().toISOString().split("T")[0]);
  const [yourResult, setYourResult] = useState(event?.your_result?.toString() ?? "");
  const [yourMethod, setYourMethod] = useState(event?.your_method ?? "");
  const [peerMean, setPeerMean] = useState(event?.peer_mean?.toString() ?? "");
  const [peerSd, setPeerSd] = useState(event?.peer_sd?.toString() ?? "");
  const [peerN, setPeerN] = useState(event?.peer_n?.toString() ?? "");
  const [acceptableLow, setAcceptableLow] = useState(event?.acceptable_low?.toString() ?? "");
  const [acceptableHigh, setAcceptableHigh] = useState(event?.acceptable_high?.toString() ?? "");
  const [passFail, setPassFail] = useState(event?.pass_fail ?? "pending");
  const [notes, setNotes] = useState(event?.notes ?? "");

  const mutation = useMutation({
    mutationFn: async () => {
      const url = event
        ? `${API_BASE}/api/veritapt/events/${event.id}`
        : `${API_BASE}/api/veritapt/events`;
      const res = await fetch(url, {
        method: event ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          enrollment_id: Number(enrollmentId),
          event_id: eventId || null,
          event_name: eventName || null,
          event_date: eventDate,
          your_result: yourResult ? Number(yourResult) : null,
          your_method: yourMethod || null,
          peer_mean: peerMean ? Number(peerMean) : null,
          peer_sd: peerSd ? Number(peerSd) : null,
          peer_n: peerN ? Number(peerN) : null,
          acceptable_low: acceptableLow ? Number(acceptableLow) : null,
          acceptable_high: acceptableHigh ? Number(acceptableHigh) : null,
          pass_fail: passFail,
          notes: notes || null,
        }),
      });
      if (!res.ok) throw new Error("Failed to save event");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/veritapt/events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/veritapt/summary"] });
      onClose();
    },
  });

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{event ? "Edit PT Event" : "Add PT Event"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label>Enrollment</Label>
            <Select value={enrollmentId} onValueChange={setEnrollmentId}>
              <SelectTrigger><SelectValue placeholder="Select enrollment" /></SelectTrigger>
              <SelectContent>
                {enrollments.map(e => (
                  <SelectItem key={e.id} value={e.id.toString()}>{e.analyte} - {e.pt_provider} ({e.enrollment_year})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Event ID <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input value={eventId} onChange={e => setEventId(e.target.value)} placeholder="e.g. 2026-A" />
            </div>
            <div className="space-y-1">
              <Label>Event Date</Label>
              <Input type="date" value={eventDate} onChange={e => setEventDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Event Name <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input value={eventName} onChange={e => setEventName(e.target.value)} placeholder="e.g. Survey Event A" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Your Result</Label>
              <Input type="number" step="any" value={yourResult} onChange={e => setYourResult(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Your Method <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input value={yourMethod} onChange={e => setYourMethod(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>Peer Mean</Label>
              <Input type="number" step="any" value={peerMean} onChange={e => setPeerMean(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Peer SD</Label>
              <Input type="number" step="any" value={peerSd} onChange={e => setPeerSd(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Peer N</Label>
              <Input type="number" value={peerN} onChange={e => setPeerN(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">SDI is calculated automatically when Peer Mean and Peer SD are provided.</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Acceptable Low</Label>
              <Input type="number" step="any" value={acceptableLow} onChange={e => setAcceptableLow(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Acceptable High</Label>
              <Input type="number" step="any" value={acceptableHigh} onChange={e => setAcceptableHigh(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Pass / Fail</Label>
            <Select value={passFail} onValueChange={setPassFail}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pass">Pass</SelectItem>
                <SelectItem value="fail">Fail</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
              </SelectContent>
            </Select>
            {passFail === "fail" && (
              <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                <AlertTriangle size={12} /> A corrective action is required for failed PT events.
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label>Notes <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!enrollmentId || mutation.isPending || isReadOnly}>
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : (event ? "Save Changes" : "Add Event")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Corrective Action Dialog ─────────────────────────────────────────────────

function CADialog({
  ca,
  eventId,
  open,
  onClose,
}: {
  ca: PTCorrectiveAction | null;
  eventId: number | null;
  open: boolean;
  onClose: () => void;
}) {
  const isReadOnly = useIsReadOnly('veritapt');
  const queryClient = useQueryClient();
  const today = new Date().toISOString().split("T")[0];
  const [rootCause, setRootCause] = useState(ca?.root_cause ?? "");
  const [correctiveAction, setCorrectiveAction] = useState(ca?.corrective_action ?? "");
  const [preventiveAction, setPreventiveAction] = useState(ca?.preventive_action ?? "");
  const [responsiblePerson, setResponsiblePerson] = useState(ca?.responsible_person ?? "");
  const [dateInitiated, setDateInitiated] = useState(ca?.date_initiated ?? today);
  const [dateCompleted, setDateCompleted] = useState(ca?.date_completed ?? "");
  const [status, setStatus] = useState(ca?.status ?? "open");
  const [verifiedBy, setVerifiedBy] = useState(ca?.verified_by ?? "");
  const [verifiedDate, setVerifiedDate] = useState(ca?.verified_date ?? "");

  const mutation = useMutation({
    mutationFn: async () => {
      const url = ca
        ? `${API_BASE}/api/veritapt/corrective-actions/${ca.id}`
        : `${API_BASE}/api/veritapt/corrective-actions`;
      const res = await fetch(url, {
        method: ca ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          event_id: ca ? ca.event_id : eventId,
          root_cause: rootCause || null,
          corrective_action: correctiveAction,
          preventive_action: preventiveAction || null,
          responsible_person: responsiblePerson || null,
          date_initiated: dateInitiated,
          date_completed: dateCompleted || null,
          status,
          verified_by: verifiedBy || null,
          verified_date: verifiedDate || null,
        }),
      });
      if (!res.ok) throw new Error("Failed to save corrective action");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/veritapt/corrective-actions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/veritapt/summary"] });
      onClose();
    },
  });

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{ca ? "Edit Corrective Action" : "Add Corrective Action"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label>Root Cause</Label>
            <Textarea value={rootCause} onChange={e => setRootCause(e.target.value)} rows={2} placeholder="Describe the root cause of the unacceptable result" />
          </div>
          <div className="space-y-1">
            <Label>Corrective Action <span className="text-red-500">*</span></Label>
            <Textarea value={correctiveAction} onChange={e => setCorrectiveAction(e.target.value)} rows={3} placeholder="Describe the corrective action taken" />
          </div>
          <div className="space-y-1">
            <Label>Preventive Action <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Textarea value={preventiveAction} onChange={e => setPreventiveAction(e.target.value)} rows={2} placeholder="Describe preventive measures implemented" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Responsible Person</Label>
              <Input value={responsiblePerson} onChange={e => setResponsiblePerson(e.target.value)} placeholder="Name or title" />
            </div>
            <div className="space-y-1">
              <Label>Date Initiated</Label>
              <Input type="date" value={dateInitiated} onChange={e => setDateInitiated(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Date Completed <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input type="date" value={dateCompleted} onChange={e => setDateCompleted(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Verified By <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input value={verifiedBy} onChange={e => setVerifiedBy(e.target.value)} placeholder="Name, credentials" />
            </div>
          </div>
          {verifiedBy && (
            <div className="space-y-1">
              <Label>Verified Date <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input type="date" value={verifiedDate} onChange={e => setVerifiedDate(e.target.value)} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!correctiveAction.trim() || mutation.isPending || isReadOnly}>
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : (ca ? "Save Changes" : "Add Corrective Action")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function VeritaPTAppPage() {
  const { user, isLoggedIn } = useAuth();
  const queryClient = useQueryClient();

  const hasPlanAccess =
    user?.plan === "annual" ||
    user?.plan === "professional" ||
    user?.plan === "lab" ||
    user?.plan === "complete" ||
    user?.plan === "veritamap" ||
    user?.plan === "veritascan" ||
    user?.plan === "veritacomp";

  // Dialog states
  const [enrollmentDialog, setEnrollmentDialog] = useState<{ open: boolean; enrollment: PTEnrollment | null }>({ open: false, enrollment: null });
  const [eventDialog, setEventDialog] = useState<{ open: boolean; event: PTEvent | null }>({ open: false, event: null });
  const [caDialog, setCADialog] = useState<{ open: boolean; ca: PTCorrectiveAction | null; eventId: number | null }>({ open: false, ca: null, eventId: null });
  const [eventFilter, setEventFilter] = useState<string>("all");
  const [passfailFilter, setPassfailFilter] = useState<string>("all");
  const [pdfLoading, setPdfLoading] = useState(false);

  // Queries
  const { data: summary } = useQuery<PTSummary>({
    queryKey: ["/api/veritapt/summary"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/veritapt/summary`, { headers: authHeaders() });
      if (!res.ok) throw new Error("Failed to fetch summary");
      return res.json();
    },
    enabled: isLoggedIn && hasPlanAccess,
  });

  const { data: enrollments = [] } = useQuery<PTEnrollment[]>({
    queryKey: ["/api/veritapt/enrollments"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/veritapt/enrollments`, { headers: authHeaders() });
      if (!res.ok) throw new Error("Failed to fetch enrollments");
      return res.json();
    },
    enabled: isLoggedIn && hasPlanAccess,
  });

  const { data: events = [] } = useQuery<PTEvent[]>({
    queryKey: ["/api/veritapt/events"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/veritapt/events`, { headers: authHeaders() });
      if (!res.ok) throw new Error("Failed to fetch events");
      return res.json();
    },
    enabled: isLoggedIn && hasPlanAccess,
  });

  const { data: correctiveActions = [] } = useQuery<PTCorrectiveAction[]>({
    queryKey: ["/api/veritapt/corrective-actions"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/veritapt/corrective-actions`, { headers: authHeaders() });
      if (!res.ok) throw new Error("Failed to fetch corrective actions");
      return res.json();
    },
    enabled: isLoggedIn && hasPlanAccess,
  });

  const { data: recData, isLoading: recLoading } = useQuery({
    queryKey: ['veritapt-recommendations'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/veritapt/recommendations`, { headers: authHeaders() });
      if (!res.ok) throw new Error('Failed to fetch recommendations');
      return res.json();
    },
    enabled: !!localStorage.getItem('veritas_token'),
  });

  // Delete mutations
  const deleteEnrollment = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${API_BASE}/api/veritapt/enrollments/${id}`, { method: "DELETE", headers: authHeaders() });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/veritapt/enrollments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/veritapt/events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/veritapt/summary"] });
    },
  });

  const deleteEvent = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${API_BASE}/api/veritapt/events/${id}`, { method: "DELETE", headers: authHeaders() });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/veritapt/events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/veritapt/summary"] });
    },
  });

  // PDF download
  async function downloadPDF() {
    setPdfLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/veritapt/pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
      });
      if (!res.ok) throw new Error("PDF generation failed");
      const { token: pdfToken } = await res.json();
      const a = document.createElement("a");
      a.href = `/api/pdf/${pdfToken}`;
      const date = new Date().toISOString().split("T")[0];
      a.download = `VeritaPT_Report_${date}.pdf`;
      a.click();
    } catch (err) {
      console.error("PDF error:", err);
    } finally {
      setPdfLoading(false);
    }
  }

  // Filtered events
  const filteredEvents = events.filter(ev => {
    if (eventFilter !== "all" && ev.enrollment_id.toString() !== eventFilter) return false;
    if (passfailFilter !== "all" && ev.pass_fail !== passfailFilter) return false;
    return true;
  });

  // CA lookup by event_id
  const caByEventId = new Map<number, PTCorrectiveAction>();
  for (const ca of correctiveActions) {
    caByEventId.set(ca.event_id, ca);
  }

  // ── Auth gates ────────────────────────────────────────────────────────────

  if (!isLoggedIn) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-primary/10 mb-4">
            <Lock className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Sign in to access VeritaPT{"\u2122"}</h1>
          <p className="text-muted-foreground text-sm mb-6">VeritaPT{"\u2122"} requires an account. Sign in to continue.</p>
          <Button asChild><Link href="/login">Sign In</Link></Button>
        </div>
      </div>
    );
  }

  if (!hasPlanAccess) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-amber-100 dark:bg-amber-950/30 mb-4">
            <FlaskConical className="h-7 w-7 text-amber-600" />
          </div>
          <h1 className="text-2xl font-bold mb-2">VeritaPT{"\u2122"} Access Required</h1>
          <p className="text-muted-foreground text-sm mb-6">
            Your current plan does not include VeritaPT{"\u2122"}. Upgrade to access PT tracking.
          </p>
          <Button asChild><Link href="/veritapt">View Plans</Link></Button>
        </div>
      </div>
    );
  }

  // ── Main Dashboard ─────────────────────────────────────────────────────────

  return (
    <div className="container-default py-8 space-y-8">
      {/* Page header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FlaskConical size={22} className="text-primary" />
            VeritaPT{"\u2122"}
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">Proficiency Testing Tracking</p>
        </div>
        <Button onClick={downloadPDF} disabled={pdfLoading} variant="outline" size="sm">
          {pdfLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileDown size={15} className="mr-2" />}
          Download PT Report
        </Button>
      </div>

      {/* KPI Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Active Enrollments", value: summary?.totalEnrollments ?? 0, icon: <ClipboardList size={16} />, color: "text-primary" },
          { label: "Events This Year", value: summary?.eventsThisYear ?? 0, icon: <CheckCircle2 size={16} />, color: "text-primary" },
          { label: "Pass Rate", value: summary ? `${summary.passRate.toFixed(1)}%` : "-", icon: <CheckCircle2 size={16} />, color: "text-emerald-600" },
          { label: "Open Corrective Actions", value: summary?.openCorrectiveActions ?? 0, icon: <AlertTriangle size={16} />, color: summary?.openCorrectiveActions ? "text-red-500" : "text-muted-foreground" },
        ].map((kpi) => (
          <Card key={kpi.label}>
            <CardContent className="p-4 flex flex-col gap-1">
              <div className={`flex items-center gap-1.5 text-xs text-muted-foreground ${kpi.color}`}>{kpi.icon}{kpi.label}</div>
              <div className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Enrollments */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">PT Enrollments</h2>
          <Button size="sm" onClick={() => setEnrollmentDialog({ open: true, enrollment: null })}>
            <Plus size={15} className="mr-1" /> Add Enrollment
          </Button>
        </div>
        {enrollments.length === 0 ? (
          <Card><CardContent className="p-8 text-center text-muted-foreground text-sm">No enrollments yet. Add your first PT enrollment above.</CardContent></Card>
        ) : (
          <div className="rounded-lg border border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  {["Analyte", "Specialty", "PT Provider", "Program Code", "Year", "Status", ""].map(h => (
                    <th key={h} className="text-left px-3 py-2 font-medium text-xs text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {enrollments.map(e => (
                  <tr key={e.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                    <td className="px-3 py-2 font-medium">{e.analyte}</td>
                    <td className="px-3 py-2">{e.specialty}</td>
                    <td className="px-3 py-2">{e.pt_provider}</td>
                    <td className="px-3 py-2 text-muted-foreground">{e.program_code || "-"}</td>
                    <td className="px-3 py-2">{e.enrollment_year}</td>
                    <td className="px-3 py-2"><StatusBadge value={e.status} /></td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEnrollmentDialog({ open: true, enrollment: e })}>
                          <Pencil size={13} />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-600" onClick={() => { if (confirm("Delete this enrollment and all its events?")) deleteEnrollment.mutate(e.id); }}>
                          <Trash2 size={13} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Events */}
      <div>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="text-lg font-semibold">PT Survey Events</h2>
          <div className="flex items-center gap-2">
            <Select value={eventFilter} onValueChange={setEventFilter}>
              <SelectTrigger className="h-8 text-xs w-40"><SelectValue placeholder="All enrollments" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Enrollments</SelectItem>
                {enrollments.map(e => <SelectItem key={e.id} value={e.id.toString()}>{e.analyte} {e.enrollment_year}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={passfailFilter} onValueChange={setPassfailFilter}>
              <SelectTrigger className="h-8 text-xs w-32"><SelectValue placeholder="All results" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Results</SelectItem>
                <SelectItem value="pass">Pass</SelectItem>
                <SelectItem value="fail">Fail</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" onClick={() => setEventDialog({ open: true, event: null })} disabled={enrollments.length === 0}>
              <Plus size={15} className="mr-1" /> Add Event
            </Button>
          </div>
        </div>
        {filteredEvents.length === 0 ? (
          <Card><CardContent className="p-8 text-center text-muted-foreground text-sm">
            {enrollments.length === 0 ? "Add an enrollment before logging events." : "No events match the current filter."}
          </CardContent></Card>
        ) : (
          <div className="rounded-lg border border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  {["Date", "Analyte", "Event ID", "Your Result", "Peer Mean", "SDI", "Result", "CA", ""].map(h => (
                    <th key={h} className="text-left px-3 py-2 font-medium text-xs text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredEvents.map(ev => {
                  const ca = caByEventId.get(ev.id);
                  return (
                    <tr key={ev.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                      <td className="px-3 py-2 whitespace-nowrap">{ev.event_date}</td>
                      <td className="px-3 py-2 font-medium">{ev.analyte}</td>
                      <td className="px-3 py-2 text-muted-foreground">{ev.event_id || "-"}</td>
                      <td className="px-3 py-2">{ev.your_result ?? "-"}</td>
                      <td className="px-3 py-2">{ev.peer_mean ?? "-"}</td>
                      <td className="px-3 py-2">{ev.sdi != null ? ev.sdi.toFixed(2) : "-"}</td>
                      <td className="px-3 py-2"><PassFailBadge value={ev.pass_fail} /></td>
                      <td className="px-3 py-2">
                        {ev.pass_fail === "fail" && ca && (
                          <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => setCADialog({ open: true, ca, eventId: ev.id })}>
                            View CA
                          </Button>
                        )}
                        {ev.pass_fail === "fail" && !ca && (
                          <Button variant="ghost" size="sm" className="h-6 text-xs px-2 text-amber-600" onClick={() => setCADialog({ open: true, ca: null, eventId: ev.id })}>
                            Add CA
                          </Button>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEventDialog({ open: true, event: ev })}>
                            <Pencil size={13} />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-600" onClick={() => { if (confirm("Delete this event?")) deleteEvent.mutate(ev.id); }}>
                            <Trash2 size={13} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Corrective Actions */}
      {correctiveActions.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3">Corrective Actions</h2>
          <div className="rounded-lg border border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  {["Analyte", "Event Date", "Root Cause", "Corrective Action", "Status", "Verified By", ""].map(h => (
                    <th key={h} className="text-left px-3 py-2 font-medium text-xs text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {correctiveActions.map(ca => {
                  const ev = events.find(e => e.id === ca.event_id);
                  return (
                    <tr key={ca.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                      <td className="px-3 py-2 font-medium">{ev?.analyte ?? "-"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{ev?.event_date ?? "-"}</td>
                      <td className="px-3 py-2 text-muted-foreground max-w-[160px]">{trunc(ca.root_cause, 60)}</td>
                      <td className="px-3 py-2 max-w-[160px]">{trunc(ca.corrective_action, 60)}</td>
                      <td className="px-3 py-2"><StatusBadge value={ca.status} /></td>
                      <td className="px-3 py-2 text-muted-foreground">{ca.verified_by || "-"}</td>
                      <td className="px-3 py-2">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCADialog({ open: true, ca, eventId: ca.event_id })}>
                          <Pencil size={13} />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* PT Program Recommendations */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-purple-600" />
          <h2 className="text-lg font-semibold text-gray-900">PT Program Recommendations</h2>
          <span className="text-sm text-gray-500 ml-1">Based on your VeritaMap test menu</span>
          {recData?.preferredVendor && recData.preferredVendor !== 'none' && (
            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded ml-auto">
              Preferred: {recData.preferredVendor.toUpperCase()}
            </span>
          )}
        </div>
        <div className="p-6">
          {recLoading ? (
            <p className="text-gray-500 text-sm">Analyzing your test menu...</p>
          ) : !recData?.hasMap ? (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <p className="text-amber-800 font-medium">No VeritaMap found</p>
              <p className="text-amber-700 text-sm mt-1">Build your test menu in VeritaMap to receive PT program recommendations.</p>
              <a href="/#/veritamap" className="text-amber-700 underline text-sm mt-2 inline-block">{"Go to VeritaMap \u2192"}</a>
            </div>
          ) : (
            <div className="space-y-6">

              {/* Gaps Alert */}
              {recData.gaps?.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                  <p className="text-amber-800 font-semibold mb-1">Analytes with no PT enrollment ({recData.gaps.length})</p>
                  <p className="text-amber-700 text-sm mb-2">The following analytes on your test menu have no active PT enrollment:</p>
                  <div className="flex flex-wrap gap-2">
                    {recData.gaps.map((analyte: string) => (
                      <span key={analyte} className="bg-amber-100 text-amber-800 text-xs font-medium px-2 py-1 rounded">
                        {analyte}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Recommended Programs */}
              {recData.recommendations?.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Recommended Programs</h3>
                  <div className="space-y-3">
                    {recData.recommendations.map((rec: any, idx: number) => (
                      <div key={idx} className="border border-gray-200 rounded-lg p-4 flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-xs font-bold px-2 py-0.5 rounded ${rec.provider === 'CAP' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'}`}>
                              {rec.provider}
                            </span>
                            <span className="text-sm font-medium text-gray-900">{rec.catalogNumber}</span>
                            <span className="text-sm text-gray-700">{rec.programName}</span>
                          </div>
                          <p className="text-xs text-gray-600">
                            Covers {rec.coverageCount} gap analyte{rec.coverageCount !== 1 ? 's' : ''}: {rec.gapAnalytesCovered.join(', ')}
                          </p>
                        </div>
                        <a
                          href={rec.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 whitespace-nowrap"
                        >
                          Order
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* No gaps - all covered */}
              {recData.gaps?.length === 0 && recData.nonWaived?.length > 0 && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <p className="text-green-800 font-semibold">All non-waived analytes are enrolled in PT</p>
                  <p className="text-green-700 text-sm mt-1">Great job - your PT enrollment covers your entire non-waived test menu.</p>
                </div>
              )}

              {/* Already Covered */}
              {recData.alreadyCovered?.length > 0 && (
                <details className="group">
                  <summary className="cursor-pointer text-sm font-semibold text-gray-600 flex items-center gap-2 list-none">
                    <span className="group-open:rotate-90 transition-transform inline-block">{"\u25B6"}</span>
                    Already Covered ({recData.alreadyCovered.length} analytes)
                  </summary>
                  <div className="mt-2 flex flex-wrap gap-2 pl-4">
                    {recData.alreadyCovered.map((analyte: string) => (
                      <span key={analyte} className="bg-green-100 text-green-800 text-xs font-medium px-2 py-1 rounded flex items-center gap-1">
                        {"\u2713"} {analyte}
                      </span>
                    ))}
                  </div>
                </details>
              )}

              {/* Waived Tests */}
              {recData.waived?.length > 0 && (
                <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                  <p className="text-sm font-semibold text-gray-700 mb-1">
                    Waived Tests ({recData.waived.length})
                  </p>
                  <p className="text-xs text-gray-500 mb-2">
                    {"PT not required for waived testing per CLIA (42 CFR \u00A7493.15)"}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {recData.waived.map((item: any) => (
                      <span key={item.analyte} className="bg-white border border-gray-200 text-gray-600 text-xs font-medium px-2 py-1 rounded">
                        {item.analyte}
                      </span>
                    ))}
                  </div>
                </div>
              )}

            </div>
          )}
        </div>
      </div>

      {/* Dialogs */}
      <EnrollmentDialog
        enrollment={enrollmentDialog.enrollment}
        open={enrollmentDialog.open}
        onClose={() => setEnrollmentDialog({ open: false, enrollment: null })}
        onSaved={() => {}}
        defaultProvider={recData?.preferredVendor === 'api' ? 'API' : 'CAP'}
      />
      <EventDialog
        event={eventDialog.event}
        enrollments={enrollments}
        open={eventDialog.open}
        onClose={() => setEventDialog({ open: false, event: null })}
      />
      <CADialog
        ca={caDialog.ca}
        eventId={caDialog.eventId}
        open={caDialog.open}
        onClose={() => setCADialog({ open: false, ca: null, eventId: null })}
      />
    </div>
  );
}
