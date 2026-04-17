import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/components/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Users, Plus, Trash2, LogOut, Mail, CheckCircle, Clock, XCircle, ArrowUpCircle, ChevronDown, ChevronUp, RefreshCw, Loader2 } from "lucide-react";
import { authHeaders } from "@/lib/auth";
import { ConfirmDialog } from "@/components/ConfirmDialog";

interface SeatActivity {
  lastLogin: string | null;
  sessionCount: number;
  studyCount: number;
  recentActions: {
    module: string;
    action: string;
    entityType: string;
    entityLabel: string;
    createdAt: string;
  }[];
}

interface Seat {
  id: number;
  owner_user_id: number;
  seat_email: string;
  seat_user_id: number | null;
  invited_at: string;
  accepted_at: string | null;
  status: string;
}

const STATUS_ICONS: Record<string, any> = {
  active: <CheckCircle size={14} className="text-emerald-600" />,
  pending: <Clock size={14} className="text-amber-600" />,
  deactivated: <XCircle size={14} className="text-red-500" />,
};

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  pending: "Pending Invite",
  deactivated: "Deactivated",
};

export default function SeatManagementPage() {
  const { user, isLoggedIn } = useAuth();
  const { toast } = useToast();
  const [seats, setSeats] = useState<Seat[]>([]);
  const [seatCount, setSeatCount] = useState(1);
  const [newEmail, setNewEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [upgradePrompt, setUpgradePrompt] = useState<{ limit: number; current: number; plan: string; nextTier: { label: string; price: number; seats: number; plan: string } | null } | null>(null);
  const [expandedSeatId, setExpandedSeatId] = useState<number | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const activityCache = useRef<Record<number, SeatActivity>>({});

  const fetchSeats = useCallback(async () => {
    try {
      const res = await fetch("/api/account/seats", { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setSeats(data.seats || []);
        setSeatCount(data.seat_count || 1);
      }
    } catch {}
  }, []);

  useEffect(() => { if (isLoggedIn) fetchSeats(); }, [isLoggedIn, fetchSeats]);

  async function fetchActivity(seatId: number, forceRefresh = false) {
    if (!forceRefresh && activityCache.current[seatId]) return;
    setActivityLoading(true);
    try {
      const res = await fetch(`/api/account/seats/${seatId}/activity`, { headers: authHeaders() });
      if (res.ok) {
        const data: SeatActivity = await res.json();
        activityCache.current[seatId] = data;
      }
    } catch {} finally {
      setActivityLoading(false);
    }
  }

  function toggleActivity(seatId: number) {
    if (expandedSeatId === seatId) {
      setExpandedSeatId(null);
    } else {
      setExpandedSeatId(seatId);
      fetchActivity(seatId);
    }
  }

  function formatRelativeTime(dateStr: string | null): string {
    if (!dateStr) return "Never";
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }

  async function handleAddSeat(e: React.FormEvent) {
    e.preventDefault();
    if (!newEmail.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/account/seats", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail.trim() }),
      });
      const data = await res.json();
      if (res.status === 402 && data.error === "seat_limit_reached") {
        setUpgradePrompt(data);
        setShowAddForm(false);
        return;
      }
      if (!res.ok) {
        toast({ title: data.error || "Failed to add seat", variant: "destructive" });
        return;
      }
      toast({ title: "Seat invitation sent" });
      setNewEmail("");
      setShowAddForm(false);
      fetchSeats();
    } catch {
      toast({ title: "Failed to add seat", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function handleDeactivateSeat(seatId: number) {
    try {
      const res = await fetch(`/api/account/seats/${seatId}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (res.ok) {
        toast({ title: "Seat deactivated" });
        fetchSeats();
      }
    } catch {
      toast({ title: "Failed to deactivate seat", variant: "destructive" });
    }
  }

  async function handleForceLogout(seatId: number) {
    try {
      const res = await fetch(`/api/account/seats/${seatId}/force-logout`, {
        method: "POST",
        headers: authHeaders(),
      });
      if (res.ok) {
        toast({ title: "User logged out" });
      }
    } catch {
      toast({ title: "Failed to force logout", variant: "destructive" });
    }
  }

  if (!isLoggedIn) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <p className="text-muted-foreground">Please sign in to manage your seats.</p>
      </div>
    );
  }

  const activeSeats = seats.filter(s => s.status !== "deactivated");
  const usedSeats = activeSeats.length + 1; // +1 for owner

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Users size={20} className="text-primary" />
        </div>
        <div>
          <h1 className="font-serif text-xl font-bold">Seat Management</h1>
          <p className="text-sm text-muted-foreground">{usedSeats} of {seatCount} seats used</p>
        </div>
      </div>

      {/* Owner seat */}
      <Card className="mb-4">
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CheckCircle size={16} className="text-emerald-600" />
              <div>
                <p className="text-sm font-medium">{user?.email} <span className="text-xs text-muted-foreground ml-1">(Account Owner)</span></p>
                <p className="text-xs text-muted-foreground">{user?.name}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Assigned seats */}
      {seats.map(seat => {
        const canExpand = seat.status === "active" && seat.seat_user_id !== null;
        const isExpanded = expandedSeatId === seat.id;
        const activity = activityCache.current[seat.id];

        return (
        <Card key={seat.id} className="mb-3">
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {canExpand && (
                  <button onClick={() => toggleActivity(seat.id)} className="text-muted-foreground hover:text-foreground -ml-1">
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                )}
                {STATUS_ICONS[seat.status] || <Clock size={14} />}
                <div>
                  <p className="text-sm font-medium">{seat.seat_email}</p>
                  <p className="text-xs text-muted-foreground">
                    {STATUS_LABELS[seat.status] || seat.status}
                    {seat.invited_at && ` - Invited ${new Date(seat.invited_at).toLocaleDateString()}`}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                {seat.status === "active" && seat.seat_user_id && (
                  <Button size="sm" variant="ghost" onClick={() => handleForceLogout(seat.id)} title="Force logout">
                    <LogOut size={14} />
                  </Button>
                )}
                {seat.status !== "deactivated" && (
                  <ConfirmDialog
                    title="Deactivate Seat?"
                    message="Deactivate this seat? The user will lose access immediately."
                    confirmLabel="Deactivate"
                    onConfirm={() => handleDeactivateSeat(seat.id)}
                  >
                    <Button size="sm" variant="ghost" title="Deactivate seat">
                      <Trash2 size={14} className="text-destructive" />
                    </Button>
                  </ConfirmDialog>
                )}
              </div>
            </div>

            {/* Expandable activity panel */}
            {isExpanded && (
              <div className="mt-4 pt-3 border-t">
                {activityLoading && !activity ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                    <Loader2 size={14} className="animate-spin" /> Loading activity...
                  </div>
                ) : activity ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex gap-6 text-xs">
                        <div><span className="text-muted-foreground">Last seen:</span> <span className="font-medium">{formatRelativeTime(activity.lastLogin)}</span></div>
                        <div><span className="text-muted-foreground">Sessions:</span> <span className="font-medium">{activity.sessionCount}</span></div>
                        <div><span className="text-muted-foreground">Studies run:</span> <span className="font-medium">{activity.studyCount}</span></div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => fetchActivity(seat.id, true)}
                        title="Refresh activity"
                        className="h-6 w-6 p-0"
                      >
                        <RefreshCw size={12} />
                      </Button>
                    </div>

                    {activity.sessionCount === 0 && activity.studyCount === 0 && activity.recentActions.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No activity recorded</p>
                    ) : activity.recentActions.length > 0 ? (
                      <div>
                        <p className="text-xs font-medium mb-1.5">Recent activity</p>
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-muted-foreground border-b">
                              <th className="text-left pb-1 font-medium">Date</th>
                              <th className="text-left pb-1 font-medium">Module</th>
                              <th className="text-left pb-1 font-medium">Action</th>
                              <th className="text-left pb-1 font-medium">Item</th>
                            </tr>
                          </thead>
                          <tbody>
                            {activity.recentActions.map((a, i) => (
                              <tr key={i} className="border-b last:border-0">
                                <td className="py-1 pr-3 text-muted-foreground whitespace-nowrap">{new Date(a.createdAt).toLocaleDateString()}</td>
                                <td className="py-1 pr-3 capitalize">{a.module}</td>
                                <td className="py-1 pr-3 capitalize">{a.action}</td>
                                <td className="py-1 truncate max-w-[180px]">{a.entityLabel || a.entityType}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>
        );
      })}

      {/* Upgrade prompt (shown when seat limit is hit) */}
      {upgradePrompt && (
        <div className="mt-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <ArrowUpCircle size={20} className="text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium text-sm text-amber-900 dark:text-amber-200">
                You have reached your {upgradePrompt.limit}-seat limit on the {upgradePrompt.plan.charAt(0).toUpperCase() + upgradePrompt.plan.slice(1)} plan.
              </p>
              {upgradePrompt.nextTier && (
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                  Upgrade to {upgradePrompt.nextTier.label} (${upgradePrompt.nextTier.price}/mo) to get {upgradePrompt.nextTier.seats} seats.
                </p>
              )}
              <div className="flex gap-2 mt-3">
                {upgradePrompt.nextTier && (
                  <a href="/account/settings" className="inline-flex items-center gap-1 text-xs bg-primary text-primary-foreground rounded px-3 py-1.5 hover:bg-primary/90">
                    <ArrowUpCircle size={12} /> Upgrade Plan
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setUpgradePrompt(null)}
                  className="text-xs text-muted-foreground hover:underline"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add seat */}
      {!upgradePrompt && (usedSeats < seatCount ? (
        showAddForm ? (
          <Card className="mt-4">
            <CardContent className="py-4">
              <form onSubmit={handleAddSeat} className="flex gap-2">
                <Input
                  type="email"
                  value={newEmail}
                  onChange={e => setNewEmail(e.target.value)}
                  placeholder="colleague@lab.com"
                  required
                  className="flex-1"
                />
                <Button type="submit" disabled={loading} size="sm">
                  <Mail size={14} className="mr-1.5" />
                  {loading ? "Sending..." : "Send Invite"}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowAddForm(false)}>Cancel</Button>
              </form>
            </CardContent>
          </Card>
        ) : (
          <Button variant="outline" className="mt-4" onClick={() => setShowAddForm(true)}>
            <Plus size={14} className="mr-1.5" /> Add Seat
          </Button>
        )
      ) : (
        <div className="mt-4">
          <Button variant="outline" className="w-full" onClick={() => setShowAddForm(true)}>
            <Plus size={14} className="mr-1.5" /> Add Seat
          </Button>
        </div>
      ))}

      {/* Seat pricing info */}
      <div className="mt-8 text-xs text-muted-foreground space-y-1">
        <p className="font-medium text-foreground text-sm mb-2">Seat Pricing</p>
        <p>Additional seats: $199/seat for seats 2-5. $179/seat for seats 2-10 (if 6-10 total). $159/seat for seats 2-25 (if 11-25 total). $139/seat for seats 2+ (if 26+ total).</p>
      </div>
    </div>
  );
}
