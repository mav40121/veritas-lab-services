import { FlaskConical } from "lucide-react";
import { useAuth } from "./AuthContext";
import { useMemberships } from "@/hooks/useMemberships";
import { useActiveLabId } from "@/hooks/useActiveLabId";

// USON bake-off: a persistent, unmissable band shown whenever the active lab
// is flagged is_demo=1. It tells any viewer (a McKesson evaluator, a presenter,
// a prospect) that everything on screen is representative sample content, not a
// real facility and not real measurements. Mirrors SubscriptionBanner's active-
// lab resolution (URL lab id, else primary, else first membership) so it tracks
// the NavBar switcher. Copy carries no em dashes per the house style.
export function DemoLabBanner() {
  const { isLoggedIn } = useAuth();
  const activeLabId = useActiveLabId();
  const { data: memberships } = useMemberships();
  if (!isLoggedIn) return null;

  const activeMembership = activeLabId
    ? memberships?.find(m => m.labId === activeLabId)
    : (memberships?.find(m => m.isPrimaryLab) ?? memberships?.[0]);
  if (!activeMembership?.isDemo) return null;

  return (
    <div
      role="status"
      className="bg-teal-50 dark:bg-teal-950/50 border-b border-teal-300 dark:border-teal-800 px-4 py-2 text-center"
    >
      <div className="flex items-center justify-center gap-2 text-teal-900 dark:text-teal-100 text-sm font-medium">
        <FlaskConical size={15} className="shrink-0" />
        <span className="tracking-wide">
          REPRESENTATIVE SAMPLE DATA. NOT A REAL FACILITY OR ACTUAL LAB DATA.
        </span>
      </div>
    </div>
  );
}
