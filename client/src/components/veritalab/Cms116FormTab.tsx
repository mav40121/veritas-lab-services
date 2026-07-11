// CMS-116 form-fill tab (parking-lot #22 Phase 3).
//
// Renders the federal CLIA Application for Certification (CMS Form 116,
// OMB control 0938-0581) as a fillable web form, persisted per-lab to
// cms116_drafts. The lab director downloads the draft as a PDF
// (Phase 4), wet-signs it, and mails it to their State Agency.
//
// Field layout sourced from the current public CMS-116 form on
// https://www.cms.gov (the form is publicly distributed by CMS).
// Spot-check by Michael (MLS(ASCP), former TJC surveyor) is the
// editorial gate before merge; the form layout has been stable for
// years but CMS does occasionally republish revisions.
//
// Sections I-X follow the official form headings:
//   I.   General Information
//   II.  Type of Certificate Requested
//   III. Type of Laboratory
//   IV.  Hours of Laboratory Testing
//   V.   Multiple Sites
//   VI.  Waived Testing
//   VII. Provider-Performed Microscopy Procedures
//   VIII. Non-Waived Testing (Specialty / Subspecialty)
//   IX.  Total Annual Test Volume
//   X.   Type of Control / Director Information
//
// The PUT /api/labs/:labId/veritalab/cms116-draft endpoint upserts
// one row per lab. Each section is stored as a JSON blob so future
// CMS form revisions can land via Phase-3 component updates without
// a schema migration.

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { FileSignature, Save, CheckCircle2, AlertTriangle } from "lucide-react";

interface SectionI {
  legal_name: string;
  dba: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  county: string;
  telephone: string;
  fax: string;
  email: string;
  federal_tax_id: string;
}

interface SectionII {
  certificate_type: "" | "waiver" | "ppm" | "compliance" | "accreditation";
  accrediting_org: string; // only relevant if certificate_type === "accreditation"
}

interface SectionIII {
  lab_type: string; // one of LAB_TYPES below
  lab_type_other: string;
}

interface SectionIV {
  hours_per_week: string;
}

interface SectionV {
  multiple_sites: "" | "yes" | "no";
  sites_text: string; // free-text list of additional addresses
}

interface SectionVI {
  has_waived_testing: "" | "yes" | "no";
  estimated_annual_volume: string;
}

interface SectionVII {
  has_ppm: "" | "yes" | "no";
  estimated_annual_volume: string;
}

interface SectionVIII {
  // Specialty / subspecialty checkboxes (non-waived testing per 42 CFR 493.5)
  histocompatibility: boolean;
  micro_bacteriology: boolean;
  micro_mycobacteriology: boolean;
  micro_mycology: boolean;
  micro_parasitology: boolean;
  micro_virology: boolean;
  immuno_syphilis_serology: boolean;
  immuno_general: boolean;
  chem_routine: boolean;
  chem_urinalysis: boolean;
  chem_endocrinology: boolean;
  chem_toxicology: boolean;
  hematology: boolean;
  immunohem_abo_rh: boolean;
  immunohem_antibody_detection: boolean;
  immunohem_antibody_id: boolean;
  immunohem_compatibility: boolean;
  pathology_histopathology: boolean;
  pathology_oral: boolean;
  pathology_cytology: boolean;
  radiobioassay: boolean;
  clinical_cytogenetics: boolean;
}

interface SectionIX {
  total_annual_volume: string;
}

interface SectionX {
  control_type: "" | "sole_proprietorship" | "partnership" | "corporation" | "government" | "other";
  control_other: string;
  director_name: string;
  director_credentials: string;
  director_npi: string;
  director_clia_director_number: string; // CLIA director ID if known
}

interface DraftPayload {
  sections: {
    i: SectionI;
    ii: SectionII;
    iii: SectionIII;
    iv: SectionIV;
    v: SectionV;
    vi: SectionVI;
    vii: SectionVII;
    viii: SectionVIII;
    ix: SectionIX;
    x: SectionX;
  };
  director_signature_name: string;
  director_signature_date: string;
  status: "draft" | "submitted" | "issued";
  notes: string;
}

const LAB_TYPES = [
  "Ambulatory Surgical Center",
  "Ancillary Testing Site in Health Care Facility",
  "Assisted Living Facility",
  "Blood Banks",
  "Community Clinic",
  "Comprehensive Outpatient Rehab Facility",
  "End-Stage Renal Disease Dialysis Facility",
  "Federally Qualified Health Center",
  "Health Maintenance Organization",
  "Home Health Agency",
  "Hospice",
  "Hospital",
  "Independent",
  "Industrial",
  "Insurance",
  "Intermediate Care Facility / Individuals with Intellectual Disabilities",
  "Mobile Laboratory",
  "Other Practitioner",
  "Pharmacy",
  "Physician Office",
  "Prison",
  "Public Health Laboratory",
  "Rural Health Clinic",
  "School/Student Health Service",
  "Skilled Nursing/Nursing Facility",
  "Tissue Bank/Repositories",
  "Other",
];

function emptyDraft(): DraftPayload {
  return {
    sections: {
      i: { legal_name: "", dba: "", street: "", city: "", state: "", zip: "", county: "", telephone: "", fax: "", email: "", federal_tax_id: "" },
      ii: { certificate_type: "", accrediting_org: "" },
      iii: { lab_type: "", lab_type_other: "" },
      iv: { hours_per_week: "" },
      v: { multiple_sites: "", sites_text: "" },
      vi: { has_waived_testing: "", estimated_annual_volume: "" },
      vii: { has_ppm: "", estimated_annual_volume: "" },
      viii: {
        histocompatibility: false,
        micro_bacteriology: false, micro_mycobacteriology: false, micro_mycology: false,
        micro_parasitology: false, micro_virology: false,
        immuno_syphilis_serology: false, immuno_general: false,
        chem_routine: false, chem_urinalysis: false, chem_endocrinology: false, chem_toxicology: false,
        hematology: false,
        immunohem_abo_rh: false, immunohem_antibody_detection: false,
        immunohem_antibody_id: false, immunohem_compatibility: false,
        pathology_histopathology: false, pathology_oral: false, pathology_cytology: false,
        radiobioassay: false, clinical_cytogenetics: false,
      },
      ix: { total_annual_volume: "" },
      x: { control_type: "", control_other: "", director_name: "", director_credentials: "", director_npi: "", director_clia_director_number: "" },
    },
    director_signature_name: "",
    director_signature_date: "",
    status: "draft",
    notes: "",
  };
}

function parseDbDraft(row: any): DraftPayload {
  if (!row) return emptyDraft();
  const empty = emptyDraft();
  const parse = (s: any, fallback: any) => {
    if (!s) return fallback;
    try { return { ...fallback, ...(typeof s === "string" ? JSON.parse(s) : s) }; }
    catch { return fallback; }
  };
  return {
    sections: {
      i:    parse(row.section_i_json,    empty.sections.i),
      ii:   parse(row.section_ii_json,   empty.sections.ii),
      iii:  parse(row.section_iii_json,  empty.sections.iii),
      iv:   parse(row.section_iv_json,   empty.sections.iv),
      v:    parse(row.section_v_json,    empty.sections.v),
      vi:   parse(row.section_vi_json,   empty.sections.vi),
      vii:  parse(row.section_vii_json,  empty.sections.vii),
      viii: parse(row.section_viii_json, empty.sections.viii),
      ix:   parse(row.section_ix_json,   empty.sections.ix),
      x:    parse(row.section_x_json,    empty.sections.x),
    },
    director_signature_name: row.director_signature_name || "",
    director_signature_date: row.director_signature_date || "",
    status: (row.status === "submitted" || row.status === "issued") ? row.status : "draft",
    notes: row.notes || "",
  };
}

interface Props {
  labId: number | null;
  isReadOnly: boolean;
}

export function Cms116FormTab({ labId, isReadOnly }: Props) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<DraftPayload>(emptyDraft());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  useEffect(() => {
    if (!labId) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/labs/${labId}/veritalab/cms116-draft`, { headers: authHeaders() });
        if (!res.ok) throw new Error(`Failed to load draft: ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        setDraft(parseDbDraft(data.draft));
        if (data.draft?.updated_at) setLastSavedAt(data.draft.updated_at);
      } catch (e) {
        if (!cancelled) console.error("Failed to load CMS-116 draft:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [labId]);

  async function handleSave() {
    if (!labId) { toast({ title: "No active lab", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/labs/${labId}/veritalab/cms116-draft`, {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
      const data = await res.json();
      if (data.draft?.updated_at) setLastSavedAt(data.draft.updated_at);
      toast({ title: "Draft saved" });
    } catch (e: any) {
      toast({ title: "Save failed", description: e?.message || "Unknown error", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const [downloadingPdf, setDownloadingPdf] = useState(false);
  async function handleDownloadPdf() {
    if (!labId) { toast({ title: "No active lab", variant: "destructive" }); return; }
    setDownloadingPdf(true);
    try {
      // Persist any unsaved field edits first so the PDF reflects what the
      // user just typed, not whatever was last saved to the cms116_drafts row.
      await fetch(`${API_BASE}/api/labs/${labId}/veritalab/cms116-draft`, {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const res = await fetch(`${API_BASE}/api/labs/${labId}/veritalab/cms116-draft/pdf`, { headers: authHeaders() });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      const { token } = await res.json();
      if (!token) throw new Error("No token returned");
      window.open(`${API_BASE}/api/pdf/${token}`, "_blank");
      toast({ title: "CMS-116 PDF generated" });
    } catch (e: any) {
      toast({ title: "PDF generation failed", description: e?.message || "Unknown error", variant: "destructive" });
    } finally {
      setDownloadingPdf(false);
    }
  }

  function updateSection<K extends keyof DraftPayload["sections"]>(key: K, patch: Partial<DraftPayload["sections"][K]>) {
    setDraft((d) => ({ ...d, sections: { ...d.sections, [key]: { ...d.sections[key], ...patch } } }));
  }

  if (loading) {
    return <div className="text-center py-12 text-muted-foreground">Loading CMS-116 draft...</div>;
  }

  const s = draft.sections;

  return (
    <div className="space-y-4">
      {/* Header banner */}
      <Card>
        <CardContent className="p-4 flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <FileSignature size={20} className="text-primary mt-0.5 shrink-0" />
            <div className="min-w-0">
              <h3 className="font-semibold">CMS Form 116 - CLIA Application for Certification</h3>
              <p className="text-xs text-muted-foreground mt-1">
                OMB control 0938-0581. After completion, click Download PDF, wet-sign Section X
                on the printed form, and mail to your State Agency.
              </p>
              {lastSavedAt && (
                <p className="text-xs text-muted-foreground mt-1">
                  Last saved {new Date(lastSavedAt).toLocaleString()}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant="outline" className={
              draft.status === "issued" ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/20" :
              draft.status === "submitted" ? "bg-amber-500/10 text-amber-700 border-amber-500/20" :
              "bg-muted text-muted-foreground border-border"
            }>
              {draft.status === "issued" ? "Issued" : draft.status === "submitted" ? "Submitted" : "Draft"}
            </Badge>
            <Button size="sm" variant="outline" onClick={handleDownloadPdf} disabled={downloadingPdf || saving}>
              <FileSignature size={14} className="mr-1.5" />
              {downloadingPdf ? "Generating..." : "Download PDF"}
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving || isReadOnly} className="bg-primary hover:bg-primary/90">
              <Save size={14} className="mr-1.5" />
              {saving ? "Saving..." : "Save Draft"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Accordion type="multiple" defaultValue={["i"]} className="space-y-2">
        {/* SECTION I */}
        <AccordionItem value="i" className="border rounded-lg px-4">
          <AccordionTrigger className="text-left font-medium">
            I. General Information
          </AccordionTrigger>
          <AccordionContent className="pt-2">
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Legal name of laboratory" value={s.i.legal_name} onChange={(v) => updateSection("i", { legal_name: v })} />
              <Field label="Doing business as (DBA)" value={s.i.dba} onChange={(v) => updateSection("i", { dba: v })} />
              <Field label="Street address" value={s.i.street} onChange={(v) => updateSection("i", { street: v })} className="sm:col-span-2" />
              <Field label="City" value={s.i.city} onChange={(v) => updateSection("i", { city: v })} />
              <div className="grid grid-cols-2 gap-3">
                <Field label="State" value={s.i.state} onChange={(v) => updateSection("i", { state: v })} maxLength={2} />
                <Field label="ZIP" value={s.i.zip} onChange={(v) => updateSection("i", { zip: v })} />
              </div>
              <Field label="County" value={s.i.county} onChange={(v) => updateSection("i", { county: v })} />
              <Field label="Federal Tax ID" value={s.i.federal_tax_id} onChange={(v) => updateSection("i", { federal_tax_id: v })} />
              <Field label="Telephone" value={s.i.telephone} onChange={(v) => updateSection("i", { telephone: v })} />
              <Field label="Fax" value={s.i.fax} onChange={(v) => updateSection("i", { fax: v })} />
              <Field label="Email" type="email" value={s.i.email} onChange={(v) => updateSection("i", { email: v })} className="sm:col-span-2" />
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* SECTION II */}
        <AccordionItem value="ii" className="border rounded-lg px-4">
          <AccordionTrigger className="text-left font-medium">II. Type of Certificate Requested</AccordionTrigger>
          <AccordionContent className="pt-2 space-y-3">
            <Select value={s.ii.certificate_type || ""} onValueChange={(v) => updateSection("ii", { certificate_type: v as SectionII["certificate_type"] })}>
              <SelectTrigger><SelectValue placeholder="Select certificate type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="waiver">Certificate of Waiver</SelectItem>
                <SelectItem value="ppm">Certificate for Provider-Performed Microscopy (PPM)</SelectItem>
                <SelectItem value="compliance">Certificate of Compliance</SelectItem>
                <SelectItem value="accreditation">Certificate of Accreditation</SelectItem>
              </SelectContent>
            </Select>
            {s.ii.certificate_type === "accreditation" && (
              <Field label="Accrediting organization (TJC, CAP, COLA, AABB, etc.)" value={s.ii.accrediting_org} onChange={(v) => updateSection("ii", { accrediting_org: v })} />
            )}
          </AccordionContent>
        </AccordionItem>

        {/* SECTION III */}
        <AccordionItem value="iii" className="border rounded-lg px-4">
          <AccordionTrigger className="text-left font-medium">III. Type of Laboratory</AccordionTrigger>
          <AccordionContent className="pt-2 space-y-3">
            <Select value={s.iii.lab_type || ""} onValueChange={(v) => updateSection("iii", { lab_type: v })}>
              <SelectTrigger><SelectValue placeholder="Select laboratory type" /></SelectTrigger>
              <SelectContent className="max-h-72">
                {LAB_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            {s.iii.lab_type === "Other" && (
              <Field label="Specify other laboratory type" value={s.iii.lab_type_other} onChange={(v) => updateSection("iii", { lab_type_other: v })} />
            )}
          </AccordionContent>
        </AccordionItem>

        {/* SECTION IV */}
        <AccordionItem value="iv" className="border rounded-lg px-4">
          <AccordionTrigger className="text-left font-medium">IV. Hours of Laboratory Testing</AccordionTrigger>
          <AccordionContent className="pt-2">
            <Field label="Total hours per week of laboratory testing" value={s.iv.hours_per_week} onChange={(v) => updateSection("iv", { hours_per_week: v })} />
          </AccordionContent>
        </AccordionItem>

        {/* SECTION V */}
        <AccordionItem value="v" className="border rounded-lg px-4">
          <AccordionTrigger className="text-left font-medium">V. Multiple Sites</AccordionTrigger>
          <AccordionContent className="pt-2 space-y-3">
            <Select value={s.v.multiple_sites || ""} onValueChange={(v) => updateSection("v", { multiple_sites: v as SectionV["multiple_sites"] })}>
              <SelectTrigger><SelectValue placeholder="Does this lab operate at multiple sites?" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="no">No</SelectItem>
                <SelectItem value="yes">Yes</SelectItem>
              </SelectContent>
            </Select>
            {s.v.multiple_sites === "yes" && (
              <div>
                <label className="text-sm font-medium mb-1 block">Address of each site</label>
                <Textarea rows={4} value={s.v.sites_text} onChange={(e) => updateSection("v", { sites_text: e.target.value })} placeholder="Site 1: 123 Main St, ..." />
              </div>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* SECTION VI */}
        <AccordionItem value="vi" className="border rounded-lg px-4">
          <AccordionTrigger className="text-left font-medium">VI. Waived Testing</AccordionTrigger>
          <AccordionContent className="pt-2 space-y-3">
            <Select value={s.vi.has_waived_testing || ""} onValueChange={(v) => updateSection("vi", { has_waived_testing: v as SectionVI["has_waived_testing"] })}>
              <SelectTrigger><SelectValue placeholder="Does the lab perform waived testing?" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="no">No</SelectItem>
                <SelectItem value="yes">Yes</SelectItem>
              </SelectContent>
            </Select>
            {s.vi.has_waived_testing === "yes" && (
              <Field label="Estimated annual waived test volume" value={s.vi.estimated_annual_volume} onChange={(v) => updateSection("vi", { estimated_annual_volume: v })} />
            )}
          </AccordionContent>
        </AccordionItem>

        {/* SECTION VII */}
        <AccordionItem value="vii" className="border rounded-lg px-4">
          <AccordionTrigger className="text-left font-medium">VII. Provider-Performed Microscopy Procedures</AccordionTrigger>
          <AccordionContent className="pt-2 space-y-3">
            <Select value={s.vii.has_ppm || ""} onValueChange={(v) => updateSection("vii", { has_ppm: v as SectionVII["has_ppm"] })}>
              <SelectTrigger><SelectValue placeholder="Does the lab perform PPM procedures?" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="no">No</SelectItem>
                <SelectItem value="yes">Yes</SelectItem>
              </SelectContent>
            </Select>
            {s.vii.has_ppm === "yes" && (
              <Field label="Estimated annual PPM test volume" value={s.vii.estimated_annual_volume} onChange={(v) => updateSection("vii", { estimated_annual_volume: v })} />
            )}
          </AccordionContent>
        </AccordionItem>

        {/* SECTION VIII */}
        <AccordionItem value="viii" className="border rounded-lg px-4">
          <AccordionTrigger className="text-left font-medium">VIII. Non-Waived Testing (Specialty / Subspecialty)</AccordionTrigger>
          <AccordionContent className="pt-2">
            <p className="text-xs text-muted-foreground mb-3">
              Check every specialty and subspecialty the lab performs. Mirrors the categories in 42 CFR 493.5.
            </p>
            <div className="grid sm:grid-cols-2 gap-y-1 gap-x-6 text-sm">
              <CheckGroup label="Histocompatibility" items={[
                { key: "histocompatibility", label: "Histocompatibility" },
              ]} section={s.viii} onChange={(k, v) => updateSection("viii", { [k]: v } as any)} />
              <CheckGroup label="Microbiology" items={[
                { key: "micro_bacteriology", label: "Bacteriology" },
                { key: "micro_mycobacteriology", label: "Mycobacteriology" },
                { key: "micro_mycology", label: "Mycology" },
                { key: "micro_parasitology", label: "Parasitology" },
                { key: "micro_virology", label: "Virology" },
              ]} section={s.viii} onChange={(k, v) => updateSection("viii", { [k]: v } as any)} />
              <CheckGroup label="Diagnostic Immunology" items={[
                { key: "immuno_syphilis_serology", label: "Syphilis Serology" },
                { key: "immuno_general", label: "General Immunology" },
              ]} section={s.viii} onChange={(k, v) => updateSection("viii", { [k]: v } as any)} />
              <CheckGroup label="Chemistry" items={[
                { key: "chem_routine", label: "Routine Chemistry" },
                { key: "chem_urinalysis", label: "Urinalysis" },
                { key: "chem_endocrinology", label: "Endocrinology" },
                { key: "chem_toxicology", label: "Toxicology" },
              ]} section={s.viii} onChange={(k, v) => updateSection("viii", { [k]: v } as any)} />
              <CheckGroup label="Hematology" items={[
                { key: "hematology", label: "Hematology" },
              ]} section={s.viii} onChange={(k, v) => updateSection("viii", { [k]: v } as any)} />
              <CheckGroup label="Immunohematology" items={[
                { key: "immunohem_abo_rh", label: "ABO Group and Rh" },
                { key: "immunohem_antibody_detection", label: "Antibody Detection" },
                { key: "immunohem_antibody_id", label: "Antibody Identification" },
                { key: "immunohem_compatibility", label: "Compatibility Testing" },
              ]} section={s.viii} onChange={(k, v) => updateSection("viii", { [k]: v } as any)} />
              <CheckGroup label="Pathology" items={[
                { key: "pathology_histopathology", label: "Histopathology" },
                { key: "pathology_oral", label: "Oral Pathology" },
                { key: "pathology_cytology", label: "Cytology" },
              ]} section={s.viii} onChange={(k, v) => updateSection("viii", { [k]: v } as any)} />
              <CheckGroup label="Other" items={[
                { key: "radiobioassay", label: "Radiobioassay" },
                { key: "clinical_cytogenetics", label: "Clinical Cytogenetics" },
              ]} section={s.viii} onChange={(k, v) => updateSection("viii", { [k]: v } as any)} />
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* SECTION IX */}
        <AccordionItem value="ix" className="border rounded-lg px-4">
          <AccordionTrigger className="text-left font-medium">IX. Total Annual Test Volume</AccordionTrigger>
          <AccordionContent className="pt-2">
            <Field label="Total annual non-waived test volume (estimate)" value={s.ix.total_annual_volume} onChange={(v) => updateSection("ix", { total_annual_volume: v })} />
            <p className="text-xs text-muted-foreground mt-2">
              Used by CMS to calculate certificate fee per the published CLIA fee schedule.
            </p>
          </AccordionContent>
        </AccordionItem>

        {/* SECTION X */}
        <AccordionItem value="x" className="border rounded-lg px-4">
          <AccordionTrigger className="text-left font-medium">X. Type of Control + Laboratory Director</AccordionTrigger>
          <AccordionContent className="pt-2 space-y-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Type of Control</label>
              <Select value={s.x.control_type || ""} onValueChange={(v) => updateSection("x", { control_type: v as SectionX["control_type"] })}>
                <SelectTrigger><SelectValue placeholder="Select control type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sole_proprietorship">Sole Proprietorship</SelectItem>
                  <SelectItem value="partnership">Partnership</SelectItem>
                  <SelectItem value="corporation">Corporation</SelectItem>
                  <SelectItem value="government">Government</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
              {s.x.control_type === "other" && (
                <div className="mt-2">
                  <Field label="Specify other control type" value={s.x.control_other} onChange={(v) => updateSection("x", { control_other: v })} />
                </div>
              )}
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Director name" value={s.x.director_name} onChange={(v) => updateSection("x", { director_name: v })} />
              <Field label="Director credentials (MD, DO, PhD, etc.)" value={s.x.director_credentials} onChange={(v) => updateSection("x", { director_credentials: v })} />
              <Field label="Director NPI" value={s.x.director_npi} onChange={(v) => updateSection("x", { director_npi: v })} />
              <Field label="CLIA Director ID (if previously assigned)" value={s.x.director_clia_director_number} onChange={(v) => updateSection("x", { director_clia_director_number: v })} />
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Director affirmation + signature */}
        <AccordionItem value="signature" className="border rounded-lg px-4">
          <AccordionTrigger className="text-left font-medium">Director Affirmation and Signature</AccordionTrigger>
          <AccordionContent className="pt-2 space-y-3">
            <div className="bg-amber-50 border border-amber-300 text-amber-900 rounded px-3 py-2 text-sm flex items-start gap-2">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>
                CMS requires a wet ink signature on the printed CMS-116. This field captures the
                director's name and date for the draft only; the printed PDF carries
                the signature block the director signs by hand before mailing.
              </span>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Director name (typed)" value={draft.director_signature_name} onChange={(v) => setDraft((d) => ({ ...d, director_signature_name: v }))} />
              <Field label="Date" type="date" value={draft.director_signature_date} onChange={(v) => setDraft((d) => ({ ...d, director_signature_date: v }))} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Internal notes (not on the form)</label>
              <Textarea rows={3} value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} placeholder="Reviewer initials, internal routing notes, etc." />
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Footer save button + Phase-4 note */}
      <Card>
        <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 size={14} className="text-emerald-600" />
            Draft autosaves when you click Save. Use Download PDF to generate the CMS-116 for wet-ink signature.
          </div>
          <Button size="sm" onClick={handleSave} disabled={saving || isReadOnly} className="bg-primary hover:bg-primary/90">
            <Save size={14} className="mr-1.5" />
            {saving ? "Saving..." : "Save Draft"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Small helper components ──────────────────────────────────────────

function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  maxLength?: number;
  className?: string;
}) {
  return (
    <div className={props.className}>
      <label className="text-sm font-medium mb-1 block">{props.label}</label>
      <Input
        type={props.type || "text"}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        maxLength={props.maxLength}
      />
    </div>
  );
}

function CheckGroup<T extends Record<string, any>>(props: {
  label: string;
  items: Array<{ key: keyof T; label: string }>;
  section: T;
  onChange: (k: keyof T, v: boolean) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{props.label}</div>
      {props.items.map((it) => (
        <label key={String(it.key)} className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(props.section[it.key])}
            onChange={(e) => props.onChange(it.key, e.target.checked)}
            className="rounded border-input"
          />
          <span>{it.label}</span>
        </label>
      ))}
    </div>
  );
}
