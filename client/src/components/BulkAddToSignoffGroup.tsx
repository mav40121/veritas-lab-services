import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { FolderPlus } from "lucide-react";

type Group = { id: number; name: string; due_date: string | null; status: string };

// Batch add-to-sign-off-group control. Adds every study id in `studyIds` to one
// sign-off group in a single call. The server endpoint already accepts a studyIds
// array and returns { added, skipped:[{id,reason}] }; studies that are finalized,
// archived, or already in another group are skipped and reported, not failed.
// Surface-agnostic: the caller supplies the selected study ids and the list query
// to invalidate on success (the My Studies list, or the Coverage page's studies).
export function BulkAddToSignoffGroup({
  labId, studyIds, listUrl, onDone,
}: { labId: number; studyIds: number[]; listUrl: string; onDone: () => void }) {
  const { toast } = useToast();
  const groupsUrl = `/api/labs/${labId}/veritacheck/signoff-groups`;
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");

  const { data: groups } = useQuery<Group[]>({ queryKey: [groupsUrl] });
  const openGroups = (groups || []).filter((g) => g.status === "open");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [groupsUrl] });
    queryClient.invalidateQueries({ queryKey: [listUrl] });
  };
  const report = (added: number, skipped: number) => {
    const parts = [`${added} ${added === 1 ? "study" : "studies"} added`];
    if (skipped > 0) parts.push(`${skipped} skipped (already finalized or in another group)`);
    toast({ title: "Sign-off group updated", description: parts.join(". ") });
  };
  const addMut = useMutation({
    mutationFn: async (gid: number) => {
      const res = await apiRequest("POST", `${groupsUrl}/${gid}/studies`, { studyIds });
      return res.json();
    },
    onSuccess: (r: any) => { invalidate(); report((r?.added || []).length, (r?.skipped || []).length); onDone(); },
    onError: () => toast({ title: "Could not add to group", variant: "destructive" }),
  });
  const createMut = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", groupsUrl, { name });
      const created = await res.json();
      const addRes = await apiRequest("POST", `${groupsUrl}/${created.id}/studies`, { studyIds });
      return addRes.json();
    },
    onSuccess: (r: any) => { invalidate(); setNewOpen(false); setNewName(""); report((r?.added || []).length, (r?.skipped || []).length); onDone(); },
    onError: () => toast({ title: "Could not create group", variant: "destructive" }),
  });

  const busy = addMut.isPending || createMut.isPending;
  const disabled = studyIds.length === 0 || busy;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground h-8" disabled={disabled} data-testid="button-bulk-add-group">
            <FolderPlus size={13} className="mr-1" />Add {studyIds.length} to sign-off group
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>Add selected to</DropdownMenuLabel>
          {openGroups.map((g) => (
            <DropdownMenuItem key={g.id} onClick={() => addMut.mutate(g.id)} data-testid={`bulk-add-to-group-${g.id}`}>
              {g.name}{g.due_date ? ` (due ${g.due_date})` : ""}
            </DropdownMenuItem>
          ))}
          {openGroups.length === 0 && (
            <DropdownMenuItem disabled className="text-xs text-muted-foreground">No open groups yet</DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setNewOpen(true)} data-testid="bulk-new-group">
            <FolderPlus size={13} className="mr-2" />New group...
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New sign-off group</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            The {studyIds.length} selected {studyIds.length === 1 ? "study" : "studies"} will be added to this group. Studies that are already finalized or in another group are skipped.
          </p>
          <Input
            placeholder="Group name, for example Biannual due 7/27"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            data-testid="input-bulk-new-group-name"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>Cancel</Button>
            <Button disabled={!newName.trim() || createMut.isPending} onClick={() => createMut.mutate(newName.trim())} data-testid="button-bulk-create-group">
              Create and add {studyIds.length}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
