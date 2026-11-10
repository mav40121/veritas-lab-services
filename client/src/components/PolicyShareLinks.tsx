// PolicyShareLinks.tsx
//
// The "Share link" section on a VeritaDC document's view (VeritaPolicyMyPoliciesPage.tsx), for VeritaDC editors only:
// create a link to this one document's current approved version, copy it, see its views, revoke it
// (server/policyShareLinks.ts). The list call needs VeritaDC edit, so anyone else gets nothing from it and sees nothing.

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiErrorMessage, apiRequest, getQueryFn, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { labLocaleDate } from "@/lib/labDate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Copy, Share2 } from "lucide-react";

interface ShareLinkRow {
  id: number;
  token: string;
  path: string;
  label: string | null;
  created_at: string;
  created_by_name: string | null;
  revoked_at: string | null;
  revoked_by_name: string | null;
  view_count: number;
  last_viewed_at: string | null;
  status: "active" | "revoked" | "not_showing";
}

const STATUS_TEXT: Record<ShareLinkRow["status"], { text: string; cls: string }> = {
  active: { text: "Active", cls: "bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-200 dark:border-emerald-700" },
  revoked: { text: "Revoked", cls: "bg-zinc-100 text-zinc-700 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-600" },
  not_showing: { text: "Not showing", cls: "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-700" },
};

export function PolicyShareLinks({ labId, documentId }: { labId: number; documentId: number }) {
  const { toast } = useToast();
  const key = `/api/labs/${labId}/veritapolicy/documents/${documentId}/share-links`;
  // shows_version: the approved version's label while a revision is a draft or in review (BUG-151), else null.
  const { data, isError } = useQuery<{ shareable: boolean; shows_version?: string | null; links: ShareLinkRow[] }>({
    queryKey: [key],
    queryFn: getQueryFn({ on401: "throw" }),
    retry: false,
  });
  const [label, setLabel] = useState("");
  const [confirmRevoke, setConfirmRevoke] = useState<number | null>(null);

  const linkUrl = (path: string) => `${window.location.origin}${path}`;
  const copy = async (path: string) => {
    const url = linkUrl(path);
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied", description: url });
    } catch {
      toast({ title: "Copy this link", description: url });
    }
  };

  const create = useMutation({
    mutationFn: async () => (await apiRequest("POST", key, { label: label.trim() || undefined })).json(),
    onSuccess: async (body: any) => {
      setLabel("");
      queryClient.invalidateQueries({ queryKey: [key] });
      await copy(`/policy/${body.token}`);
    },
    onError: (e) => toast({ title: "Share link not created", description: apiErrorMessage(e, "Try again."), variant: "destructive" }),
  });
  const revoke = useMutation({
    mutationFn: async (id: number) => (await apiRequest("DELETE", `${key}/${id}`)).json(),
    onSuccess: () => {
      setConfirmRevoke(null);
      queryClient.invalidateQueries({ queryKey: [key] });
      toast({ title: "Link revoked", description: "Anyone opening it now sees that the link is not active." });
    },
    onError: (e) => toast({ title: "Not revoked", description: apiErrorMessage(e, "Try again."), variant: "destructive" }),
  });

  // Not an editor (the list is refused), or nothing to show: a document with no approved version and no links yet.
  if (isError || !data || (!data.shareable && data.links.length === 0)) return null;

  return (
    <div className="rounded border bg-muted/20 p-2 text-xs space-y-2" data-testid="share-links">
      <div className="font-medium flex items-center gap-1">
        <Share2 size={14} /> Share link
      </div>
      <p className="text-muted-foreground">
        Anyone with this link can read the current approved version of this document, without signing in. Use it for documents meant for people outside the lab, such as a specimen collection manual. Revoke it any time.
      </p>
      {data.shareable && data.shows_version && (
        <p className="text-amber-800 dark:text-amber-300" data-testid="share-links-shows-approved">
          A revision is in progress. Links show the approved version, v{data.shows_version}, until the revision is approved.
        </p>
      )}
      {!data.shareable && (
        <p className="text-amber-800 dark:text-amber-300" data-testid="share-links-not-showing">
          This document has no approved version right now, so its links show "This link is not active" until it is approved again.
        </p>
      )}
      {data.shareable && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={120}
            placeholder="Label (optional), such as Nursing intranet"
            className="h-7 text-xs flex-1 min-w-[12rem]"
            data-testid="share-link-label"
          />
          <Button size="sm" className="h-7" onClick={() => create.mutate()} disabled={create.isPending} data-testid="share-link-create">
            {create.isPending ? "Creating..." : "Create share link"}
          </Button>
        </div>
      )}
      {data.links.length > 0 && (
        <ul className="divide-y rounded border bg-background" data-testid="share-link-list">
          {data.links.map((l) => (
            <li key={l.id} className="p-2 flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="share-link-row">
              <span className="font-medium break-words">{l.label || "No label"}</span>
              <span className={`px-1.5 py-0.5 rounded border text-[10px] uppercase ${STATUS_TEXT[l.status].cls}`} data-testid="share-link-status">
                {STATUS_TEXT[l.status].text}
              </span>
              <span className="text-muted-foreground">Created {labLocaleDate(l.created_at)}{l.created_by_name ? ` by ${l.created_by_name}` : ""}</span>
              <span className="text-muted-foreground" data-testid="share-link-views">
                {l.view_count} {l.view_count === 1 ? "view" : "views"}
                {l.last_viewed_at ? `, last ${labLocaleDate(l.last_viewed_at)}` : ""}
              </span>
              {l.revoked_at && <span className="text-muted-foreground">Revoked {labLocaleDate(l.revoked_at)}{l.revoked_by_name ? ` by ${l.revoked_by_name}` : ""}</span>}
              {!l.revoked_at && (
                <span className="ml-auto flex items-center gap-1">
                  <Button size="sm" variant="outline" className="h-6" onClick={() => copy(l.path)} data-testid="share-link-copy">
                    <Copy size={12} className="mr-1" /> Copy link
                  </Button>
                  {confirmRevoke === l.id ? (
                    <>
                      <Button size="sm" variant="destructive" className="h-6" onClick={() => revoke.mutate(l.id)} disabled={revoke.isPending} data-testid="share-link-revoke-confirm">
                        Revoke this link
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6" onClick={() => setConfirmRevoke(null)}>
                        Keep
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" variant="ghost" className="h-6 text-red-700 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300" onClick={() => setConfirmRevoke(l.id)} data-testid="share-link-revoke">
                      Revoke
                    </Button>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
