import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { useAuth } from "@/components/AuthContext";
import { useIsReadOnly } from "@/components/SubscriptionBanner";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { saveAs } from "file-saver";
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
  Plus, Lock, Users, Award, FileDown, Edit2, Trash2, Upload,
  Download, FileText, AlertTriangle, CheckCircle2, Clock, X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ── Types ──────────────────────────────────────────────────────────────
interface Certificate {
  id: number;
  user_id: number;
  cert_type: string;
  cert_name: string;
  cert_number: string | null;
  issuing_body: string | null;
  issued_date: string | null;
  expiration_date: string | null;
  lab_director: string | null;
  notes: string | null;
  is_auto_populated: number;
  is_active: number;
  document_count: number;
  created_at: string;
  updated_at: string;
}

interface CertDocument {
  id: number;
  certificate_id: number;
  filename: string;
  original_filename: string;
  file_size: number;
  mime_type: string;
  uploaded_at: string;
}

const CERT_TYPES = [
  { value: "clia", label: "CLIA Certificate", issuing_body: "Centers for Medicare and Medicaid Services (CMS)" },
  { value: "cap", label: "CAP Accreditation", issuing_body: "College of American Pathologists" },
  { value: "tjc", label: "TJC Accreditation", issuing_body: "The Joint Commission" },
  { value: "state_license", label: "State Laboratory License", issuing_body: "" },
  { value: "lab_director_license", label: "Lab Director License", issuing_body: "" },
  { value: "other", label: "Other", issuing_body: "" },
];

const TYPE_COLORS: Record<string, string> = {
  clia: "bg-teal-500/10 text-teal-700 border-teal-500/20",
  cap: "bg-blue-500/10 text-blue-700 border-blue-500/20",
  tjc: "bg-purple-500/10 text-purple-700 border-purple-500/20",
  state_license: "bg-orange-500/10 text-orange-700 border-orange-500/20",
  lab_director_license: "bg-orange-500/10 text-orange-700 border-orange-500/20",
  other: "bg-muted text-muted-foreground border-border",
};

function getExpirationStatus(expirationDate: string | null): { label: string; color: string; days?: number } {
  if (!expirationDate) return { label: "No expiration date", color: "bg-muted text-muted-foreground border-border" };
  const exp = new Date(expirationDate);
  const now = new Date();
  const diffMs = exp.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return { label: "Expired", color: "bg-red-500/10 text-red-600 border-red-500/20", days: diffDays };
  if (diffDays <= 30) return { label: `Expires in ${diffDays} days`, color: "bg-red-500/10 text-red-600 border-red-500/20", days: diffDays };
  if (diffDays <= 90) return { label: `Expires in ${diffDays} days`, color: "bg-amber-500/10 text-amber-600 border-amber-500/20", days: diffDays };
  return { label: "Current", color: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20", days: diffDays };
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function VeritaLabAppPage() {
  const { user, isLoggedIn } = useAuth();
  const isReadOnly = useIsReadOnly();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editCert, setEditCert] = useState<Certificate | null>(null);

  // Form state
  const [formType, setFormType] = useState("other");
  const [formName, setFormName] = useState("");
  const [formNumber, setFormNumber] = useState("");
  const [formIssuingBody, setFormIssuingBody] = useState("");
  const [formIssuedDate, setFormIssuedDate] = useState("");
  const [formExpDate, setFormExpDate] = useState("");
  const [formDirector, setFormDirector] = useState("");
  const [formNotes, setFormNotes] = useState("");

  // Document state
  const [showDocModal, setShowDocModal] = useState(false);
  const [docCertId, setDocCertId] = useState<number | null>(null);
  const [documents, setDocuments] = useState<CertDocument[]>([]);
  const [docLoading, setDocLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  const hasPlanAccess = user && ["annual", "professional", "lab", "complete", "veritamap", "veritascan", "veritacomp", "waived", "community", "hospital", "large_hospital", "enterprise"].includes(user.plan);

  async function loadCertificates() {
    try {
      const res = await fetch(`${API_BASE}/api/veritalab/certificates`, { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setCertificates(data);
      }
    } catch (err) {
      console.error("Failed to load certificates:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isLoggedIn && hasPlanAccess) loadCertificates();
    else setLoading(false);
  }, [isLoggedIn, hasPlanAccess]);

  function openAddModal() {
    setEditCert(null);
    setFormType("other");
    setFormName("");
    setFormNumber("");
    setFormIssuingBody("");
    setFormIssuedDate("");
    setFormExpDate("");
    setFormDirector("");
    setFormNotes("");
    setShowModal(true);
  }

  function openEditModal(cert: Certificate) {
    setEditCert(cert);
    setFormType(cert.cert_type);
    setFormName(cert.cert_name);
    setFormNumber(cert.cert_number || "");
    setFormIssuingBody(cert.issuing_body || "");
    setFormIssuedDate(cert.issued_date || "");
    setFormExpDate(cert.expiration_date || "");
    setFormDirector(cert.lab_director || "");
    setFormNotes(cert.notes || "");
    setShowModal(true);
  }

  function onTypeChange(type: string) {
    setFormType(type);
    const preset = CERT_TYPES.find(t => t.value === type);
    if (preset && !editCert) {
      setFormName(preset.label);
      if (preset.issuing_body) setFormIssuingBody(preset.issuing_body);
    }
  }

  async function handleSave() {
    if (!formName.trim()) {
      toast({ title: "Certificate name required", variant: "destructive" });
      return;
    }

    const body = {
      cert_type: formType,
      cert_name: formName.trim(),
      cert_number: formNumber || null,
      issuing_body: formIssuingBody || null,
      issued_date: formIssuedDate || null,
      expiration_date: formExpDate || null,
      lab_director: formDirector || null,
      notes: formNotes || null,
    };

    try {
      const url = editCert
        ? `${API_BASE}/api/veritalab/certificates/${editCert.id}`
        : `${API_BASE}/api/veritalab/certificates`;
      const method = editCert ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        toast({ title: editCert ? "Certificate updated" : "Certificate added" });
        setShowModal(false);
        loadCertificates();
      } else {
        const err = await res.json();
        toast({ title: err.error || "Failed to save", variant: "destructive" });
      }
    } catch (err) {
      toast({ title: "Failed to save certificate", variant: "destructive" });
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Remove this certificate?")) return;
    try {
      const res = await fetch(`${API_BASE}/api/veritalab/certificates/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (res.ok) {
        toast({ title: "Certificate removed" });
        loadCertificates();
      }
    } catch (err) {
      toast({ title: "Failed to delete", variant: "destructive" });
    }
  }

  async function openDocuments(certId: number) {
    setDocCertId(certId);
    setShowDocModal(true);
    setDocLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/veritalab/certificates/${certId}/documents`, { headers: authHeaders() });
      if (res.ok) setDocuments(await res.json());
    } catch (err) {
      console.error("Failed to load documents:", err);
    } finally {
      setDocLoading(false);
    }
  }

  async function handleUpload(certId: number, file: File) {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const headers: Record<string, string> = {};
      const token = authHeaders()["Authorization"];
      if (token) headers["Authorization"] = token;

      const res = await fetch(`${API_BASE}/api/veritalab/certificates/${certId}/documents`, {
        method: "POST",
        headers,
        body: formData,
      });

      if (res.ok) {
        toast({ title: "Document uploaded" });
        // Refresh documents list
        const docsRes = await fetch(`${API_BASE}/api/veritalab/certificates/${certId}/documents`, { headers: authHeaders() });
        if (docsRes.ok) setDocuments(await docsRes.json());
        loadCertificates(); // Refresh cert list for document count
      } else {
        const err = await res.json();
        toast({ title: err.error || "Upload failed", variant: "destructive" });
      }
    } catch (err) {
      toast({ title: "Upload failed", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  async function handleDownloadDoc(certId: number, docId: number, filename: string) {
    try {
      const res = await fetch(`${API_BASE}/api/veritalab/certificates/${certId}/documents/${docId}`, {
        headers: authHeaders(),
      });
      if (res.ok) {
        const blob = await res.blob();
        saveAs(blob, filename);
      }
    } catch (err) {
      toast({ title: "Download failed", variant: "destructive" });
    }
  }

  async function handleDeleteDoc(certId: number, docId: number) {
    if (!confirm("Delete this document?")) return;
    try {
      const res = await fetch(`${API_BASE}/api/veritalab/certificates/${certId}/documents/${docId}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (res.ok) {
        toast({ title: "Document deleted" });
        const docsRes = await fetch(`${API_BASE}/api/veritalab/certificates/${certId}/documents`, { headers: authHeaders() });
        if (docsRes.ok) setDocuments(await docsRes.json());
        loadCertificates();
      }
    } catch (err) {
      toast({ title: "Delete failed", variant: "destructive" });
    }
  }

  async function handleExcelExport() {
    try {
      const res = await fetch(`${API_BASE}/api/veritalab/certificates/excel`, {
        method: "POST",
        headers: authHeaders(),
      });
      if (res.ok) {
        const blob = await res.blob();
        saveAs(blob, `VeritaLab_Certificates_${new Date().toISOString().split("T")[0]}.xlsx`);
      }
    } catch (err) {
      toast({ title: "Export failed", variant: "destructive" });
    }
  }

  // ── Auth gates ──
  if (!isLoggedIn) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
        <Lock size={40} className="text-muted-foreground mb-4" />
        <h2 className="font-serif text-2xl font-bold mb-2">Sign in to access VeritaLab{"™"}</h2>
        <p className="text-muted-foreground mb-6 max-w-md">Certificate tracking, document archive, and renewal reminders for your laboratory.</p>
        <Button asChild size="lg" className="bg-primary hover:bg-primary/90">
          <Link href="/login">Sign In</Link>
        </Button>
      </div>
    );
  }

  if (!hasPlanAccess) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
        <Users size={40} className="text-muted-foreground mb-4" />
        <h2 className="font-serif text-2xl font-bold mb-2">Upgrade to access VeritaLab{"™"}</h2>
        <p className="text-muted-foreground mb-6 max-w-md">VeritaLab is included in all VeritaAssure plans. Subscribe to get started.</p>
        <Button asChild size="lg" className="bg-primary hover:bg-primary/90">
          <Link href="/veritacheck">View Plans</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="container-default py-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="font-serif text-3xl font-bold flex items-center gap-2">
              <Award size={28} className="text-primary" />
              VeritaLab{"™"} - Certificate Tracking
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Track certificates, store documents, and get renewal reminders.
            </p>
          </div>
          <div className="flex gap-2">
            {certificates.length > 0 && (
              <Button variant="outline" size="sm" onClick={handleExcelExport}>
                <FileDown size={14} className="mr-1.5" /> Export Excel
              </Button>
            )}
            <Button size="sm" onClick={openAddModal} disabled={isReadOnly} className="bg-primary hover:bg-primary/90">
              <Plus size={14} className="mr-1.5" /> Add Certificate
            </Button>
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="text-center py-12 text-muted-foreground">Loading certificates...</div>
        )}

        {/* Empty state */}
        {!loading && certificates.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="p-12 text-center">
              <Award size={40} className="text-muted-foreground mx-auto mb-4" />
              <h3 className="font-semibold text-lg mb-2">No certificates yet</h3>
              <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                Add your CLIA certificate, accreditations, state licenses, and lab director credentials.
                {user?.cliaNumber && " Your CLIA certificate will be auto-populated when you refresh."}
              </p>
              <Button onClick={openAddModal} className="bg-primary hover:bg-primary/90">
                <Plus size={14} className="mr-1.5" /> Add Your First Certificate
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Certificate cards */}
        <div className="grid gap-4">
          {certificates.map((cert) => {
            const status = getExpirationStatus(cert.expiration_date);
            const typeColor = TYPE_COLORS[cert.cert_type] || TYPE_COLORS.other;
            const showExpPrompt = !cert.expiration_date && cert.is_auto_populated === 1;

            return (
              <Card key={cert.id} className="hover:border-primary/30 transition-colors">
                <CardContent className="p-5">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <h3 className="font-semibold text-lg">{cert.cert_name}</h3>
                        <Badge variant="outline" className={typeColor}>
                          {CERT_TYPES.find(t => t.value === cert.cert_type)?.label || cert.cert_type}
                        </Badge>
                        <Badge variant="outline" className={status.color}>
                          {status.label}
                        </Badge>
                      </div>

                      {showExpPrompt && (
                        <div className="bg-amber-50 border border-amber-300 text-amber-800 rounded px-3 py-2 text-sm mb-3 flex items-center gap-2">
                          <AlertTriangle size={14} className="shrink-0" />
                          Enter expiration date to activate reminders
                        </div>
                      )}

                      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm text-muted-foreground">
                        {cert.cert_number && (
                          <div><span className="font-medium text-foreground">Number:</span> {cert.cert_number}</div>
                        )}
                        {cert.issuing_body && (
                          <div><span className="font-medium text-foreground">Issued by:</span> {cert.issuing_body}</div>
                        )}
                        {cert.expiration_date && (
                          <div><span className="font-medium text-foreground">Expires:</span> {new Date(cert.expiration_date).toLocaleDateString()}</div>
                        )}
                        {cert.lab_director && (
                          <div><span className="font-medium text-foreground">Director:</span> {cert.lab_director}</div>
                        )}
                      </div>

                      {cert.notes && (
                        <p className="text-xs text-muted-foreground mt-2 italic">{cert.notes}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Button variant="outline" size="sm" onClick={() => openDocuments(cert.id)} className="gap-1.5">
                        <FileText size={13} />
                        {cert.document_count > 0 ? `${cert.document_count} doc${cert.document_count > 1 ? "s" : ""}` : "Documents"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setDocCertId(cert.id);
                          fileInputRef.current?.click();
                        }}
                        disabled={isReadOnly}
                      >
                        <Upload size={13} />
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => openEditModal(cert)} disabled={isReadOnly}>
                        <Edit2 size={13} />
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => handleDelete(cert.id)} disabled={isReadOnly} className="text-destructive hover:text-destructive">
                        <Trash2 size={13} />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Hidden file input for uploads */}
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file && docCertId) {
              handleUpload(docCertId, file);
            }
            e.target.value = "";
          }}
        />

        {/* Add/Edit Certificate Modal */}
        <Dialog open={showModal} onOpenChange={setShowModal}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editCert ? "Edit Certificate" : "Add Certificate"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1 block">Certificate Type</label>
                <Select value={formType} onValueChange={onTypeChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CERT_TYPES.map(t => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">Certificate Name</label>
                <Input value={formName} onChange={e => setFormName(e.target.value)} placeholder="e.g. CLIA Certificate" />
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">Certificate Number</label>
                <Input value={formNumber} onChange={e => setFormNumber(e.target.value)} placeholder="e.g. 22D0426713" />
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">Issuing Body</label>
                <Input value={formIssuingBody} onChange={e => setFormIssuingBody(e.target.value)} placeholder="e.g. CMS, CAP, TJC" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">Issued Date</label>
                  <Input type="date" value={formIssuedDate} onChange={e => setFormIssuedDate(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Expiration Date</label>
                  <Input type="date" value={formExpDate} onChange={e => setFormExpDate(e.target.value)} />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">Laboratory Director</label>
                <Input value={formDirector} onChange={e => setFormDirector(e.target.value)} placeholder="Name on certificate" />
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">Notes</label>
                <Textarea value={formNotes} onChange={e => setFormNotes(e.target.value)} rows={3} placeholder="Optional notes" />
              </div>

              <div className="flex gap-2 pt-2">
                <Button onClick={handleSave} className="flex-1 bg-primary hover:bg-primary/90">
                  {editCert ? "Save Changes" : "Add Certificate"}
                </Button>
                <Button variant="outline" onClick={() => setShowModal(false)}>Cancel</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Documents Modal */}
        <Dialog open={showDocModal} onOpenChange={setShowDocModal}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Documents</DialogTitle>
            </DialogHeader>

            {docLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading documents...</div>
            ) : documents.length === 0 ? (
              <div className="text-center py-8">
                <FileText size={32} className="text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground text-sm mb-4">No documents uploaded yet.</p>
                <Button
                  size="sm"
                  onClick={() => {
                    if (docCertId) fileInputRef.current?.click();
                  }}
                  disabled={isReadOnly || uploading}
                >
                  <Upload size={13} className="mr-1.5" /> Upload Document
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {documents.map(doc => (
                  <div key={doc.id} className="flex items-center justify-between border rounded-lg px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{doc.original_filename}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatFileSize(doc.file_size)} - {new Date(doc.uploaded_at).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button variant="ghost" size="sm" onClick={() => handleDownloadDoc(docCertId!, doc.id, doc.original_filename)}>
                        <Download size={13} />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDeleteDoc(docCertId!, doc.id)} disabled={isReadOnly} className="text-destructive hover:text-destructive">
                        <Trash2 size={13} />
                      </Button>
                    </div>
                  </div>
                ))}
                <div className="pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (docCertId) fileInputRef.current?.click();
                    }}
                    disabled={isReadOnly || uploading}
                    className="w-full"
                  >
                    <Upload size={13} className="mr-1.5" /> {uploading ? "Uploading..." : "Upload Another Document"}
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
