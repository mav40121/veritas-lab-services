// client/src/components/ScanBulkDialogs.tsx
//
// Two dialogs of the VeritaScan scan screen (B7, 2026-11-24; server/veritascanCarry.ts): set the status, owner
// and due date of several items together, and copy this scan's answers to another lab of the organization.

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { API_BASE, responseErrorText } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { AssignPersonDialog, type AssignablePerson } from "@/components/AssignPersonDialog";
import { ScanCarryPicker } from "@/components/ScanCarryPicker";
import type { ScanStatus } from "@/lib/veritaScanData";

const STATUSES: ScanStatus[] = ["Not Assessed", "Compliant", "Needs Attention", "Immediate Action", "N/A"];

export interface BulkSetResult {
  count: number; updated: number; assigned: number; reviewed: number; email: "none" | "sent" | "failed";
  items: Array<{ item_id: number; status: ScanStatus; owner: string | null; owner_user_id: number | null; due_date: string | null }>;
}

export function BulkSetDialog({ labId, scanId, itemIds, pendingCount, viaSupport, beforeSave, onDone, onClose }: {
  labId: number;
  scanId: number;
  itemIds: number[];
  /** How many of them are carried answers nobody has reviewed. */
  pendingCount: number;
  viaSupport: boolean;
  /** Saves what the screen still holds, so nothing typed a moment ago lands on top of this. */
  beforeSave: () => Promise<unknown>;
  onDone: (r: BulkSetResult) => void;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [status, setStatus] = useState<string>("keep");
  const [ownerMode, setOwnerMode] = useState<"keep" | "person" | "typed" | "clear">("keep");
  const [person, setPerson] = useState<AssignablePerson | null>(null);
  const [typed, setTyped] = useState("");
  const [dueMode, setDueMode] = useState<"keep" | "set" | "clear">("keep");
  const [due, setDue] = useState("");
  const [picking, setPicking] = useState(false);
  const n = itemIds.length;
  const things = `${n} ${n === 1 ? "item" : "items"}`;
  const supportHeld = viaSupport && pendingCount > 0;

  const body: Record<string, unknown> = { item_ids: itemIds, expected_count: n };
  if (status !== "keep") body.status = status;
  if (ownerMode === "person" && person) body.owner_user_id = person.userId;
  if (ownerMode === "typed") body.owner = typed.trim();
  if (ownerMode === "clear") body.owner_user_id = null;
  if (dueMode === "set" && due) body.due_date = due;
  if (dueMode === "clear") body.due_date = null;
  const incomplete = (ownerMode === "person" && !person) || (ownerMode === "typed" && !typed.trim()) || (dueMode === "set" && !due);
  const nothing = Object.keys(body).length === 2;

  const save = useMutation({
    mutationFn: async () => {
      await beforeSave();
      const res = await fetch(`${API_BASE}/api/labs/${labId}/veritascan/scans/${scanId}/items/bulk-set`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await responseErrorText(res, "Could not set those items"));
      return res.json() as Promise<BulkSetResult>;
    },
    onSuccess: (r) => {
      toast({
        title: `Set ${r.count} ${r.count === 1 ? "item" : "items"}`,
        description: r.email === "failed" ? "The email could not be sent. Let them know yourself." : r.email === "sent" ? `${person?.name} has been emailed once, for all of them.` : undefined,
      });
      onDone(r);
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Items not changed", description: e.message }),
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md" data-testid="bulk-set-dialog">
        <DialogHeader><DialogTitle>Set {things} together</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Status</Label>
            <Select value={status} onValueChange={setStatus} disabled={supportHeld}>
              <SelectTrigger className="h-9 text-sm" data-testid="bulk-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="keep">Leave as it is</SelectItem>
                {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            {supportHeld && <p className="text-[11px] text-muted-foreground">Some of these are carried answers. The lab's own staff review them.</p>}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Owner</Label>
            <Select value={ownerMode} onValueChange={(v) => { setOwnerMode(v as typeof ownerMode); if (v === "person" && !person) setPicking(true); }}>
              <SelectTrigger className="h-9 text-sm" data-testid="bulk-owner"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="keep">Leave as it is</SelectItem>
                {!viaSupport && <SelectItem value="person">A person on this lab</SelectItem>}
                <SelectItem value="typed">A typed name</SelectItem>
                <SelectItem value="clear">No owner</SelectItem>
              </SelectContent>
            </Select>
            {ownerMode === "person" && (
              <div className="flex items-center gap-2 text-sm">
                <span data-testid="bulk-person">{person ? person.name : "No one picked"}</span>
                <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => setPicking(true)}>Pick</Button>
              </div>
            )}
            {ownerMode === "typed" && <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Owner" maxLength={200} className="h-9" data-testid="bulk-typed" />}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Due date</Label>
            <Select value={dueMode} onValueChange={(v) => setDueMode(v as typeof dueMode)}>
              <SelectTrigger className="h-9 text-sm" data-testid="bulk-due"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="keep">Leave as it is</SelectItem>
                <SelectItem value="set">Set a date</SelectItem>
                <SelectItem value="clear">No due date</SelectItem>
              </SelectContent>
            </Select>
            {dueMode === "set" && <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="h-9" data-testid="bulk-due-date" />}
          </div>
          <p className="text-sm rounded-md bg-muted/50 px-3 py-2" data-testid="bulk-confirm-text">
            This changes <strong>{things}</strong>. Each item keeps its own record of the change.
            {pendingCount > 0 && status !== "keep" && status !== "Not Assessed" && ` ${pendingCount} of them ${pendingCount === 1 ? "is a carried answer" : "are carried answers"} not yet reviewed, and setting a status is your review.`}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={nothing || incomplete || save.isPending} data-testid="bulk-set-confirm">{save.isPending ? "Setting…" : `Set ${things}`}</Button>
        </DialogFooter>
        {picking && (
          <AssignPersonDialog
            labId={labId}
            module="veritascan"
            title={`Assign ${things}`}
            note="They get one email for all of them."
            currentUserId={null}
            onPick={(p) => { setPerson(p); setOwnerMode("person"); setPicking(false); }}
            onClose={() => { setPicking(false); if (!person) setOwnerMode("keep"); }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

export function CopyToLabDialog({ labId, scanId, scanName, labs, onClose }: { labId: number; scanId: number; scanName: string; labs: Array<{ id: number; name: string }>; onClose: () => void }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [target, setTarget] = useState<string>(labs.length === 1 ? String(labs[0].id) : "");
  const [name, setName] = useState(scanName);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const targetName = labs.find((l) => String(l.id) === target)?.name;
  const copy = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/api/labs/${target}/veritascan/scans`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ name: name.trim(), carryFrom: { scanId, itemIds: [...selected] } }),
      });
      if (!res.ok) throw new Error(await responseErrorText(res, "Could not copy the answers"));
      return res.json() as Promise<{ id: number; carried: number }>;
    },
    onSuccess: (r) => {
      toast({ title: `Copied ${r.carried} answers to ${targetName}`, description: "They are marked not yet reviewed there." });
      onClose();
      navigate(`/labs/${target}/veritascan-app/${r.id}`);
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Answers not copied", description: e.message }),
  });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="copy-lab-dialog">
        <DialogHeader><DialogTitle>Copy answers to another lab</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">This makes a new scan in the other lab. Nothing already there changes, and this scan stays as it is.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Lab</Label>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger className="h-9 text-sm" data-testid="copy-lab"><SelectValue placeholder="Pick a lab" /></SelectTrigger>
              <SelectContent>{labs.map((l) => <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Name of the new scan</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className="h-9" data-testid="copy-name" />
          </div>
        </div>
        <ScanCarryPicker labId={labId} scanId={scanId} selected={selected} onChange={setSelected} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => copy.mutate()} disabled={!target || !name.trim() || selected.size === 0 || copy.isPending} data-testid="copy-confirm">
            {copy.isPending ? "Copying…" : `Copy ${selected.size} ${selected.size === 1 ? "answer" : "answers"}${targetName ? ` to ${targetName}` : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
