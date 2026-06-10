// client/src/components/VeritaPolicyTabs.tsx
//
// 2026-06-10: shared 3-tab nav for the VeritaPolicy module so the
// Master List (the example policies), My Policies (uploads), and
// Compliance views are mutually reachable from any of the three.
//
// Fixes the navigation dead-end where the VeritaPolicy nav defaulted to
// My Policies (the empty uploads page) and that page had no link back
// to the Master List, leaving the 59 example policies unreachable
// through the UI without hand-editing the URL.
//
// Lab-scoped only: when there is no active lab in the URL (legacy /
// marketing routes), the tab bar hides itself rather than emit
// /labs/undefined/... hrefs.

import { Link } from "wouter";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { ListChecks, FolderOpen, ShieldCheck } from "lucide-react";

type Tab = "master" | "my-policies" | "compliance";

const TABS: { key: Tab; label: string; sub: string; icon: typeof ListChecks }[] = [
  { key: "master",      label: "Master List", sub: "",            icon: ListChecks },
  { key: "my-policies", label: "My Policies", sub: "my-policies", icon: FolderOpen },
  { key: "compliance",  label: "Compliance",  sub: "compliance",  icon: ShieldCheck },
];

export function VeritaPolicyTabs({ active }: { active: Tab }) {
  const activeLabId = useActiveLabId();
  if (!activeLabId) return null;
  const base = `/labs/${activeLabId}/veritapolicy-app`;
  return (
    <div className="flex gap-1 border-b border-border" data-testid="veritapolicy-tabs">
      {TABS.map((t) => {
        const href = t.sub ? `${base}/${t.sub}` : base;
        const isActive = t.key === active;
        const Icon = t.icon;
        return (
          <Link key={t.key} href={href}>
            <a
              data-testid={`veritapolicy-tab-${t.key}`}
              className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                isActive
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon size={14} /> {t.label}
            </a>
          </Link>
        );
      })}
    </div>
  );
}
