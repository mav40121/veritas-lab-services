// client/src/components/AssignPersonDialog.tsx
//
// Pick a person on this lab (B6, 2026-11-24; server/assignablePeople.ts): the lab's owner, an active member,
// or someone on the roster with a Staff login. Used for a VeritaResponse finding, a VeritaScan item, and several items at
// once. The server refuses the list to anyone who can't assign in the module, and re-checks the person it is sent.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, UserRound } from "lucide-react";
import { API_BASE, responseErrorText } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";

export interface AssignablePerson { userId: number; name: string; email: string; staffLogin: boolean }

export function AssignPersonDialog({ labId, module, title, note, currentUserId, busy, onPick, onClose }: {
  labId: number;
  module: "veritaresponse" | "veritascan";
  title: string;
  note?: string;
  currentUserId?: number | null;
  busy?: boolean;
  onPick: (person: AssignablePerson) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const { data, isLoading, error } = useQuery<{ people: AssignablePerson[] }>({
    queryKey: [`/api/labs/${labId}/assignable-people?module=${module}`],
    // People join and leave the lab on other screens, so the list is read each time the picker opens.
    refetchOnMount: "always",
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/labs/${labId}/assignable-people?module=${module}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(await responseErrorText(res, "Could not load the people on this lab"));
      return res.json();
    },
  });
  const q = search.trim().toLowerCase();
  const people = (data?.people ?? []).filter((p) => !q || p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q));
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md" data-testid="assign-person-dialog">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">{note ?? "They get one email saying it is assigned to them."}</p>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or email" className="h-9 pl-8" data-testid="assign-search" />
        </div>
        <div className="max-h-[46vh] overflow-y-auto space-y-1">
          {people.map((p) => (
            <button
              key={p.userId}
              type="button"
              disabled={busy || p.userId === currentUserId}
              onClick={() => onPick(p)}
              className="w-full text-left p-2 rounded border border-border hover:bg-muted/50 transition-colors disabled:opacity-60"
              data-testid={`assign-pick-${p.userId}`}
            >
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <UserRound className="h-3.5 w-3.5 text-primary shrink-0" />
                <span className="truncate">{p.name}</span>
                {p.userId === currentUserId && <span className="text-[11px] font-normal text-muted-foreground">assigned now</span>}
              </span>
              <span className="block text-[11px] text-muted-foreground truncate">{p.email}{p.staffLogin ? ", Staff login" : ""}</span>
            </button>
          ))}
          {people.length === 0 && (
            <p className="text-xs text-muted-foreground italic py-6 text-center">
              {isLoading ? "Loading the people on this lab…" : error ? (error as Error).message : "No one matches."}
            </p>
          )}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
