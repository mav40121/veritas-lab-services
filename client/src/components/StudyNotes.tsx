// client/src/components/StudyNotes.tsx
//
// Notes on a VeritaCheck study (2026-10-26, Michael: "a notes section where users can input their own notes to
// refer back to later"). The lab's own working notes, shown under the results: anyone who can open the study reads
// them, writers add them, and the author or a lab owner or admin removes one (it stays as "note removed"). Notes are
// not part of the study record: they never print on the report, and adding one does not change a signed study.
// Server: /api/labs/:labId/studies/:id/notes (routes.ts, table study_notes). Same pattern as the policy notes.

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { MessageSquare, Loader2, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient, getQueryFn } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface StudyNote {
  id: number;
  author_user_id: number;
  author_name: string;
  body: string | null;
  created_at: string;
  deleted_at: string | null;
  can_delete: boolean;
}

// created_at is SQLite datetime('now'): "YYYY-MM-DD HH:MM:SS" in UTC. Show it in the reader's local time.
function fmtWhen(s: string): string {
  const d = new Date(s.includes("T") ? s : s.replace(" ", "T") + "Z");
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function StudyNotes({ labId, studyId, readOnly }: { labId: number; studyId: number; readOnly: boolean }) {
  const { toast } = useToast();
  const [draft, setDraft] = useState("");
  const notesUrl = `/api/labs/${labId}/studies/${studyId}/notes`;
  const { data, isLoading, error } = useQuery<{ notes: StudyNote[] }>({
    queryKey: [notesUrl],
    queryFn: getQueryFn({ on401: "throw" }),
  });
  const notes = data?.notes || [];
  const addNote = useMutation({
    mutationFn: (body: string) => apiRequest("POST", notesUrl, { body }),
    onSuccess: () => {
      setDraft("");
      queryClient.invalidateQueries({ queryKey: [notesUrl] });
    },
    onError: (e: any) => toast({ title: "Could not add note", description: String(e?.message || e), variant: "destructive" }),
  });
  const removeNote = useMutation({
    mutationFn: (noteId: number) => apiRequest("DELETE", `${notesUrl}/${noteId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [notesUrl] }),
    onError: (e: any) => toast({ title: "Could not remove note", description: String(e?.message || e), variant: "destructive" }),
  });

  return (
    <Card className="mt-6" data-testid="study-notes">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <MessageSquare size={14} /> Notes
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Your lab's notes on this study, for reference later. They are not printed on the report and do not change a
          signed study. Do not enter patient information.
        </p>
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" /> Loading notes...
          </div>
        )}
        {error && (
          <div className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded px-2 py-2">
            {String((error as any)?.message || error)}
          </div>
        )}
        {!isLoading && !error && notes.length === 0 && (
          <div className="text-sm text-muted-foreground" data-testid="study-notes-empty">No notes yet.</div>
        )}
        {notes.length > 0 && (
          <ol className="space-y-1.5" data-testid="study-notes-list">
            {notes.map((n) => (
              <li key={n.id} className="border border-border rounded px-2.5 py-2 text-sm bg-muted/40" data-testid={`study-note-${n.id}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-medium">{n.author_name}</span>
                    <span className="text-muted-foreground text-xs"> {fmtWhen(n.created_at)}</span>
                  </div>
                  {n.can_delete && !readOnly && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-1 text-muted-foreground hover:text-destructive"
                      title="Remove this note"
                      disabled={removeNote.isPending}
                      onClick={() => {
                        if (confirm("Remove this note? It will show as removed.")) removeNote.mutate(n.id);
                      }}
                      data-testid={`study-note-delete-${n.id}`}
                    >
                      <Trash2 size={13} />
                    </Button>
                  )}
                </div>
                {n.deleted_at ? (
                  <div className="italic text-muted-foreground text-xs mt-0.5">note removed</div>
                ) : (
                  <div className="whitespace-pre-wrap break-words mt-0.5">{n.body}</div>
                )}
              </li>
            ))}
          </ol>
        )}
        {!readOnly && (
          <div className="space-y-2">
            <Textarea
              placeholder="Add a note..."
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              maxLength={5000}
              data-testid="study-note-input"
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                disabled={!draft.trim() || addNote.isPending}
                onClick={() => addNote.mutate(draft.trim())}
                data-testid="study-note-add"
              >
                {addNote.isPending && <Loader2 size={14} className="mr-1.5 animate-spin" />}
                Add note
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
