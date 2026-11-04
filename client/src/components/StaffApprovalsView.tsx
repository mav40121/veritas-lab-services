// The staff login's approvals screen (Michael 2026-11-04, Q155 = 1). A staff login named on an approval step, or in a group a step
// goes to, reads the document and approves or rejects it here with password and typed name. No editing seat is used, and nothing
// here uploads or edits.
import { useEffect, useState } from "react";

interface ApprovalRow {
  document_id: number;
  title: string;
  doc_number: string | null;
  step_name: string;
  step_order: number;
  total_steps: number;
  is_major_revision: boolean;
}
interface ApprovalMeta extends ApprovalRow {
  description: string | null;
  version_id: number;
  version_label: string;
  file_format: string;
}

export function StaffApprovalsView({ token, employee, labName, onBack, onSignOut }: {
  token: string;
  employee: { first_name: string; last_name: string; middle_initial?: string | null };
  labName: string;
  onBack: () => void;
  onSignOut: () => void;
}) {
  const [rows, setRows] = useState<ApprovalRow[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [active, setActive] = useState<ApprovalRow | null>(null);
  const [meta, setMeta] = useState<ApprovalMeta | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [fileIsImage, setFileIsImage] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const fullName = `${employee.first_name}${employee.middle_initial ? ` ${employee.middle_initial}.` : ""} ${employee.last_name}`.trim();
  const [typedName, setTypedName] = useState(fullName);
  const [password, setPassword] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  const headers = { Authorization: `Bearer ${token}` };

  function fetchList() {
    setRows(null);
    setListError(null);
    fetch("/api/staff-portal-session/approvals", { headers })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => setRows(d.approvals || []))
      .catch((e: any) => setListError(e.message || "Could not load approvals"));
  }
  useEffect(() => { fetchList(); }, [token]);
  useEffect(() => () => { if (fileUrl) URL.revokeObjectURL(fileUrl); }, [fileUrl]);

  function close() {
    setActive(null);
    setMeta(null);
    setHtml(null);
    if (fileUrl) { URL.revokeObjectURL(fileUrl); setFileUrl(null); }
    setFileIsImage(false);
    setRenderError(null);
    setSignError(null);
    setPassword("");
    setComment("");
  }

  function open(row: ApprovalRow) {
    close();
    setNotice(null);
    setActive(row);
    fetch(`/api/staff-portal-session/approvals/${row.document_id}`, { headers })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
        return r.json();
      })
      .then((m: ApprovalMeta) => {
        setMeta(m);
        return fetch(`/api/staff-portal-session/approvals/${row.document_id}/render`, { headers });
      })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
        const ct = r.headers.get("content-type") || "";
        if (ct.startsWith("application/pdf") || ct.startsWith("image/")) {
          setFileIsImage(ct.startsWith("image/"));
          setFileUrl(URL.createObjectURL(await r.blob()));
        } else {
          const d = await r.json();
          setHtml(typeof d.html === "string" ? d.html : "");
        }
      })
      .catch((e: any) => setRenderError(e.message || "Could not load the document"));
  }

  async function decide(verb: "approve" | "reject") {
    if (!active || !meta) return;
    if (typedName.trim().length < 2) { setSignError("Type your full name to sign."); return; }
    if (!password) { setSignError("Enter your password to sign."); return; }
    if (verb === "reject" && !comment.trim()) { setSignError("Say why you are rejecting it, so the author knows what to fix."); return; }
    setBusy(true);
    setSignError(null);
    try {
      const r = await fetch(`/api/staff-portal-session/approvals/${active.document_id}/${verb}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ typed_signature: typedName.trim(), password, comment: comment.trim() || null, version_id: meta.version_id }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      const title = active.title;
      close();
      setNotice(verb === "reject" ? `Rejected "${title}". It went back to its author.` : `Approved "${title}".`);
      fetchList();
    } catch (e: any) {
      setSignError(e.message || "The signature was not recorded");
    } finally {
      setBusy(false);
    }
  }

  const inputClass = "w-full border border-input rounded-md px-3 py-2 text-sm bg-background mb-3";

  if (active) {
    return (
      <div className="min-h-screen bg-background p-6" data-testid="sp-approvals-detail">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <button onClick={close} className="text-xs text-muted-foreground hover:underline" data-testid="sp-approvals-detail-back">
              &larr; Back to approvals
            </button>
            <button onClick={onSignOut} className="text-xs text-muted-foreground hover:underline">Sign out</button>
          </div>
          <div className="border border-border rounded-lg bg-card p-4 mb-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">{labName} &middot; Waiting for your approval</div>
            <div className="font-serif text-xl font-bold [overflow-wrap:anywhere]" data-testid="sp-approvals-detail-title">{active.title}</div>
            {meta?.description && <div className="text-sm text-muted-foreground mt-1">{meta.description}</div>}
            <div className="text-xs text-muted-foreground mt-2" data-testid="sp-approvals-detail-step">
              Step {active.step_order} of {active.total_steps}: {active.step_name}
              {meta?.version_label && <> &middot; Version {meta.version_label}</>}
              {active.doc_number && <> &middot; {active.doc_number}</>}
            </div>
          </div>

          <div className="border border-border rounded-lg bg-card p-4 mb-4 min-h-[240px]">
            {renderError && (
              <div className="text-xs text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded p-2">{renderError}</div>
            )}
            {!renderError && html === null && fileUrl === null && (
              <div className="text-sm text-muted-foreground py-12 text-center">Loading the document...</div>
            )}
            {html !== null && (
              <div className="prose prose-sm dark:prose-invert max-w-none [overflow-wrap:anywhere]" data-testid="sp-approvals-detail-html" dangerouslySetInnerHTML={{ __html: html }} />
            )}
            {fileUrl !== null && fileIsImage && (
              <img src={fileUrl} alt={active.title} className="max-w-full max-h-[70vh] mx-auto border rounded" data-testid="sp-approvals-detail-image" />
            )}
            {fileUrl !== null && !fileIsImage && (
              <object data={fileUrl} type="application/pdf" className="w-full" style={{ height: "70vh" }} data-testid="sp-approvals-detail-pdf">
                <a href={fileUrl} target="_blank" rel="noreferrer">Open the PDF</a>
              </object>
            )}
          </div>

          <div className="border border-border rounded-lg bg-card p-4" data-testid="sp-approvals-sign">
            <div className="text-sm font-semibold mb-3">Your signature</div>
            <label className="text-xs text-muted-foreground block mb-1" htmlFor="sp-approval-name">Full name</label>
            <input id="sp-approval-name" className={inputClass} value={typedName} onChange={(e) => setTypedName(e.target.value)} data-testid="sp-approval-name" />
            <label className="text-xs text-muted-foreground block mb-1" htmlFor="sp-approval-password">Your password</label>
            <input id="sp-approval-password" type="password" autoComplete="current-password" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} data-testid="sp-approval-password" />
            <label className="text-xs text-muted-foreground block mb-1" htmlFor="sp-approval-comment">Comment (needed to reject)</label>
            <textarea id="sp-approval-comment" rows={2} className={inputClass} value={comment} onChange={(e) => setComment(e.target.value)} data-testid="sp-approval-comment" />
            {signError && (
              <div className="text-xs text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded p-2 mb-3" data-testid="sp-approval-error">{signError}</div>
            )}
            <div className="flex gap-2 flex-wrap">
              <button type="button" onClick={() => decide("approve")} disabled={busy || !meta} className="flex-1 min-w-[140px] text-white font-semibold py-2 rounded-md disabled:opacity-50" style={{ backgroundColor: "#01696F" }} data-testid="sp-approve">
                {busy ? "Signing..." : "Approve"}
              </button>
              <button type="button" onClick={() => decide("reject")} disabled={busy || !meta} className="flex-1 min-w-[140px] font-semibold py-2 rounded-md border border-border disabled:opacity-50" data-testid="sp-reject">
                Reject
              </button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Your typed name, the time, your IP address and the document's content hash are recorded with your signature.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6" data-testid="sp-approvals-list">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between gap-3 mb-6">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Approve Documents</div>
            <div className="font-serif text-xl font-bold">{labName}</div>
            <div className="text-xs text-muted-foreground">Signing as {employee.first_name} {employee.last_name}</div>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <button onClick={onBack} className="text-xs text-muted-foreground hover:underline" data-testid="sp-approvals-back">&larr; Back to modules</button>
            <button onClick={onSignOut} className="text-xs text-muted-foreground hover:underline">Sign out</button>
          </div>
        </div>
        {notice && <div className="text-sm border border-border rounded-lg bg-card p-3 mb-3" data-testid="sp-approvals-notice">{notice}</div>}
        <div className="border border-border rounded-lg bg-card p-4">
          {listError && (
            <div className="text-xs text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded p-2 mb-3">{listError}</div>
          )}
          {rows === null && !listError && <div className="text-sm text-muted-foreground py-6 text-center">Loading...</div>}
          {rows !== null && rows.length === 0 && (
            <div className="text-sm text-muted-foreground py-6 text-center" data-testid="sp-approvals-empty">Nothing is waiting for your approval.</div>
          )}
          {rows !== null && rows.length > 0 && (
            <ul className="divide-y divide-border">
              {rows.map((row) => (
                <li key={row.document_id}>
                  <button type="button" onClick={() => open(row)} className="w-full text-left py-3 hover:bg-muted/50 px-2 rounded" data-testid="sp-approvals-row">
                    <div className="text-sm font-medium [overflow-wrap:anywhere]">{row.title}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Step {row.step_order} of {row.total_steps}: {row.step_name}
                      {row.doc_number && <> &middot; {row.doc_number}</>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
