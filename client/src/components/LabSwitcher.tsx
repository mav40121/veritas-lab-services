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

// Wave A6: parse the CLIA cert active-through date into a display label
// + days-remaining (informational, never gates). Treats anything within
// 30 days (or already past) as "warn" for a soft amber chip. Returns
// null when the lab has no cert on file or the value is unparseable so
// the dropdown row falls back to the plain "CLIA {number}" line.
export function cliaCertDisplay(dateStr: string | null | undefined): {
  ymd: string;
  daysRemaining: number;
  warn: boolean;
  expired: boolean;
} | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  // Date-only diff so a cert with a 23:59 timestamp doesn't read as
  // "expires today" when local clock is 00:01 the next morning.
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  return {
    ymd: target.toISOString().slice(0, 10),
    daysRemaining: days,
    warn: days <= 30,
    expired: days < 0,
  };
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

// Shared switch hook. Returns the user's memberships, the current active
// lab, and a switchTo(m) function. Used by both LabSwitcher (desktop
// dropdown) and LabSwitcherMobile (drawer list section). Returns null
// when the switcher should not render (no memberships, or only one).
function useLabSwitcherState() {
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
    // Refetch memberships + auth/me and AWAIT them before navigating, so the
    // new active lab is fully settled first. These power:
    //   - isPrimaryLab, which is how the active lab is resolved on any page
    //     whose URL has no /labs/:id prefix (public/marketing pages, where the
    //     switch does not rewrite the URL), and
    //   - isSeatUser / seatPermissions, which the read-only resolver
    //     (useIsReadOnly) reads (see SCAHC Clarence Wesley trash button
    //     regression 2026-05-28).
    // Previously these were fire-and-forget invalidations, so the FIRST nav
    // click right after a switch resolved its lab id from the stale memberships
    // cache (current = the old isPrimaryLab), landed on the previous lab, and
    // errored; the second click worked once the refetch had landed. Awaiting
    // the refetch closes that race.
    await Promise.all([
      queryClient.refetchQueries({ queryKey: ["/api/labs/me"] }),
      queryClient.refetchQueries({ queryKey: ["/api/auth/me"] }),
    ]);
    setLocation(withLabPrefix(location, m.labId));
  };

  return { memberships, current, switchTo };
}

export function LabSwitcher() {
  const state = useLabSwitcherState();
  if (!state) return null;
  const { memberships, current, switchTo } = state;

  const currentSuffix = distinguishingSuffix(current, memberships);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="hidden lg:flex gap-1.5 max-w-[200px]"
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
                  {(() => {
                    const cert = cliaCertDisplay(m.cliaCertExpirationDate);
                    if (!cert) return null;
                    return (
                      <span
                        className={cn(
                          "inline-flex items-center px-1 py-0.5 rounded text-[10px] font-medium",
                          cert.warn
                            ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                            : "bg-muted text-foreground"
                        )}
                        title={
                          cert.expired
                            ? `CLIA cert expiration date on file is ${cert.ymd} (${Math.abs(cert.daysRemaining)} day${Math.abs(cert.daysRemaining) === 1 ? "" : "s"} ago). Informational only: modules are not gated on cert renewal.`
                            : `CLIA cert active through ${cert.ymd} (${cert.daysRemaining} day${cert.daysRemaining === 1 ? "" : "s"} remaining). Informational only.`
                        }
                      >
                        {cert.expired ? `CLIA expired ${cert.ymd}` : `active through ${cert.ymd}`}
                      </span>
                    );
                  })()}
                  {m.primaryRegime === "NYS-CLEP" && (
                    <span
                      className="inline-flex items-center px-1 py-0.5 rounded text-[10px] font-medium bg-blue-500/10 text-blue-700 dark:text-blue-400"
                      title="This lab operates under New York State DOH / CLEP jurisdiction (10 NYCRR Part 58), in addition to its national accreditor."
                    >
                      NYS DOH / CLEP{m.accreditationTjc ? " + TJC" : m.accreditationCap ? " + CAP" : m.accreditationCola ? " + COLA" : ""}
                    </span>
                  )}
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

// Mobile variant: inline list section meant to live inside the NavBar
// hamburger drawer. Same switchTo logic as the desktop dropdown, but
// rendered as full-width tappable rows because the mobile drawer
// already has its own scroll container. Calls onAfterSwitch() after
// switchTo() so the parent NavBar can close the drawer.
//
// Renders null when the user has fewer than 2 memberships, identical
// to the desktop variant.
export function LabSwitcherMobile({ onAfterSwitch }: { onAfterSwitch?: () => void }) {
  const state = useLabSwitcherState();
  if (!state) return null;
  const { memberships, current, switchTo } = state;

  return (
    <div className="px-1 py-2 border-t border-border mt-2">
      <div className="px-2 pb-1.5 flex items-center gap-1.5">
        <Building2 size={13} className="text-primary shrink-0" />
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Switch lab</span>
      </div>
      <div className="flex flex-col">
        {memberships.map(m => {
          const isCurrent = m.labId === current.labId;
          const suffix = distinguishingSuffix(m, memberships);
          const cert = cliaCertDisplay(m.cliaCertExpirationDate);
          return (
            <button
              key={m.membershipId}
              type="button"
              onClick={async () => {
                await switchTo(m);
                onAfterSwitch?.();
              }}
              className={cn(
                "flex items-start gap-2 px-3 py-2 rounded-md text-left hover:bg-secondary transition-colors",
                isCurrent && "bg-secondary"
              )}
            >
              <Check size={14} className={cn("mt-1 shrink-0", isCurrent ? "text-primary" : "text-transparent")} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  {labLabel(m)}
                  {suffix && (
                    <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-primary/10 text-primary align-middle">
                      {suffix}
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground flex items-center gap-1 flex-wrap mt-0.5">
                  <span>{m.cliaNumber ? `CLIA ${m.cliaNumber}` : "CLIA not set"}</span>
                  {cert && (
                    <span
                      className={cn(
                        "inline-flex items-center px-1 py-0.5 rounded text-[10px] font-medium",
                        cert.warn
                          ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                          : "bg-muted text-foreground"
                      )}
                    >
                      {cert.expired ? `CLIA expired ${cert.ymd}` : `active through ${cert.ymd}`}
                    </span>
                  )}
                  {m.primaryRegime === "NYS-CLEP" && (
                    <span
                      className="inline-flex items-center px-1 py-0.5 rounded text-[10px] font-medium bg-blue-500/10 text-blue-700 dark:text-blue-400"
                      title="This lab operates under New York State DOH / CLEP jurisdiction (10 NYCRR Part 58), in addition to its national accreditor."
                    >
                      NYS DOH / CLEP{m.accreditationTjc ? " + TJC" : m.accreditationCap ? " + CAP" : m.accreditationCola ? " + COLA" : ""}
                    </span>
                  )}
                  {m.role && m.role !== "owner" && (
                    <span className="inline-flex items-center px-1 py-0.5 rounded bg-muted text-[10px] font-medium text-foreground">{m.role}</span>
                  )}
                  {m.isPrimaryLab && (
                    <span className="inline-flex items-center px-1 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[10px] font-medium">primary</span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
