// CMS-116 tab (VeritaLab): the lab's draft of Form CMS-116 (04/2026), the CLIA Application, OMB 0938-0581.
//
// Sections 1-10 and the signature lines follow the 04/2026 form (Michael 2026-11-15, Q339 = 1: CMS released it in
// November 2026; the tab had been laid out on its own reading of the 03/24 form). The fields, lists and the reading of
// a saved draft live in shared/cms116Form.ts, which the worksheet PDF (server/cms116Pdf.ts) reads too. A draft saved on
// the tab's earlier layout opens with what fits carried over and the rest listed above the form; Save Draft stores it
// on the 04/2026 layout.
//
// The PUT /api/labs/:labId/veritalab/cms116-draft endpoint upserts one row per lab, one JSON blob per section; section N
// of the form is the Nth column (1 -> i ... 10 -> x).

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
import { downloadPdfToken } from "@/lib/utils";
import { authHeaders } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { FileSignature, Save, CheckCircle2, AlertTriangle, Plus, Trash2, Info } from "lucide-react";
import {
  ACCREDITING_ORGS, CERTIFICATE_TYPES, CMS116_FORM_LABEL, CONTROL_TYPES, DAYS, LAB_TYPES, PPM_PROCEDURES,
  SECTION_TITLES, SITE_EXCEPTIONS, SPECIALTY_GROUPS, emptyCms116, emptyNonWaivedTest, emptyOtherLab, emptySite,
  emptyWaivedTest, normalizeCms116, type Cms116Sections, type CertificateType, type SiteException, type YesNo,
} from "@shared/cms116Form";

interface DraftPayload {
  sections: Cms116Sections;
  director_signature_name: string;
  director_signature_date: string;
  status: "draft" | "submitted" | "issued";
  notes: string;
}

function emptyDraft(): DraftPayload {
  return { sections: emptyCms116(), director_signature_name: "", director_signature_date: "", status: "draft", notes: "" };
}

function parseDbDraft(row: any): { draft: DraftPayload; carriedNotes: string[] } {
  if (!row) return { draft: emptyDraft(), carriedNotes: [] };
  const { sections, carriedNotes } = normalizeCms116({
    i: row.section_i_json, ii: row.section_ii_json, iii: row.section_iii_json, iv: row.section_iv_json,
    v: row.section_v_json, vi: row.section_vi_json, vii: row.section_vii_json, viii: row.section_viii_json,
    ix: row.section_ix_json, x: row.section_x_json,
  });
  return {
    draft: {
      sections,
      director_signature_name: row.director_signature_name || "",
      director_signature_date: row.director_signature_date || "",
      status: (row.status === "submitted" || row.status === "issued") ? row.status : "draft",
      notes: row.notes || "",
    },
    carriedNotes,
  };
}

interface Props {
  labId: number | null;
  isReadOnly: boolean;
}

const SECTION_KEYS = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"] as const;

export function Cms116FormTab({ labId, isReadOnly }: Props) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<DraftPayload>(emptyDraft());
  const [carriedNotes, setCarriedNotes] = useState<string[]>([]);
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
        const parsed = parseDbDraft(data.draft);
        setDraft(parsed.draft);
        setCarriedNotes(parsed.carriedNotes);
        if (data.draft?.updated_at) setLastSavedAt(data.draft.updated_at);
      } catch (e) {
        if (!cancelled) console.error("Failed to load CMS-116 draft:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [labId]);

  async function putDraft() {
    const res = await fetch(`${API_BASE}/api/labs/${labId}/veritalab/cms116-draft`, {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    if (!res.ok) throw new Error(`Save failed: ${res.status}`);
    return res.json();
  }

  async function handleSave() {
    if (!labId) { toast({ title: "No active lab", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const data = await putDraft();
      if (data.draft?.updated_at) setLastSavedAt(data.draft.updated_at);
      // Saved on the 04/2026 layout, so the carried-over list no longer applies.
      setCarriedNotes([]);
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
      // A view-only login has no edits to persist (and the PUT would 403).
      if (!isReadOnly) {
        const data = await putDraft();
        if (data.draft?.updated_at) setLastSavedAt(data.draft.updated_at);
        setCarriedNotes([]);
      }
      const res = await fetch(`${API_BASE}/api/labs/${labId}/veritalab/cms116-draft/pdf`, { headers: authHeaders() });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      const { token } = await res.json();
      if (!token) throw new Error("No token returned");
      // Anchor download via the token endpoint (no popup / about:blank tab; parking lot #63).
      downloadPdfToken(token, "CMS-116_Worksheet.pdf");
      toast({ title: "CMS-116 worksheet generated" });
    } catch (e: any) {
      toast({ title: "PDF generation failed", description: e?.message || "Unknown error", variant: "destructive" });
    } finally {
      setDownloadingPdf(false);
    }
  }

  function updateSection<K extends keyof Cms116Sections>(key: K, patch: Partial<Cms116Sections[K]>) {
    setDraft((d) => ({ ...d, sections: { ...d.sections, [key]: { ...d.sections[key], ...patch } } }));
  }

  if (loading) {
    return <div className="text-center py-12 text-muted-foreground">Loading CMS-116 draft...</div>;
  }

  const s = draft.sections;
  const labType = LAB_TYPES.find((t) => t.code === s.iii.lab_type);
  const control = CONTROL_TYPES.find((c) => c.code === s.ix.control_type);

  return (
    <div className="space-y-4">
      {/* Header banner */}
      <Card>
        <CardContent className="p-4 flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <FileSignature size={20} className="text-primary mt-0.5 shrink-0" />
            <div className="min-w-0">
              <h3 className="font-semibold">{CMS116_FORM_LABEL}, CLIA Application</h3>
              <p className="text-xs text-muted-foreground mt-1">
                OMB 0938-0581. Sections follow the 04/2026 form. Fill in what applies and click Save Draft.
                Download PDF gives a worksheet of these entries to copy onto CMS's current Form CMS-116, which
                the laboratory director or owner signs and sends to your state agency.
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

      {carriedNotes.length > 0 && (
        <div data-testid="cms116-carried-notes" className="rounded-lg border border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200 px-4 py-3 text-sm">
          <div className="flex items-start gap-2">
            <Info size={16} className="shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="font-medium">This draft was saved on the earlier CMS-116 layout.</p>
              <p className="mt-1">
                Entries that fit the 04/2026 form are carried over below. These have no matching field or need a
                choice; enter what applies, then click Save Draft to store the draft on the 04/2026 layout.
              </p>
              <ul className="list-disc pl-5 mt-2 space-y-0.5">
                {carriedNotes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* #84 Phase 3: the CMS-116 draft is VeritaLab setup (PUT is
          requireModuleEdit('veritalab')). A view-only login (e.g. a Staff
          login) reads every section open, with the fields disabled. */}
      <fieldset disabled={isReadOnly} className="contents">
      <Accordion type="multiple" defaultValue={isReadOnly ? [...SECTION_KEYS, "signature"] : ["i"]} className="space-y-2">
        {/* SECTION 1 */}
        <AccordionItem value="i" className="border rounded-lg px-4">
          <AccordionTrigger className="text-left font-medium">{SECTION_TITLES.i}</AccordionTrigger>
          <AccordionContent className="pt-2 space-y-4">
            <div className="grid sm:grid-cols-2 gap-2 text-sm">
              <Check label="Initial application" checked={s.i.app_initial} onChange={(v) => updateSection("i", { app_initial: v })} />
              <Check label="Survey" checked={s.i.app_survey} onChange={(v) => updateSection("i", { app_survey: v })} />
              <Check label="Change in certificate type" checked={s.i.app_change_cert_type} onChange={(v) => updateSection("i", { app_change_cert_type: v })} />
              <Check label="Change in laboratory director" checked={s.i.app_change_director} onChange={(v) => updateSection("i", { app_change_director: v })} />
              <Check label="Other changes" checked={s.i.app_other_changes} onChange={(v) => updateSection("i", { app_other_changes: v })} />
            </div>
            <div className="grid sm:grid-cols-3 gap-3">
              {s.i.app_initial && (
                <Field label="Anticipated start date" type="date" value={s.i.anticipated_start_date} onChange={(v) => updateSection("i", { anticipated_start_date: v })} />
              )}
              {s.i.app_other_changes && (
                <Field label="Other changes (specify)" value={s.i.other_changes_text} onChange={(v) => updateSection("i", { other_changes_text: v })} />
              )}
              <Field label="Effective date" type="date" value={s.i.effective_date} onChange={(v) => updateSection("i", { effective_date: v })} />
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="CLIA Identification Number (blank for an initial application)" value={s.i.clia_number} onChange={(v) => updateSection("i", { clia_number: v })} />
              <Field label="Federal Tax Identification Number (TIN)" value={s.i.federal_tax_id} onChange={(v) => updateSection("i", { federal_tax_id: v })} />
              <Field label="Facility name" value={s.i.facility_name} onChange={(v) => updateSection("i", { facility_name: v })} className="sm:col-span-2" />
              <Field label="Email address 1" type="email" value={s.i.email_1} onChange={(v) => updateSection("i", { email_1: v })} />
              <Field label="Email address 2 (optional)" type="email" value={s.i.email_2} onChange={(v) => updateSection("i", { email_2: v })} />
              <Field label="Email address 3 (optional)" type="email" value={s.i.email_3} onChange={(v) => updateSection("i", { email_3: v })} />
              <Field label="Email address for CLIA fee coupons (if applicable)" type="email" value={s.i.email_fee_coupons} onChange={(v) => updateSection("i", { email_fee_coupons: v })} />
              <Field label="Phone number" value={s.i.phone} onChange={(v) => updateSection("i", { phone: v })} />
              <Field label="Fax number" value={s.i.fax} onChange={(v) => updateSection("i", { fax: v })} />
              <Field label="Facility address (physical location, no P.O. boxes)" value={s.i.street} onChange={(v) => updateSection("i", { street: v })} className="sm:col-span-2" />
              <Field label="Facility address line 2 (building, floor, suite, if applicable)" value={s.i.street_2} onChange={(v) => updateSection("i", { street_2: v })} className="sm:col-span-2" />
              <Field label="City" value={s.i.city} onChange={(v) => updateSection("i", { city: v })} />
              <div className="grid grid-cols-2 gap-3">
                <Field label="State" value={s.i.state} onChange={(v) => updateSection("i", { state: v })} maxLength={2} />
                <Field label="ZIP code" value={s.i.zip} onChange={(v) => updateSection("i", { zip: v })} />
              </div>
              <Field label="Name of Laboratory Director (Last, First, Middle initial)" value={s.i.director_name} onChange={(v) => updateSection("i", { director_name: v })} />
              <Field label="Laboratory Director phone number" value={s.i.director_phone} onChange={(v) => updateSection("i", { director_phone: v })} />
              <Field label="Name of Owner" value={s.i.owner_name} onChange={(v) => updateSection("i", { owner_name: v })} />
              <Field label="Owner phone number" value={s.i.owner_phone} onChange={(v) => updateSection("i", { owner_phone: v })} />
            </div>
            <p className="text-xs text-muted-foreground">
              For a PPM, compliance or accreditation certificate, proof of the laboratory director's qualifications
              (state licensure where it applies, education, credentials and laboratory experience) goes with the form.
            </p>
          </AccordionContent>
        </AccordionItem>

        {/* SECTION 2 */}
        <AccordionItem value="ii" className="border rounded-lg px-4">
          <AccordionTrigger className="text-left font-medium">{SECTION_TITLES.ii}</AccordionTrigger>
          <AccordionContent className="pt-2 space-y-3">
            <Select value={s.ii.certificate_type || ""} onValueChange={(v) => updateSection("ii", { certificate_type: v as CertificateType })}>
              <SelectTrigger aria-label="Type of certificate"><SelectValue placeholder="Select certificate type" /></SelectTrigger>
              <SelectContent>
                {CERTIFICATE_TYPES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {s.ii.certificate_type && (
              <p className="text-xs text-muted-foreground">
                Complete {CERTIFICATE_TYPES.find((c) => c.value === s.ii.certificate_type)?.sections}.
              </p>
            )}
            {s.ii.certificate_type === "accreditation" && (
              <div>
                <label className="text-sm font-medium mb-1 block">Accreditation organization(s) for CLIA purposes (accredited by, or applied to)</label>
                <div className="grid sm:grid-cols-3 gap-1 text-sm">
                  {ACCREDITING_ORGS.map((o) => (
                    <Check key={o} label={o} checked={s.ii.accrediting_orgs.includes(o)}
                      onChange={(v) => updateSection("ii", { accrediting_orgs: v ? [...s.ii.accrediting_orgs, o] : s.ii.accrediting_orgs.filter((x) => x !== o) })} />
                  ))}
                </div>
              </div>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* SECTION 3 */}
        <AccordionItem value="iii" className="border rounded-lg px-4">
          <AccordionTrigger className="text-left font-medium">{SECTION_TITLES.iii}</AccordionTrigger>
          <AccordionContent className="pt-2 space-y-3">
            <Select value={s.iii.lab_type || ""} onValueChange={(v) => updateSection("iii", { lab_type: v })}>
              <SelectTrigger aria-label="Type of laboratory"><SelectValue placeholder="Select laboratory type" /></SelectTrigger>
              <SelectContent className="max-h-72">
                {LAB_TYPES.map((t) => <SelectItem key={t.code} value={t.code}>{t.code} {t.label}{t.cms ? "*" : ""}</SelectItem>)}
              </SelectContent>
            </Select>
            {labType?.specify && (
              <Field label="Specify" value={s.iii.lab_type_other} onChange={(v) => updateSection("iii", { lab_type_other: v })} />
            )}
            <p className="text-xs text-muted-foreground">* A facility type CMS certifies.</p>
            <YesNoSelect label="Is the laboratory located within a CMS-certified health care facility (types marked *)?"
              value={s.iii.in_cms_certified_facility} onChange={(v) => updateSection("iii", { in_cms_certified_facility: v })} />
            {s.iii.in_cms_certified_facility === "yes" && (
              <Field label="CMS Certification Numbers (CCNs)" value={s.iii.ccns} onChange={(v) => updateSection("iii", { ccns: v })} />
            )}
          </AccordionContent>
        </AccordionItem>

        {/* SECTION 4 */}
        <AccordionItem value="iv" className="border rounded-lg px-4">
          <AccordionTrigger className="text-left font-medium">{SECTION_TITLES.iv}</AccordionTrigger>
          <AccordionContent className="pt-2 space-y-3">
            <Check label="Testing 24/7" checked={s.iv.testing_24_7} onChange={(v) => updateSection("iv", { testing_24_7: v })} />
            {!s.iv.testing_24_7 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">The times laboratory testing is performed each day (HH:MM). Leave a day blank if there is no testing.</p>
                {DAYS.map((d) => (
                  <div key={d.key} className="grid grid-cols-[6rem_1fr_1fr] gap-2 items-end">
                    <span className="text-sm pb-2">{d.label}</span>
                    <Field label="From" type="time" value={s.iv.hours[d.key].from}
                      onChange={(v) => updateSection("iv", { hours: { ...s.iv.hours, [d.key]: { ...s.iv.hours[d.key], from: v } } })} />
                    <Field label="To" type="time" value={s.iv.hours[d.key].to}
                      onChange={(v) => updateSection("iv", { hours: { ...s.iv.hours, [d.key]: { ...s.iv.hours[d.key], to: v } } })} />
                  </div>
                ))}
              </div>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* SECTION 5 */}
        <AccordionItem value="v" className="border rounded-lg px-4">
          <AccordionTrigger className="text-left font-medium">{SECTION_TITLES.v}</AccordionTrigger>
          <AccordionContent className="pt-2 space-y-3">
            <YesNoSelect label="Applying for a single site CLIA certificate to cover multiple testing locations?"
              value={s.v.multiple_sites} onChange={(v) => updateSection("v", { multiple_sites: v })} />
            {s.v.multiple_sites === "yes" && (
              <>
                <div className="space-y-1 text-sm">
                  <label className="text-sm font-medium block">Regulatory exception that applies</label>
                  {SITE_EXCEPTIONS.map((e) => (
                    <Check key={e.value} label={e.label} checked={s.v.exception === e.value}
                      onChange={(v) => updateSection("v", { exception: (v ? e.value : "") as SiteException })} />
                  ))}
                </div>
                <Field label="Number of sites under this certificate" value={s.v.site_count} onChange={(v) => updateSection("v", { site_count: v })} />
                <Rows
                  label="Sites"
                  rows={s.v.sites}
                  columns={[
                    { key: "name", label: "Laboratory or hospital department" },
                    { key: "address", label: "Address or location" },
                    { key: "city", label: "City" },
                    { key: "state", label: "State" },
                    { key: "zip", label: "ZIP code" },
                    { key: "phone", label: "Phone number" },
                    { key: "tests", label: "Tests performed / specialty / subspecialty" },
                  ]}
                  newRow={emptySite}
                  onChange={(rows) => updateSection("v", { sites: rows })}
                  addLabel="Add site"
                />
              </>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* SECTION 6 */}
        <AccordionItem value="vi" className="border rounded-lg px-4">
          <AccordionTrigger className="text-left font-medium">{SECTION_TITLES.vi}</AccordionTrigger>
          <AccordionContent className="pt-2 space-y-3">
            <Check label="No waived tests are performed" checked={s.vi.none_performed} onChange={(v) => updateSection("vi", { none_performed: v })} />
            {!s.vi.none_performed && (
              <>
                <Rows
                  label="Each analyte, test system or device"
                  rows={s.vi.tests}
                  columns={[
                    { key: "analyte", label: "Analyte/Test" },
                    { key: "test_name", label: "Test Name" },
                    { key: "manufacturer", label: "Manufacturer" },
                  ]}
                  newRow={emptyWaivedTest}
                  onChange={(rows) => updateSection("vi", { tests: rows })}
                  addLabel="Add waived test"
                />
                <Field label="Estimated total annual test volume for all waived tests" value={s.vi.total_volume} onChange={(v) => updateSection("vi", { total_volume: v })} />
              </>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* SECTION 7 */}
        <AccordionItem value="vii" className="border rounded-lg px-4">
          <AccordionTrigger className="text-left font-medium">{SECTION_TITLES.vii}</AccordionTrigger>
          <AccordionContent className="pt-2 space-y-3">
            <Check label="No PPM tests are performed" checked={s.vii.none_performed} onChange={(v) => updateSection("vii", { none_performed: v })} />
            {!s.vii.none_performed && (
              <>
                <div className="space-y-1 text-sm">
                  <label className="text-sm font-medium block">PPM procedures that will be performed</label>
                  {PPM_PROCEDURES.map((p) => (
                    <Check key={p.key} label={p.label} checked={Boolean(s.vii.procedures[p.key])}
                      onChange={(v) => updateSection("vii", { procedures: { ...s.vii.procedures, [p.key]: v } })} />
                  ))}
                </div>
                <Field label="Estimated total annual test volume for all PPM tests" value={s.vii.total_volume} onChange={(v) => updateSection("vii", { total_volume: v })} />
              </>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* SECTION 8 */}
        <AccordionItem value="viii" className="border rounded-lg px-4">
          <AccordionTrigger className="text-left font-medium">{SECTION_TITLES.viii}</AccordionTrigger>
          <AccordionContent className="pt-2 space-y-4">
            <p className="text-xs text-muted-foreground">
              Only for a Certificate of Compliance or a Certificate of Accreditation. M = moderate complexity, H = high complexity.
            </p>
            <Rows
              label="Each analyte, test system or device"
              rows={s.viii.tests}
              columns={[
                { key: "analyte", label: "Analyte/Test" },
                { key: "test_name", label: "Test Name" },
                { key: "manufacturer", label: "Manufacturer" },
                { key: "complexity", label: "M or H", options: ["M", "H"] },
              ]}
              newRow={emptyNonWaivedTest}
              onChange={(rows) => updateSection("viii", { tests: rows })}
              addLabel="Add non-waived test"
            />
            <div>
              <label className="text-sm font-medium mb-1 block">Specialties and subspecialties performed</label>
              <p className="text-xs text-muted-foreground mb-2">
                Check each one the laboratory performs and enter its estimated annual test volume. For a Certificate of
                Accreditation, name the accreditation organization for CLIA purposes beside each.{" "}
                Mirrors the categories in 42 CFR 493.2 and Subpart I.
              </p>
              <div className="space-y-3">
                {SPECIALTY_GROUPS.map((g) => (
                  <div key={g.label}>
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">{g.label}</div>
                    <div className="space-y-1">
                      {g.items.map((it) => {
                        const sp = s.viii.specialties[it.key];
                        const set = (patch: Partial<typeof sp>) => updateSection("viii", { specialties: { ...s.viii.specialties, [it.key]: { ...sp, ...patch } } });
                        return (
                          <div key={it.key} className="grid sm:grid-cols-[1fr_12rem_9rem] gap-2 items-center">
                            <Check label={`${it.label} (${it.code})`} checked={sp.checked} onChange={(v) => set({ checked: v })} />
                            <Input aria-label={`${it.label} accrediting organization`} placeholder="Accrediting organization" value={sp.accrediting_org} onChange={(e) => set({ accrediting_org: e.target.value })} disabled={!sp.checked} />
                            <Input aria-label={`${it.label} annual test volume`} placeholder="Annual volume" value={sp.volume} onChange={(e) => set({ volume: e.target.value })} disabled={!sp.checked} />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <Field label="Total estimated annual test volume (all non-waived testing, PPM included)" value={s.viii.total_volume} onChange={(v) => updateSection("viii", { total_volume: v })} />
            <p className="text-xs text-muted-foreground">
              Don't count waived tests, testing not subject to CLIA, calculations, quality control, quality assurance or
              proficiency testing. The form's Guidelines for Counting Tests give the rule for each specialty.
            </p>
          </AccordionContent>
        </AccordionItem>

        {/* SECTION 9 */}
        <AccordionItem value="ix" className="border rounded-lg px-4">
          <AccordionTrigger className="text-left font-medium">{SECTION_TITLES.ix}</AccordionTrigger>
          <AccordionContent className="pt-2 space-y-3">
            <Select value={s.ix.control_type || ""} onValueChange={(v) => updateSection("ix", { control_type: v })}>
              <SelectTrigger aria-label="Type of control"><SelectValue placeholder="Select the one most descriptive of ownership type" /></SelectTrigger>
              <SelectContent>
                {CONTROL_TYPES.map((c) => <SelectItem key={c.code} value={c.code}>{c.group}: {c.code} {c.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {control?.specify && (
              <Field label={control.code === "09" ? "Specify (country or province)" : "Specify"} value={s.ix.control_other} onChange={(v) => updateSection("ix", { control_other: v })} />
            )}
            <YesNoSelect label="Does this facility have partial or full ownership or control by a non-United States-based government or entity?"
              value={s.ix.foreign_ownership} onChange={(v) => updateSection("ix", { foreign_ownership: v })} />
            {s.ix.foreign_ownership === "yes" && (
              <Field label="Country of origin of the foreign entity" value={s.ix.foreign_country} onChange={(v) => updateSection("ix", { foreign_country: v })} />
            )}
          </AccordionContent>
        </AccordionItem>

        {/* SECTION 10 */}
        <AccordionItem value="x" className="border rounded-lg px-4">
          <AccordionTrigger className="text-left font-medium">{SECTION_TITLES.x}</AccordionTrigger>
          <AccordionContent className="pt-2 space-y-3">
            <p className="text-xs text-muted-foreground">
              Only if this laboratory's director also directs other, separately certified laboratories. For a PPM,
              compliance or accreditation certificate, one person can direct no more than five certificates.
            </p>
            <Rows
              label="Other laboratories"
              rows={s.x.other_labs}
              columns={[
                { key: "clia_number", label: "CLIA Number" },
                { key: "lab_name", label: "Name of Laboratory" },
              ]}
              newRow={emptyOtherLab}
              onChange={(rows) => updateSection("x", { other_labs: rows })}
              addLabel="Add laboratory"
            />
          </AccordionContent>
        </AccordionItem>

        {/* Signature */}
        <AccordionItem value="signature" className="border rounded-lg px-4">
          <AccordionTrigger className="text-left font-medium">Signature of Laboratory Director or Owner</AccordionTrigger>
          <AccordionContent className="pt-2 space-y-3">
            <div className="bg-amber-50 border border-amber-300 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200 rounded px-3 py-2 text-sm flex items-start gap-2">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>
                The laboratory director or owner signs CMS's Form CMS-116, in ink or with a secure electronic signature.
                These fields only record the printed name and date for the worksheet.
              </span>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Print name of Laboratory Director/Owner" value={draft.director_signature_name} onChange={(v) => setDraft((d) => ({ ...d, director_signature_name: v }))} />
              <Field label="Date signed" type="date" value={draft.director_signature_date} onChange={(v) => setDraft((d) => ({ ...d, director_signature_date: v }))} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Internal notes (not on the form)</label>
              <Textarea rows={3} value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} placeholder="Reviewer initials, internal routing notes, etc." />
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
      </fieldset>

      {/* Footer save button */}
      <Card>
        <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
            Saved when you click Save Draft. Download PDF gives a worksheet to copy onto CMS's current Form CMS-116.
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
        aria-label={props.label}
        type={props.type || "text"}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        maxLength={props.maxLength}
      />
    </div>
  );
}

function Check(props: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-2 cursor-pointer text-sm">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
        className="rounded border-input mt-0.5"
      />
      <span>{props.label}</span>
    </label>
  );
}

function YesNoSelect(props: { label: string; value: YesNo; onChange: (v: YesNo) => void }) {
  return (
    <div>
      <label className="text-sm font-medium mb-1 block">{props.label}</label>
      <Select value={props.value || ""} onValueChange={(v) => props.onChange(v as YesNo)}>
        <SelectTrigger aria-label={props.label} className="max-w-[12rem]"><SelectValue placeholder="Select" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="yes">Yes</SelectItem>
          <SelectItem value="no">No</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

// A list the lab adds rows to; each row is a set of short text fields (or a pick from `options`).
function Rows<T extends Record<string, any>>(props: {
  label: string;
  rows: T[];
  columns: Array<{ key: keyof T & string; label: string; options?: string[] }>;
  newRow: () => T;
  onChange: (rows: T[]) => void;
  addLabel: string;
}) {
  const set = (i: number, key: keyof T, value: string) =>
    props.onChange(props.rows.map((r, n) => (n === i ? { ...r, [key]: value } : r)));
  return (
    <div>
      <label className="text-sm font-medium mb-1 block">{props.label}</label>
      {props.rows.length === 0 && <p className="text-xs text-muted-foreground mb-2">None entered.</p>}
      <div className="space-y-2">
        {props.rows.map((row, i) => (
          <div key={i} className="rounded-md border p-2 flex items-start gap-2">
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 flex-1 min-w-0">
              {props.columns.map((c) => c.options ? (
                <Select key={c.key} value={String(row[c.key] || "")} onValueChange={(v) => set(i, c.key, v)}>
                  <SelectTrigger aria-label={`${c.label}, row ${i + 1}`}><SelectValue placeholder={c.label} /></SelectTrigger>
                  <SelectContent>
                    {c.options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <Input key={c.key} aria-label={`${c.label}, row ${i + 1}`} placeholder={c.label} value={String(row[c.key] || "")} onChange={(e) => set(i, c.key, e.target.value)} />
              ))}
            </div>
            <Button type="button" size="icon" variant="ghost" aria-label={`Remove row ${i + 1}`} onClick={() => props.onChange(props.rows.filter((_, n) => n !== i))}>
              <Trash2 size={14} />
            </Button>
          </div>
        ))}
      </div>
      <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => props.onChange([...props.rows, props.newRow()])}>
        <Plus size={14} className="mr-1.5" /> {props.addLabel}
      </Button>
    </div>
  );
}
