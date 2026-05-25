import { useAuth } from "./AuthContext";
import { AlertTriangle, Lock, ArrowRight } from "lucide-react";
import { resolveSeatPermission } from "@shared/schema";
import { useActiveSubscription } from "@/hooks/useActiveSubscription";
import { useMemberships } from "@/hooks/useMemberships";
import { useActiveLabId } from "@/hooks/useActiveLabId";

// Multi-Lab Tier 2 Phase 4.3c: accessLevel and subscription dates source
// from the active lab's membership (via useActiveSubscription). Falls back
// to user-level state when no lab is active. Same shape as the legacy
// hook; callers do not need to change.
export function useAccessLevel() {
  return useActiveSubscription().accessLevel;
}

export function useIsReadOnly(module?: string): boolean {
  const { user } = useAuth();
  const level = useAccessLevel();
  const activeLabId = useActiveLabId();
  const { data: memberships } = useMemberships();
  const baseReadOnly = level === 'read_only' || level === 'locked';
  if (baseReadOnly) return true;

  // Lab-role override (2026-05-25): if the user is the owner or admin of the
  // active lab, they get edit access regardless of any seat row that might
  // exist under another lab. Without this, a stale user_seats row from the
  // Lisa-cascade incident (or any future seat-row leak) makes every Verita
  // module render as read-only on the owner's own labs because isSeatUser=true
  // poisons the resolver branch below. The right rule is: owner on the active
  // lab wins, full stop.
  const activeMembership = activeLabId
    ? memberships?.find(m => m.labId === activeLabId)
    : (memberships?.find(m => m.isPrimaryLab) ?? memberships?.[0]);
  if (activeMembership && (activeMembership.role === 'owner' || activeMembership.role === 'admin')) {
    return false;
  }

  // Seat user module check. Resolver handles both shapes:
  //   * legacy flat map (auto-upgrades all-edit seats to edit_all)
  //   * new mode shape (edit_all / view_all / custom)
  // See shared/schema.ts. If no module key passed, fall through to false --
  // pages without per-module gating still respect base access level above.
  if (module && user?.isSeatUser && user?.seatPermissions) {
    const perm = resolveSeatPermission(user.seatPermissions, module);
    return perm !== 'edit';
  }
  return false;
}

export function SubscriptionBanner() {
  const { isLoggedIn } = useAuth();
  const sub = useActiveSubscription();
  if (!isLoggedIn) return null;

  const accessLevel = sub.accessLevel;
  if (accessLevel === 'full' || accessLevel === 'free') return null;

  if (accessLevel === 'read_only') {
    const expiresAt = sub.subscriptionExpiresAt ? new Date(sub.subscriptionExpiresAt) : null;
    const retentionEnd = expiresAt ? new Date(expiresAt) : null;
    if (retentionEnd) retentionEnd.setFullYear(retentionEnd.getFullYear() + 2);
    const dateStr = retentionEnd ? retentionEnd.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'N/A';

    return (
      <div className="bg-amber-50 dark:bg-amber-950/50 border-b border-amber-200 dark:border-amber-800 px-4 py-2.5 text-center">
        <div className="flex items-center justify-center gap-2 text-amber-800 dark:text-amber-200 text-sm">
          <AlertTriangle size={15} className="shrink-0" />
          <span>
            Your subscription has expired. You have read-only access to your data until {dateStr}.
          </span>
          <a
            href="/veritacheck"
            className="inline-flex items-center gap-1 font-semibold text-amber-900 dark:text-amber-100 hover:underline ml-1"
          >
            Resubscribe <ArrowRight size={13} />
          </a>
        </div>
      </div>
    );
  }

  if (accessLevel === 'locked') {
    const expiresAt = sub.subscriptionExpiresAt ? new Date(sub.subscriptionExpiresAt) : null;
    const retentionEnd = expiresAt ? new Date(expiresAt) : null;
    if (retentionEnd) retentionEnd.setFullYear(retentionEnd.getFullYear() + 2);
    const dateStr = retentionEnd ? retentionEnd.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'N/A';

    return (
      <div className="bg-red-50 dark:bg-red-950/50 border-b border-red-200 dark:border-red-800 px-4 py-2.5 text-center">
        <div className="flex items-center justify-center gap-2 text-red-800 dark:text-red-200 text-sm">
          <Lock size={15} className="shrink-0" />
          <span>
            Your data retention period ended on {dateStr}.
          </span>
          <a
            href="/veritacheck"
            className="inline-flex items-center gap-1 font-semibold text-red-900 dark:text-red-100 hover:underline ml-1"
          >
            Resubscribe to restore access <ArrowRight size={13} />
          </a>
        </div>
      </div>
    );
  }

  return null;
}
