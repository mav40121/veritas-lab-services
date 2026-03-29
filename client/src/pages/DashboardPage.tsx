import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Study } from "@shared/schema";
import { PlusCircle, FileText, Trash2, CheckCircle2, XCircle, FlaskConical } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useIsReadOnly } from "@/components/SubscriptionBanner";

export default function Dashboard() {
  const { toast } = useToast();
  const readOnly = useIsReadOnly();

  const { data: studies, isLoading } = useQuery<Study[]>({
    queryKey: ["/api/studies"],
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/studies/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/studies"] });
      toast({ title: "Study deleted" });
    },
    onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
  });

  const passCount = studies?.filter((s) => s.status === "pass").length ?? 0;
  const failCount = studies?.filter((s) => s.status === "fail").length ?? 0;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">Study Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            All saved studies
          </p>
        </div>
        {readOnly ? (
          <Button className="bg-primary hover:bg-primary/90 text-primary-foreground" disabled title="Resubscribe to add new records">
            <PlusCircle size={14} className="mr-1.5" />
            New Study
          </Button>
        ) : (
          <Button asChild className="bg-primary hover:bg-primary/90 text-primary-foreground">
            <Link href="/study/new">
              <PlusCircle size={14} className="mr-1.5" />
              New Study
            </Link>
          </Button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold">{studies?.length ?? 0}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Total Studies</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-green-400">{passCount}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Passing</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-red-400">{failCount}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Failing</div>
          </CardContent>
        </Card>
      </div>

      {/* Studies list */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : !studies?.length ? (
        <div className="text-center py-20 border-2 border-dashed border-border rounded-xl">
          <FlaskConical size={32} className="text-muted-foreground mx-auto mb-3" />
          <h3 className="font-semibold mb-1">No studies yet</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Run your first study to get started.
          </p>
          <Button asChild className="bg-primary hover:bg-primary/90 text-primary-foreground">
            <Link href="/study/new">Start a Study</Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {studies.map((study) => (
            <Card key={study.id} className="hover:border-primary/30 transition-colors group" data-testid={`card-study-${study.id}`}>
              <CardContent className="p-4 flex items-center gap-4">
                {/* Pass/Fail icon */}
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${study.status === "pass" ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
                  {study.status === "pass" ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
                </div>

                {/* Study info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm truncate">{study.testName}</span>
                    <Badge variant="outline" className="text-xs shrink-0">
                      {study.studyType === "cal_ver" ? "Cal Ver / Linearity" : study.studyType === "precision" ? "Precision (EP15)" : "Correlation / Method Comp"}
                    </Badge>
                    <span className={`text-xs font-semibold ${study.status === "pass" ? "pass-badge" : "fail-badge"}`}>
                      {study.status.toUpperCase()}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 flex gap-3 flex-wrap">
                    <span>{study.instrument}</span>
                    <span>·</span>
                    <span>{study.date}</span>
                    <span>·</span>
                    <span>Analyst: {study.analyst}</span>
                    <span>·</span>
                    <span>TEa: ±{(study.cliaAllowableError * 100).toFixed(1)}%</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
                  <Button asChild variant="outline" size="sm" data-testid={`button-view-${study.id}`}>
                    <Link href={`/study/${study.id}/results`}>
                      <FileText size={13} className="mr-1" />
                      View
                    </Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteMutation.mutate(study.id)}
                    className="text-muted-foreground hover:text-destructive h-8 w-8"
                    data-testid={`button-delete-${study.id}`}
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
