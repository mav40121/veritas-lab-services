// PermissionTooltip
//
// Wave J PR J2 (2026-06-06). Shared wrapper for disabled buttons that
// reveals WHY they're disabled when the user hovers. Centralizes the
// permission rationale so the copy stays consistent across surfaces
// and one update changes every tooltip.
//
// When `disabled` is false (or no `reason` provided), the wrapper is a
// no-op: children render as-is. When disabled, the children are wrapped
// in a Radix tooltip that surfaces the reason on hover. Hover targets a
// span around the disabled button because disabled buttons swallow
// pointer events.
//
// Common reasons (use the exported PERMISSION_REASONS constant for
// consistency):
//   - "Resubscribe to add new records" (subscription downgrade)
//   - "Requires write access" (view-only seat)
//   - "Owner or admin only" (role-gated action)
//   - "Locked: Sign and Complete already saved this assessment"

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export const PERMISSION_REASONS = {
  resubscribe: "Resubscribe to add new records",
  writeAccess: "Requires write access (your seat is view-only)",
  ownerOrAdmin: "Owner or admin only",
  locked: "Locked: Sign and Complete already saved this assessment",
} as const;

interface Props {
  /** When false, children render unwrapped. */
  disabled: boolean;
  /** Tooltip body. Empty string suppresses the tooltip even when disabled. */
  reason: string;
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}

export function PermissionTooltip({ disabled, reason, children, side = "top" }: Props) {
  if (!disabled || !reason) return <>{children}</>;
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* span wrapper because disabled buttons don't fire pointer
              events; the tooltip needs a real interactive target. */}
          <span className="inline-block">{children}</span>
        </TooltipTrigger>
        <TooltipContent side={side} className="max-w-xs text-xs">
          {reason}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
