// client/src/pages/VeritaCompQuizScoresPage.tsx
//
// "Quiz scores" (Michael 2026-11-17, Q347 = 1: "it is difficult to find peoples quiz scores"). Every scored quiz in the lab
// in one list, with filters and Download Excel (client/src/components/QuizScoresList.tsx). Linked from VeritaComp's roster
// header beside Signed competencies; a Staff login reaches "My quiz scores" from their own VeritaComp screen and sees only
// their own. Read-only. GET /api/labs/:labId/competency/quiz-scores
import { Link } from "wouter";
import { ChevronLeft } from "lucide-react";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { useStaffOwnScope } from "@/hooks/useStaffLogin";
import { QuizScoresList } from "@/components/QuizScoresList";

export default function VeritaCompQuizScoresPage() {
  const activeLabId = useActiveLabId();
  const { ownOnly } = useStaffOwnScope();
  const labRoute = (p: string) => (activeLabId ? `/labs/${activeLabId}${p}` : p);
  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-5">
      <Link href={labRoute("/veritacomp-app")} className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1">
        <ChevronLeft size={14} /> VeritaComp&trade;
      </Link>
      <div>
        <h1 className="text-2xl font-bold" data-testid="quiz-scores-title">{ownOnly ? "My quiz scores" : "Quiz scores"}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {ownOnly ? "Your" : "Every"} scored competency quiz{ownOnly ? "" : " in this lab"}, newest first: assigned quizzes taken on a staff login, quizzes given on a record, and scores entered on Element 6. A VeritaComp quiz passes at 100%.
        </p>
      </div>
      {activeLabId ? <QuizScoresList labId={Number(activeLabId)} /> : <div className="text-sm text-muted-foreground">Open a lab first.</div>}
    </div>
  );
}
