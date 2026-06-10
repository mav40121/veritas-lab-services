// client/src/components/PendingStaffPortalBell.tsx
//
// 2026-06-09 Auth unification PR Option 1. Surfaces pending Staff
// Portal items (quizzes assigned to you, policies waiting for your
// signature, competencies awaiting acknowledgement) from EVERY page in
// the main app. No more "go to /staff-access to find out what's
// waiting" — the bell follows the user wherever they are.
//
// Behavior:
//   - Polls GET /api/me/pending-staff-portal-items every 60s + on
//     focus + when activeLabId changes.
//   - Hidden when there's nothing pending.
//   - Amber badge with the total count when pending > 0.
//   - Click → popover with three sections (Quizzes / Policies /
//     Competencies). Each row clicks through to /staff-access for the
//     specific item type so the existing take/sign flow runs.
//
// The bell doesn't host the take/sign modals inline yet. /staff-access
// is the focused experience for that. Inline modals are a v2 polish
// once we see real usage patterns.

import { useEffect, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { Bell } from "lucide-react";
import { useAuth } from "@/components/AuthContext";
import { authHeaders } from "@/lib/auth";
import { API_BASE } from "@/lib/queryClient";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";

interface PendingItems {
  quizzes: Array<{ assignment_id: number; quiz_id: number; title: string; due_date: string | null }>;
  policies: Array<{ document_id: number; title: string; effective_date: string | null }>;
  competencies: Array<{ assessment_id: number; program_name: string; assessment_date: string | null; assessment_type: string | null }>;
}

const POLL_INTERVAL_MS = 60 * 1000;

export function PendingStaffPortalBell() {
  const { isLoggedIn } = useAuth();
  const activeLabId = useActiveLabId();
  const [items, setItems] = useState<PendingItems | null>(null);
  const [, navigate] = useLocation();

  const fetchItems = useCallback(() => {
    if (!isLoggedIn) {
      setItems(null);
      return;
    }
    const url = activeLabId
      ? `${API_BASE}/api/me/pending-staff-portal-items?lab_id=${activeLabId}`
      : `${API_BASE}/api/me/pending-staff-portal-items`;
    fetch(url, { headers: authHeaders() })
      .then(async (r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) {
          setItems({ quizzes: [], policies: [], competencies: [] });
          return;
        }
        setItems({
          quizzes: data.quizzes || [],
          policies: data.policies || [],
          competencies: data.competencies || [],
        });
      })
      .catch(() => {
        // Network errors are quiet; the bell just hides itself.
        setItems({ quizzes: [], policies: [], competencies: [] });
      });
  }, [isLoggedIn, activeLabId]);

  useEffect(() => {
    fetchItems();
    if (!isLoggedIn) return;
    const interval = window.setInterval(fetchItems, POLL_INTERVAL_MS);
    const onFocus = () => fetchItems();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [fetchItems, isLoggedIn]);

  if (!isLoggedIn || !items) return null;
  const total = items.quizzes.length + items.policies.length + items.competencies.length;
  if (total === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="relative inline-flex items-center justify-center w-8 h-8 rounded-md hover:bg-muted"
          aria-label={`${total} pending item${total === 1 ? "" : "s"}`}
          data-testid="pending-staff-portal-bell"
        >
          <Bell size={15} className="text-amber-600" />
          <span
            className="absolute -top-1 -right-1 inline-flex items-center justify-center min-w-[1.1rem] h-[1.1rem] px-1 rounded-full text-[10px] font-bold bg-amber-500 text-white"
            data-testid="pending-staff-portal-bell-badge"
          >
            {total}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="text-xs">
          You have {total} pending item{total === 1 ? "" : "s"}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.quizzes.length > 0 && (
          <>
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Quizzes ({items.quizzes.length})
            </DropdownMenuLabel>
            {items.quizzes.slice(0, 5).map((q) => (
              <DropdownMenuItem
                key={q.assignment_id}
                onClick={() => navigate("/staff-access")}
                className="cursor-pointer flex-col items-start"
                data-testid={`pending-quiz-${q.assignment_id}`}
              >
                <div className="text-xs font-medium truncate w-full">{q.title}</div>
                {q.due_date && (
                  <div className="text-[10px] text-muted-foreground">Due {q.due_date}</div>
                )}
              </DropdownMenuItem>
            ))}
            {items.quizzes.length > 5 && (
              <div className="text-[10px] text-muted-foreground px-2 py-1">
                +{items.quizzes.length - 5} more
              </div>
            )}
          </>
        )}
        {items.policies.length > 0 && (
          <>
            {items.quizzes.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Policies ({items.policies.length})
            </DropdownMenuLabel>
            {items.policies.slice(0, 5).map((p) => (
              <DropdownMenuItem
                key={p.document_id}
                onClick={() => navigate("/staff-access")}
                className="cursor-pointer flex-col items-start"
                data-testid={`pending-policy-${p.document_id}`}
              >
                <div className="text-xs font-medium truncate w-full">{p.title}</div>
              </DropdownMenuItem>
            ))}
          </>
        )}
        {items.competencies.length > 0 && (
          <>
            {(items.quizzes.length > 0 || items.policies.length > 0) && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Competencies ({items.competencies.length})
            </DropdownMenuLabel>
            {items.competencies.slice(0, 5).map((c) => (
              <DropdownMenuItem
                key={c.assessment_id}
                onClick={() => navigate("/staff-access")}
                className="cursor-pointer flex-col items-start"
                data-testid={`pending-competency-${c.assessment_id}`}
              >
                <div className="text-xs font-medium truncate w-full">{c.program_name}</div>
                {c.assessment_date && (
                  <div className="text-[10px] text-muted-foreground">{c.assessment_date}</div>
                )}
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
