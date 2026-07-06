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
import { FolderPlus, Check } from "lucide-react";

type Group = { id: number; name: string; due_date: string | null; status: string };

// Per-study control that adds a completed, not-yet-signed study to a VeritaCheck
// Sign-off Group so it can later be mass-signed. Lab-scoped; only rendered when
// a lab is active (the endpoints have no legacy single-user variant).
export function AddToSignoffGroup({
  studyId, labId, currentGroupId, listUrl,
}: { studyId: number; labId: number; currentGroupId: number | null; listUrl: string }) {
  const { toast } = useToast();
  const groupsUrl = `/api/labs/${labId}/veritacheck/signoff-groups`;
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");

  const { data: groups } = useQuery<Group[]>({ queryKey: [groupsUrl] });
  const openGroups = (groups || []).filter((g) => g.status === "open");
  const currentGroup = (groups || []).find((g) => g.id === currentGroupId);
  const inGroup = currentGroupId != null;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [groupsUrl] });
    queryClient.invalidateQueries({ queryKey: [listUrl] });
  };
  const addMut = useMutation({
    mutationFn: (gid: number) => apiRequest("POST", `${groupsUrl}/${gid}/studies`, { studyIds: [studyId] }),
    onSuccess: () => { invalidate(); toast({ title: "Added to sign-off group" }); },
    onError: () => toast({ title: "Could not add to group", variant: "destructive" }),
  });
  const removeMut = useMutation({
    mutationFn: (gid: number) => apiRequest("DELETE", `${groupsUrl}/${gid}/studies/${studyId}`),
    onSuccess: () => { invalidate(); toast({ title: "Removed from group" }); },
    onError: () => toast({ title: "Could not remove from group", variant: "destructive" }),
  });
  const createMut = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", groupsUrl, { name });
      const created = await res.json();
      await apiRequest("POST", `${groupsUrl}/${created.id}/studies`, { studyIds: [studyId] });
      return created;
    },
    onSuccess: () => { invalidate(); setNewOpen(false); setNewName(""); toast({ title: "Group created, study added" }); },
    onError: () => toast({ title: "Could not create group", variant: "destructive" }),
  });

  const selectable = openGroups.filter((g) => g.id !== currentGroupId);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8" data-testid={`button-add-group-${studyId}`} title="Add to sign-off group">
            {inGroup
              ? <><Check size={13} className="mr-1 text-emerald-500" />In group</>
              : <><FolderPlus size={13} className="mr-1" />Group</>}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel>Sign-off group</DropdownMenuLabel>
          {inGroup && (
            <>
              <DropdownMenuItem disabled className="text-xs opacity-100">In: {currentGroup?.name || `#${currentGroupId}`}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => removeMut.mutate(currentGroupId!)}>Remove from this group</DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          {selectable.map((g) => (
            <DropdownMenuItem key={g.id} onClick={() => addMut.mutate(g.id)}>
              {g.name}{g.due_date ? ` (due ${g.due_date})` : ""}
            </DropdownMenuItem>
          ))}
          {selectable.length === 0 && !inGroup && (
            <DropdownMenuItem disabled className="text-xs text-muted-foreground">No open groups yet</DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setNewOpen(true)}>
            <FolderPlus size={13} className="mr-2" />New group...
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New sign-off group</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Studies are added to the group as they are drafted and reviewed. When the group is complete, sign it in one action.
          </p>
          <Input
            placeholder="Group name, for example Biannual due 7/27"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            data-testid="input-new-group-name"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>Cancel</Button>
            <Button disabled={!newName.trim() || createMut.isPending} onClick={() => createMut.mutate(newName.trim())} data-testid="button-create-group">
              Create and add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
