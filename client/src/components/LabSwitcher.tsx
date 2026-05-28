import { Link, useLocation } from "wouter";
import { useMemberships, type Membership } from "@/hooks/useMemberships";
import { useActiveLabId, withLabPrefix } from "@/hooks/useActiveLabId";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ChevronDown, Building2, Check, Users } from "lucide-react";
import { cn } from "@/lib/utils";

function labLabel(m: Membership): string {
  return m.labName || m.cliaNumber || `Lab #${m.labId}`;
}

// When two labs share a long shared prefix (e.g. both start with
// "UMass Memorial Health - Milford Regional Medical Center"), the
// truncated chip + dropdown row visually collapse to the same string.
// Compute a short distinguishing suffix per lab: the tail portion that
// differs from the longest shared prefix across the user's memberships.
// Returns "" if no useful distinguishing tail exists (single lab, or
// all names already short and unique).
function distinguishingSuffix(target: Membership, all: Membership[]): string {
  if (all.length < 2) return "";
  const targetName = labLabel(target);
  const siblings = all.filter(m => m.labId !== target.labId).map(labLabel);
  if (siblings.length === 0) return "";
  // Find longest common prefix between target and ANY sibling.
  let maxShared = 0;
  for (const sib of siblings) {
    const lim = Math.min(targetName.length, sib.length);
    let i = 0;
    while (i < lim && targetName[i] === sib[i]) i++;
    if (i > maxShared) maxShared = i;
  }
  // Only surface a suffix when the shared prefix is long enough that
  // truncation would actually hide the distinguishing part (>20 chars).
  if (maxShared < 20) return "";
  // Trim leading separators ("- ", " - ", "—", " | ", etc.) from the tail.
  return targetName.slice(maxShared).replace(/^[\s\-—|·:,]+/, "").trim();
}

export function LabSwitcher() {
  const { data: memberships } = useMemberships();
  const activeLabId = useActiveLabId();
  const [location, setLocation] = useLocation();

  if (!memberships || memberships.length === 0) return null;
  if (memberships.length === 1) return null;

  const current =
    memberships.find(m => m.labId === activeLabId) ??
    memberships.find(m => m.isPrimaryLab) ??
    memberships[0];

  const switchTo = async (m: Membership) => {
    if (m.labId === current.labId) return;
    try {
      await apiRequest("POST", "/api/labs/me/default", { labId: m.labId });
    } catch {}
    // Refresh memberships so isPrimaryLab reflects the new default; the
    // chip and any downstream consumer that picks the active lab via
    // memberships.find(m => m.isPrimaryLab) will pick up the change.
    queryClient.invalidateQueries({ queryKey: ["/api/labs/me"] });
    // Also refresh /api/auth/me so the user-level isSeatUser and
    // seatPermissions state mirrors the new active lab. Without this,
    // a user who just accepted a seat invite on a different lab still
    // sees a stale isSeatUser=false until manual hard refresh, which
    // makes the read-only resolver (useIsReadOnly) compute against the
    // wrong seat row and silently disables edit affordances (see
    // SCAHC Clarence Wesley trash button regression 2026-05-28).
    queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    setLocation(withLabPrefix(location, m.labId));
  };

  const currentSuffix = distinguishingSuffix(current, memberships);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="hidden lg:flex gap-1.5 max-w-[260px]"
          title={`Active lab: ${labLabel(current)}${current.cliaNumber ? ` / CLIA ${current.cliaNumber}` : ""}`}
        >
          <Building2 size={13} className="text-primary shrink-0" />
          {currentSuffix ? (
            // Show the distinguishing tail as a bold badge so the truncated
            // shared prefix never collapses two labs into the same visible
            // label (parking-lot #34).
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="truncate text-xs text-muted-foreground">{labLabel(current).slice(0, Math.max(0, labLabel(current).length - currentSuffix.length))}</span>
              <span className="text-xs font-semibold text-foreground shrink-0">{currentSuffix}</span>
            </span>
          ) : (
            <span className="truncate text-xs font-medium">{labLabel(current)}</span>
          )}
          <ChevronDown size={12} className="shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
          Switch lab
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {memberships.map(m => {
          const isCurrent = m.labId === current.labId;
          const suffix = distinguishingSuffix(m, memberships);
          return (
            <DropdownMenuItem
              key={m.membershipId}
              onClick={() => switchTo(m)}
              className={cn("flex items-start gap-2 py-2 cursor-pointer", isCurrent && "bg-secondary")}
              title={labLabel(m)}
            >
              <Check size={14} className={cn("mt-0.5 shrink-0", isCurrent ? "text-primary" : "text-transparent")} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  {labLabel(m)}
                  {suffix && (
                    <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-primary/10 text-primary align-middle">
                      {suffix}
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground flex items-center gap-1 flex-wrap">
                  <span>{m.cliaNumber ? `CLIA ${m.cliaNumber}` : "CLIA not set"}</span>
                  {m.role && m.role !== "owner" && (
                    <span className="inline-flex items-center px-1 py-0.5 rounded bg-muted text-[10px] font-medium text-foreground">{m.role}</span>
                  )}
                  {m.isPrimaryLab && (
                    <span className="inline-flex items-center px-1 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[10px] font-medium">primary</span>
                  )}
                </div>
              </div>
            </DropdownMenuItem>
          );
        })}
        {(current.role === "owner" || current.role === "admin") && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href={`/labs/${current.labId}/members`} className="flex items-center gap-2 py-2 cursor-pointer">
                <Users size={14} className="text-primary shrink-0" />
                <span className="text-sm">Manage members</span>
              </Link>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
