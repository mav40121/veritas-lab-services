import type { ComponentType } from "react";
import { Link } from "wouter";
import { useIsStaffLogin } from "@/hooks/useStaffLogin";
import { useActiveLabId } from "@/hooks/useActiveLabId";

// #84 Phase 3 (2026-10-08): the Operations management views (VeritaQA PI
// program, VeritaPace productivity, VeritaShift staffing studies, VeritaOps
// cost studies) read account-wide owner data, and the server refuses them for
// Staff logins on purpose (server/seatAccess.ts blockNonOperatorSeat). Without
// this gate a Staff login reached the page and saw "Couldn't load your PI
// program. This is a load error", which reads like a broken account. Wrap the
// route component once; everyone else gets the page unchanged.
export function staffLoginGate<P extends object>(Page: ComponentType<P>, moduleName: string): ComponentType<P> {
  function StaffGated(props: P) {
    const isStaff = useIsStaffLogin();
    const labId = useActiveLabId();
    if (!isStaff) return <Page {...props} />;
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center" data-testid="staff-login-not-available">
        <h1 className="text-lg font-semibold mb-2">{moduleName} is a management view</h1>
        <p className="text-sm text-muted-foreground mb-6">
          It shows the lab's account-wide operations data, so it is available to the lab owner, admins and editors. Your QC, sign-offs and counts are on My work.
        </p>
        <Link href={labId ? `/labs/${labId}/dashboard` : "/dashboard"} className="inline-block rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
          Go to My work
        </Link>
      </div>
    );
  }
  StaffGated.displayName = `StaffGated(${moduleName})`;
  return StaffGated;
}
