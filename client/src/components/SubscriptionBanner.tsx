import { useAuth } from "./AuthContext";
import { AlertTriangle, Lock, ArrowRight } from "lucide-react";

export function useAccessLevel() {
  const { user } = useAuth();
  if (!user) return 'free' as const;
  return (user.accessLevel || 'free') as 'full' | 'read_only' | 'locked' | 'free';
}

export function useIsReadOnly(module?: string): boolean {
  const { user } = useAuth();
  const level = useAccessLevel();
  const baseReadOnly = level === 'read_only' || level === 'locked';
  if (baseReadOnly) return true;

  // Seat user module check
  if (module && user?.isSeatUser && user?.seatPermissions) {
    const perm = user.seatPermissions[module] || 'view';
    return perm !== 'edit';
  }
  return false;
}

export function SubscriptionBanner() {
  const { user, isLoggedIn } = useAuth();
  if (!isLoggedIn || !user) return null;

  const accessLevel = user.accessLevel || 'free';
  if (accessLevel === 'full' || accessLevel === 'free') return null;

  if (accessLevel === 'read_only') {
    const expiresAt = user.subscriptionExpiresAt ? new Date(user.subscriptionExpiresAt) : null;
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
            href="/#/veritacheck"
            className="inline-flex items-center gap-1 font-semibold text-amber-900 dark:text-amber-100 hover:underline ml-1"
          >
            Resubscribe <ArrowRight size={13} />
          </a>
        </div>
      </div>
    );
  }

  if (accessLevel === 'locked') {
    const expiresAt = user.subscriptionExpiresAt ? new Date(user.subscriptionExpiresAt) : null;
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
            href="/#/veritacheck"
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
