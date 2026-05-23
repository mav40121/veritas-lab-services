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
    setLocation(withLabPrefix(location, m.labId));
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="hidden lg:flex gap-1.5 max-w-[220px]"
          title={`Active lab: ${labLabel(current)}${current.cliaNumber ? ` / CLIA ${current.cliaNumber}` : ""}`}
        >
          <Building2 size={13} className="text-primary shrink-0" />
          <span className="truncate text-xs font-medium">{labLabel(current)}</span>
          <ChevronDown size={12} className="shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
          Switch lab
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {memberships.map(m => {
          const isCurrent = m.labId === current.labId;
          return (
            <DropdownMenuItem
              key={m.membershipId}
              onClick={() => switchTo(m)}
              className={cn("flex items-start gap-2 py-2 cursor-pointer", isCurrent && "bg-secondary")}
            >
              <Check size={14} className={cn("mt-0.5 shrink-0", isCurrent ? "text-primary" : "text-transparent")} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{labLabel(m)}</div>
                <div className="text-xs text-muted-foreground">
                  {m.cliaNumber ? `CLIA ${m.cliaNumber}` : "CLIA not set"}
                  {m.role && m.role !== "owner" ? ` , ${m.role}` : ""}
                  {m.isPrimaryLab ? " , primary" : ""}
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
