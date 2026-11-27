// SystemDocumentPanel.tsx
//
// A document this laboratory received from its system (B1; server/policySharedDocuments.ts): the chip in the document list, what it
// says on the document itself with what the laboratory may do about it, the notice above the list, and everything received.
// Nothing here approves or submits anything: that stays on the document, by the laboratory's own route.

import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Building2, Eye, FileUp, Loader2, Paperclip, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { API_BASE, apiErrorMessage, apiRequest, getQueryFn, queryClient, responseErrorText } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { DECLINE_REASON_MAX, systemDocumentLabel, systemDocumentNote, type SystemCopyState } from "@shared/systemDocuments";
import { AddendaView } from "@/components/AddendaView";

/** On a row of the document list. */
export interface SystemDocumentMark { copy_id: number; state: SystemCopyState; organization_name: string | null; version_label: string | null; waiting_label: string | null; addenda: number }

export interface ReceivedDocument {
  copy_id: number; document_id: number | null; state: SystemCopyState; organization_name: string | null;
  master_title: string | null; master_doc_number: string | null; sent_at: string; sent_by: string | null;
  title: string | null; doc_number: string | null; status: string | null; archived: boolean; owner_user_id: number | null; owner_name: string | null;
  version_label: string | null; received_at: string | null; open: boolean;
  in_force_label: string | null; in_force_own: boolean; in_force_own_label: string | null;
  waiting_label: string | null; waiting_since: string | null;
  declined_label: string | null; declined_reason: string | null; declined_at: string | null; addenda: number;
}
export interface DetailAddendum { addendum_id: number; document_id: number; title: string; doc_number: string | null; status: string; version_label: string | null; in_force: boolean }
/** What GET .../documents/:id adds for a document that came from the system, or an addendum. */
export interface SharedDetail { system_document?: ReceivedDocument; addenda?: DetailAddendum[]; addendum_to?: { document_id: number; title: string } }

const box = "rounded-md border border-sky-300 bg-sky-50 text-sky-950 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-100";
const warn = "rounded border border-amber-300 bg-amber-50 text-amber-900 p-2 text-xs dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200";
const selectCls = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground";

const inUse = (d: ReceivedDocument): string =>
  d.in_force_label ? `system version ${d.in_force_label}` : d.in_force_own ? `your own version ${d.in_force_own_label ?? ""}`.trim() : "nothing yet";

/** Under a document's title in the list. */
export function SystemDocumentChip({ mark }: { mark: SystemDocumentMark }) {
  const following = mark.state === "following" || mark.state === "retired";
  return (
    <div className="mt-0.5 flex flex-wrap gap-1" data-testid="system-document-chip">
      <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] ${box}`} title={systemDocumentNote(mark)}>
        <Building2 size={11} className="shrink-0" /> {systemDocumentLabel(mark.version_label)}{following ? "" : mark.state === "own_copy" ? ", our own copy" : mark.state === "left" ? ", now our own" : ", declined"}
      </span>
      {mark.state === "retired" && <span className={`${warn} !p-0 px-1.5 py-0.5 text-[11px]`}><span className="px-1.5">Retired by the system</span></span>}
      {mark.waiting_label && <span className={`${warn} !p-0 text-[11px]`}><span className="px-1.5">Version {mark.waiting_label} is waiting</span></span>}
    </div>
  );
}

const documentUrl = (labId: number, id: number) => `/api/labs/${labId}/veritapolicy/documents/${id}`;

function refresh(labId: number) {
  queryClient.invalidateQueries({ queryKey: [`/api/labs/${labId}/veritapolicy/documents`] });
  queryClient.invalidateQueries({ queryKey: [`/api/labs/${labId}/veritapolicy/shared/received`] });
  queryClient.invalidateQueries({ queryKey: [`/api/labs/${labId}/veritapolicy/archived-documents`] });
}

/** On the document itself: where it came from, and what the laboratory may do about it. */
export function SystemDocumentPanel({ labId, documentId, detail: data, canEdit, ownDocuments, fmtDate, onGone, onChanged }: {
  labId: number;
  documentId: number;
  detail: SharedDetail;
  canEdit: boolean;
  // The laboratory's own approved documents, for "we already have our own".
  ownDocuments: Array<{ id: number; title: string; doc_number?: string | null }>;
  fmtDate: (s: string | null) => string;
  onGone: () => void; // the document on screen left the list
  onChanged: () => void; // the version on screen may have changed
}) {
  const { toast } = useToast();
  const [asking, setAsking] = useState<null | "decline" | "existing" | "own" | "take" | "owner" | "addendum">(null);
  const [reason, setReason] = useState("");
  const [existing, setExisting] = useState("");
  const [owner, setOwner] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [printing, setPrinting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const d = data.system_document;
  const addenda = data.addenda ?? [];
  const owners = useQuery<{ people: Array<{ user_id: number; name: string }> }>({
    queryKey: [`/api/labs/${labId}/veritapolicy/shared/received/${d?.copy_id}/owners`],
    queryFn: getQueryFn({ on401: "throw" }), enabled: asking === "owner" && !!d, retry: false,
  });
  const close = () => { setAsking(null); setReason(""); setExisting(""); setOwner(""); setTitle(""); setText(""); setFile(null); };
  const act = useMutation({
    mutationFn: async ({ verb, body }: { verb: string; body?: unknown }) =>
      (await apiRequest(verb === "owner" ? "PUT" : "POST", `/api/labs/${labId}/veritapolicy/shared/received/${d!.copy_id}/${verb}`, body ?? {})).json(),
    onSuccess: (res: { copy: ReceivedDocument }, { verb }) => {
      const said: Record<string, string> = {
        decline: res.copy.state === "declined" ? "Declined. The document is archived with your reason." : "That version was declined. Your approved version stands.",
        "own-copy": "This is your own copy now. New system versions won't arrive.",
        resume: "Your laboratory follows it again.",
        "use-existing": "Your own document has the received version as a draft revision. Your approved version stays in use until you approve it.",
        take: "The newer version is the draft now.",
        owner: "Saved.",
      };
      toast({ title: said[verb] ?? "Saved" });
      close();
      refresh(labId);
      if (res.copy.document_id !== documentId || res.copy.archived) onGone(); else onChanged();
    },
    onError: (e) => toast({ title: "Not done", description: apiErrorMessage(e, "Try again."), variant: "destructive" }),
  });
  const addAddendum = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      if (file) fd.append("file", file); else fd.append("text", text);
      if (title.trim()) fd.append("title", title.trim());
      const res = await fetch(`${API_BASE}${documentUrl(labId, documentId)}/addenda`, { method: "POST", headers: authHeaders(), body: fd });
      if (!res.ok) throw new Error(await responseErrorText(res, "The addendum couldn't be saved."));
      return res.json();
    },
    onSuccess: (res: { phiWarning: string | null }) => {
      toast({ title: "Addendum added as a draft", description: "Submit it on its own row. Staff read it once your laboratory approves it." });
      if (res.phiWarning) toast({ title: "Possible patient information in this file", description: res.phiWarning, variant: "destructive", duration: 20000 });
      close();
      refresh(labId);
      onChanged();
    },
    onError: (e: any) => toast({ title: "Not added", description: e?.message || "Try again.", variant: "destructive" }),
  });
  const takeOff = useMutation({
    mutationFn: async (id: number) => (await apiRequest("DELETE", `${documentUrl(labId, documentId)}/addenda/${id}`)).json(),
    onSuccess: () => { toast({ title: "Taken off. It stays in your documents." }); refresh(labId); onChanged(); },
    onError: (e) => toast({ title: "Not done", description: apiErrorMessage(e, "Try again."), variant: "destructive" }),
  });
  const print = async () => {
    setPrinting(true);
    const tab = window.open("", "_blank");
    try {
      const res = await fetch(`${API_BASE}${documentUrl(labId, documentId)}/print.pdf`, { headers: authHeaders() });
      if (!res.ok) throw new Error(await responseErrorText(res, "The print copy couldn't be made."));
      const url = URL.createObjectURL(await res.blob());
      if (tab) tab.location.href = url; else window.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e: any) {
      tab?.close();
      toast({ title: "No print copy", description: e?.message, variant: "destructive" });
    } finally {
      setPrinting(false);
    }
  };
  if (!d && !data.addendum_to && addenda.length === 0) return null;
  const draftHere = !!d && d.open && d.status === "draft";
  const neverApproved = !!d && d.in_force_label == null && !d.in_force_own;
  const busy = act.isPending || addAddendum.isPending;
  const mayAct = canEdit && d?.copy_id != null; // a reader held to approved procedures is sent the label only
  return (
    <div className="space-y-2 min-w-0" data-testid="system-document-panel">
      {data.addendum_to && <div className={`${box} px-3 py-2 text-sm`} data-testid="addendum-of"><Paperclip size={13} className="inline mr-1.5" />Site addendum to {data.addendum_to.title}. It is read and printed after that document.</div>}
      {d && (
        <div className={`${box} p-3 text-sm space-y-2`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1 basis-64">
              <div className="font-semibold flex items-center gap-1.5"><Building2 size={14} className="shrink-0" /> <span data-testid="system-document-label">{systemDocumentLabel(d.version_label)}</span></div>
              <p className="text-xs">{systemDocumentNote(d)}</p>
              {d.sent_at && (
                <p className="text-xs opacity-80 mt-1">
                  {[d.master_doc_number, d.master_title].filter(Boolean).join(" ")}. Sent {fmtDate(d.sent_at)}{d.sent_by ? ` by ${d.sent_by}` : ""}. In use here: {inUse(d)}.
                  {d.owner_name ? ` Owner here: ${d.owner_name}.` : ""}
                </p>
              )}
            </div>
            {(addenda.length > 0 || d.sent_at) && (
              <Button size="sm" variant="outline" onClick={print} disabled={printing} data-testid="system-document-print" title="One PDF of this document and its addenda, in order">
                {printing ? <Loader2 size={13} className="animate-spin mr-1" /> : <Printer size={13} className="mr-1" />} Print in order
              </Button>
            )}
          </div>
          {draftHere && <div className={warn} data-testid="system-document-open">Version {d.version_label} is a draft here since {fmtDate(d.received_at)}. {neverApproved ? "Nothing is in use until your laboratory submits and approves it." : "Staff keep reading your approved version until your laboratory approves this one."}</div>}
          {d.waiting_label && <div className={warn} data-testid="system-document-waiting">Version {d.waiting_label} has been waiting since {fmtDate(d.waiting_since)}. {d.archived ? "" : draftHere || d.status === "in_review" ? "A version is already open here, so it comes in when that one is approved." : d.status === "draft" ? "Your own draft is open, so it comes in when that one is approved." : "Take it when you're ready."}</div>}
          {d.declined_reason && d.state === "following" && <div className={warn}>Version {d.declined_label} was declined {fmtDate(d.declined_at)}: {d.declined_reason}</div>}
          {mayAct && asking === null && (
            <div className="flex flex-wrap gap-1.5">
              {d.waiting_label && (draftHere || d.status === "approved" || d.status === "expired") && <Button size="sm" variant="outline" onClick={() => setAsking("take")} data-testid="system-take">Take version {d.waiting_label} now</Button>}
              {draftHere && d.state === "following" && <Button size="sm" variant="outline" onClick={() => setAsking("decline")} data-testid="system-decline">{neverApproved ? "Decline" : "Decline this version"}</Button>}
              {draftHere && neverApproved && d.state === "following" && <Button size="sm" variant="outline" onClick={() => setAsking("existing")} data-testid="system-use-existing">We have our own document</Button>}
              {(d.state === "following" || d.state === "retired") && <Button size="sm" variant="outline" onClick={() => setAsking("own")} data-testid="system-own">Make it our own copy</Button>}
              {(d.state === "own_copy" || d.state === "declined") && <Button size="sm" variant="outline" onClick={() => act.mutate({ verb: "resume" })} disabled={busy} data-testid="system-resume">Follow the system again</Button>}
              <Button size="sm" variant="outline" onClick={() => setAsking("addendum")} data-testid="system-add-addendum"><FileUp size={13} className="mr-1" /> Add site addendum</Button>
              <Button size="sm" variant="ghost" onClick={() => setAsking("owner")} data-testid="system-owner">Change owner here</Button>
            </div>
          )}
          {asking === "decline" && (
            <div className="space-y-2 rounded-md border bg-background text-foreground p-2">
              <p className="text-xs">{neverApproved ? "The draft is archived with your reason, and new versions stop coming until you take it up again." : "The draft is withdrawn and your approved version stands. Later versions still arrive."} The system reads the reason, so leave names and patient information out.</p>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={DECLINE_REASON_MAX} rows={2} placeholder="Why your laboratory won't use it" aria-label="Reason" data-testid="system-decline-reason" />
              <div className="flex gap-1.5"><Button size="sm" disabled={busy || reason.trim().length < 3} onClick={() => act.mutate({ verb: "decline", body: { reason } })} data-testid="system-decline-yes">Decline it</Button><Button size="sm" variant="ghost" onClick={close}>Cancel</Button></div>
            </div>
          )}
          {asking === "existing" && (
            <div className="space-y-2 rounded-md border bg-background text-foreground p-2">
              <p className="text-xs">The received version becomes a draft revision of the document you pick. Its approved version stays in use until your laboratory approves the revision, and this draft is archived.</p>
              <select className={selectCls} value={existing} onChange={(e) => setExisting(e.target.value)} aria-label="Your own document" data-testid="system-existing-pick">
                <option value="">Pick your own document</option>
                {ownDocuments.map((o) => <option key={o.id} value={o.id}>{o.doc_number ? `${o.doc_number} ` : ""}{o.title}</option>)}
              </select>
              <div className="flex gap-1.5"><Button size="sm" disabled={busy || !existing} onClick={() => act.mutate({ verb: "use-existing", body: { documentId: Number(existing) } })} data-testid="system-existing-yes">Use it</Button><Button size="sm" variant="ghost" onClick={close}>Cancel</Button></div>
            </div>
          )}
          {asking === "own" && (
            <div className="space-y-2 rounded-md border bg-background text-foreground p-2">
              <p className="text-xs">Your laboratory keeps this document, its versions and signatures, and may change its file. New system versions won't arrive, and the system sees that you keep your own copy.</p>
              <div className="flex gap-1.5"><Button size="sm" disabled={busy} onClick={() => act.mutate({ verb: "own-copy" })} data-testid="system-own-yes">Make it our own</Button><Button size="sm" variant="ghost" onClick={close}>Cancel</Button></div>
            </div>
          )}
          {asking === "take" && (
            <div className="space-y-2 rounded-md border bg-background text-foreground p-2">
              <p className="text-xs">{draftHere ? `Version ${d.waiting_label} becomes the draft in place of version ${d.version_label}, which stays in the version history as never approved here.` : `Version ${d.waiting_label} becomes a draft revision. Staff keep reading your approved version.`}</p>
              <div className="flex gap-1.5"><Button size="sm" disabled={busy} onClick={() => act.mutate({ verb: "take" })} data-testid="system-take-yes">Take it</Button><Button size="sm" variant="ghost" onClick={close}>Cancel</Button></div>
            </div>
          )}
          {asking === "owner" && (
            <div className="space-y-2 rounded-md border bg-background text-foreground p-2">
              <p className="text-xs">The owner recalls it from review and gets its review reminders.</p>
              <select className={selectCls} value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Owner here" data-testid="system-owner-pick">
                <option value="">{d.owner_name ?? "Pick a person"}</option>
                {(owners.data?.people ?? []).filter((p) => p.user_id !== d.owner_user_id).map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
              </select>
              <div className="flex gap-1.5"><Button size="sm" disabled={busy || !owner} onClick={() => act.mutate({ verb: "owner", body: { userId: Number(owner) } })}>Save</Button><Button size="sm" variant="ghost" onClick={close}>Cancel</Button></div>
            </div>
          )}
          {asking === "addendum" && (
            <div className="space-y-2 rounded-md border bg-background text-foreground p-2" data-testid="addendum-form">
              <p className="text-xs">For what is particular to your laboratory. It is its own document, with its own versions and approval, read and printed after this one. The system's file doesn't change. No patient information.</p>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" aria-label="Addendum title" data-testid="addendum-title" />
              <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder="Type the addendum" aria-label="Addendum text" disabled={!!file} data-testid="addendum-text" />
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Button size="sm" variant="outline" type="button" onClick={() => fileInput.current?.click()}>{file ? "Change file" : "Or choose a file"}</Button>
                {file && <span className="min-w-0 [overflow-wrap:anywhere]">{file.name} <button type="button" className="underline" onClick={() => setFile(null)}>Remove</button></span>}
                <input ref={fileInput} type="file" className="hidden" accept=".docx,.pdf,.html,.htm,.xlsx,.xls,.png,.jpg,.jpeg,.txt" onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
              </div>
              <div className="flex gap-1.5"><Button size="sm" disabled={busy || (!file && !text.trim())} onClick={() => addAddendum.mutate()} data-testid="addendum-save">{addAddendum.isPending && <Loader2 size={13} className="animate-spin mr-1" />} Add it as a draft</Button><Button size="sm" variant="ghost" onClick={close}>Cancel</Button></div>
            </div>
          )}
          {mayAct && addenda.length > 0 && asking === null && (
            <ul className="text-xs space-y-1">
              {addenda.map((a, i) => (
                <li key={a.document_id} className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 [overflow-wrap:anywhere]">Addendum {i + 1}: {a.title}, version {a.version_label}{a.in_force ? "" : ", not approved yet"}</span>
                  <button type="button" className="underline" onClick={() => takeOff.mutate(a.document_id)} disabled={takeOff.isPending}>Take it off</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** The document's addenda, under it on My Documents, in print order. */
export function DocumentAddenda({ labId, addenda }: { labId: number; addenda: DetailAddendum[] }) {
  return (
    <AddendaView
      headers={authHeaders() as Record<string, string>}
      addenda={addenda.map((a) => ({ key: a.document_id, title: a.title, version: a.version_label, note: a.in_force ? null : "Not approved yet", url: `${API_BASE}${documentUrl(labId, a.document_id)}/render` }))}
    />
  );
}

const needs = (i: ReceivedDocument) => i.document_id != null && !i.archived && ((i.state === "following" && (i.open || i.waiting_label != null)) || i.state === "retired");
const why = (i: ReceivedDocument, fmtDate: (s: string | null) => string): string =>
  i.state === "retired" ? "Retired by the system. Archive it when your laboratory stops using it."
    : i.open && i.status === "in_review" ? `Version ${i.version_label} is in review here.${i.waiting_label ? ` Version ${i.waiting_label} waits behind it.` : ""}`
      : i.open ? `Version ${i.version_label} is a draft here since ${fmtDate(i.received_at)}.${i.waiting_label ? ` Version ${i.waiting_label} waits behind it.` : ""}`
        : `Version ${i.waiting_label} has been waiting since ${fmtDate(i.waiting_since)}.`;

/** Above the document list: what the system sent that is waiting on this laboratory, and a way to everything received. */
export function SystemDocumentsNotice({ labId, canEdit, fmtDate, onView }: { labId: number; canEdit: boolean; fmtDate: (s: string | null) => string; onView: (documentId: number) => void }) {
  const { toast } = useToast();
  const [all, setAll] = useState(false);
  const { data } = useQuery<{ items: ReceivedDocument[]; can_act: boolean }>({ queryKey: [`/api/labs/${labId}/veritapolicy/shared/received`], queryFn: getQueryFn({ on401: "throw" }), refetchOnMount: "always", retry: false });
  const resume = useMutation({
    mutationFn: async (copyId: number) => (await apiRequest("POST", `/api/labs/${labId}/veritapolicy/shared/received/${copyId}/resume`, {})).json(),
    onSuccess: () => { toast({ title: "Your laboratory follows it again." }); refresh(labId); },
    onError: (e) => toast({ title: "Not done", description: apiErrorMessage(e, "Try again."), variant: "destructive" }),
  });
  const items = data?.items ?? [];
  if (items.length === 0) return null;
  const waiting = items.filter(needs);
  const from = items.find((i) => i.organization_name)?.organization_name ?? "your system";
  return (
    <Card className={waiting.length ? "border-sky-300 bg-sky-50/40 dark:border-sky-800 dark:bg-sky-950/20" : ""} data-testid="system-documents-notice">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex flex-wrap items-center gap-2">
          <Building2 size={16} className="text-sky-700 dark:text-sky-400" />
          {waiting.length ? `System documents waiting (${waiting.length})` : "System documents"}
          <Button size="sm" variant="outline" className="ml-auto h-7 text-xs font-normal" onClick={() => setAll(true)} data-testid="system-documents-all">All from {from} ({items.length})</Button>
        </CardTitle>
      </CardHeader>
      {waiting.length > 0 && (
        <CardContent>
          <ul className="space-y-1.5 text-sm">
            {waiting.map((i) => (
              <li key={i.copy_id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1" data-testid={`system-waiting-${i.document_id}`}>
                <div className="min-w-0 flex-1 basis-64">
                  <span className="font-medium">{i.doc_number && <span className="mr-2 font-mono text-xs text-muted-foreground">{i.doc_number}</span>}{i.title}</span>
                  <div className="text-xs text-muted-foreground">{why(i, fmtDate)}</div>
                </div>
                <Button size="sm" variant="outline" onClick={() => onView(i.document_id!)}><Eye size={12} className="mr-1" /> View</Button>
              </li>
            ))}
          </ul>
        </CardContent>
      )}
      <Dialog open={all} onOpenChange={setAll}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>From {from}</DialogTitle></DialogHeader>
          <ul className="divide-y border rounded-md text-sm min-w-0" data-testid="system-documents-list">
            {items.map((i) => (
              <li key={i.copy_id} className="p-2 flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 flex-1 basis-64">
                  <div className="font-medium">{i.title ?? i.master_title}</div>
                  <div className="text-xs text-muted-foreground">
                    {i.document_id == null ? "Your laboratory deleted this document." : i.state === "declined" ? `Declined ${fmtDate(i.declined_at)}: ${i.declined_reason ?? ""}` : `${systemDocumentLabel(i.version_label)}. In use here: ${inUse(i)}.${i.waiting_label ? ` Version ${i.waiting_label} is waiting.` : ""}${i.archived ? " Archived here." : ""}`}
                  </div>
                  {i.state !== "declined" && <div className="text-xs text-muted-foreground">{systemDocumentNote(i)}</div>}
                </div>
                <div className="flex gap-1.5">
                  {i.document_id != null && !i.archived && <Button size="sm" variant="outline" onClick={() => { setAll(false); onView(i.document_id!); }}><Eye size={12} className="mr-1" /> View</Button>}
                  {canEdit && data?.can_act && (i.state === "declined" || i.state === "own_copy") && <Button size="sm" variant="outline" disabled={resume.isPending} onClick={() => resume.mutate(i.copy_id)} data-testid={`system-resume-${i.copy_id}`}>{i.state === "declined" ? "Take it up" : "Follow again"}</Button>}
                </div>
              </li>
            ))}
          </ul>
          <DialogFooter><Button variant="outline" onClick={() => setAll(false)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
