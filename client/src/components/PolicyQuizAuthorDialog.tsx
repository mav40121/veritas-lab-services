// PR 2 of the policy attestation-quiz UI (MediaLab parity #39). Authoring dialog:
// the lab chooses gate-or-record + sets the pass threshold (no product default),
// and builds the question bank. Backend: GET/PUT .../documents/:id/quiz-config and
// GET/POST/DELETE .../documents/:id/quiz (PR 1 + the existing quiz CRUD).
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, getQueryFn, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Plus, Trash2, Check } from "lucide-react";

interface QuizConfig {
  quiz_requires_pass: boolean | null;
  quiz_pass_threshold: number | null;
}
interface QuizQuestion {
  id: number;
  question_text: string;
  choices?: string[];
  choices_json?: string;
  correct_index?: number;
  display_order?: number;
}

function normalizeChoices(q: QuizQuestion): string[] {
  if (Array.isArray(q.choices)) return q.choices;
  try {
    return JSON.parse(q.choices_json || "[]");
  } catch {
    return [];
  }
}

interface Props {
  labId: number | null;
  documentId: number | null;
  documentTitle?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PolicyQuizAuthorDialog({ labId, documentId, documentTitle, open, onOpenChange }: Props) {
  const { toast } = useToast();
  const base = `/api/labs/${labId}/veritapolicy/documents/${documentId}`;
  const ready = open && !!labId && !!documentId;

  const { data: config } = useQuery<QuizConfig>({
    queryKey: [`${base}/quiz-config`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: ready,
  });
  const { data: quizData } = useQuery<{ questions: QuizQuestion[] } | QuizQuestion[]>({
    queryKey: [`${base}/quiz`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: ready,
  });
  const questions: QuizQuestion[] = Array.isArray(quizData) ? quizData : quizData?.questions ?? [];

  // Gate config, seeded from the server. No product default: null until the lab chooses.
  const [gate, setGate] = useState<"require" | "record" | null>(null);
  const [threshold, setThreshold] = useState<string>("");
  useEffect(() => {
    if (config) {
      setGate(config.quiz_requires_pass == null ? null : config.quiz_requires_pass ? "require" : "record");
      setThreshold(config.quiz_pass_threshold != null ? String(config.quiz_pass_threshold) : "");
    }
  }, [config]);

  const saveConfig = useMutation({
    mutationFn: async () => {
      const requires = gate === "require";
      await apiRequest("PUT", `${base}/quiz-config`, {
        quiz_requires_pass: requires,
        quiz_pass_threshold: requires ? Number(threshold) : null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`${base}/quiz-config`] });
      toast({ title: "Quiz setting saved" });
    },
    onError: (e: any) => toast({ title: "Could not save", description: String(e?.message || e), variant: "destructive" }),
  });

  // Add-question form.
  const [qText, setQText] = useState("");
  const [choices, setChoices] = useState<string[]>(["", ""]);
  const [correct, setCorrect] = useState(0);

  const addQuestion = useMutation({
    mutationFn: async () => {
      const cleaned = choices.map((c) => c.trim()).filter(Boolean);
      await apiRequest("POST", `${base}/quiz`, {
        question_text: qText.trim(),
        choices: cleaned,
        correct_index: Math.min(correct, cleaned.length - 1),
        display_order: questions.length,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`${base}/quiz`] });
      setQText("");
      setChoices(["", ""]);
      setCorrect(0);
    },
    onError: (e: any) => toast({ title: "Could not add question", description: String(e?.message || e), variant: "destructive" }),
  });

  const deleteQuestion = useMutation({
    mutationFn: async (qid: number) => {
      await apiRequest("DELETE", `${base}/quiz/${qid}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`${base}/quiz`] }),
  });

  const canAdd = qText.trim().length > 0 && choices.filter((c) => c.trim()).length >= 2;
  const thresholdValid = gate !== "require" || (Number(threshold) >= 1 && Number(threshold) <= 100);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Comprehension quiz{documentTitle ? ` — ${documentTitle}` : ""}</DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
          <Label className="text-xs">How should this quiz count? Your lab decides.</Label>
          <button
            type="button"
            onClick={() => setGate("require")}
            className={`w-full text-left rounded-md border p-3 ${gate === "require" ? "border-primary ring-1 ring-primary bg-primary/5" : "border-input"}`}
          >
            <div className="text-sm font-medium">Require a passing score to complete the attestation</div>
            <div className="text-xs text-muted-foreground">The tech cannot sign off the policy until they pass.</div>
            {gate === "require" && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs">Passing threshold you set</span>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                  className="w-20 h-8"
                />
                <span className="text-xs">%</span>
                <span className="text-xs text-muted-foreground">no default; your lab decides</span>
              </div>
            )}
          </button>
          <button
            type="button"
            onClick={() => setGate("record")}
            className={`w-full text-left rounded-md border p-3 ${gate === "record" ? "border-primary ring-1 ring-primary bg-primary/5" : "border-input"}`}
          >
            <div className="text-sm font-medium">Record the score only</div>
            <div className="text-xs text-muted-foreground">The score is saved to the record; it never blocks completion.</div>
          </button>
          <div className="flex justify-end">
            <Button size="sm" onClick={() => saveConfig.mutate()} disabled={gate === null || !thresholdValid || saveConfig.isPending}>
              {saveConfig.isPending && <Loader2 className="animate-spin mr-1" size={14} />}
              Save setting
            </Button>
          </div>
        </div>

        <div className="border-t my-2" />

        <div className="space-y-3">
          <Label className="text-xs">Questions</Label>
          {questions.length === 0 && <div className="text-xs text-muted-foreground">No questions yet.</div>}
          {questions.map((q, i) => {
            const ch = normalizeChoices(q);
            return (
              <div key={q.id} className="rounded-md border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-medium">
                    {i + 1}. {q.question_text}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red-600"
                    onClick={() => deleteQuestion.mutate(q.id)}
                    disabled={deleteQuestion.isPending}
                    title="Delete question"
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
                <ul className="mt-1 space-y-1 text-xs">
                  {ch.map((c, ci) => (
                    <li
                      key={ci}
                      className={`flex items-center gap-1 ${q.correct_index === ci ? "text-green-700 font-medium" : "text-muted-foreground"}`}
                    >
                      {q.correct_index === ci ? <Check size={12} /> : <span className="inline-block w-3" />} {c}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}

          <div className="rounded-md border border-dashed p-3 space-y-2">
            <Label className="text-xs">Add a question</Label>
            <Textarea value={qText} onChange={(e) => setQText(e.target.value)} rows={2} placeholder="Question text" />
            <div className="space-y-1">
              {choices.map((c, ci) => (
                <div key={ci} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="quiz-correct-choice"
                    checked={correct === ci}
                    onChange={() => setCorrect(ci)}
                    title="Mark as the correct answer"
                  />
                  <Input
                    value={c}
                    onChange={(e) => setChoices(choices.map((x, xi) => (xi === ci ? e.target.value : x)))}
                    placeholder={`Choice ${ci + 1}`}
                    className="h-8"
                  />
                  {choices.length > 2 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setChoices(choices.filter((_, xi) => xi !== ci));
                        if (correct >= ci && correct > 0) setCorrect(correct - 1);
                      }}
                      title="Remove choice"
                    >
                      <Trash2 size={14} />
                    </Button>
                  )}
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between">
              <Button size="sm" variant="outline" onClick={() => setChoices([...choices, ""])} disabled={choices.length >= 6}>
                <Plus size={14} className="mr-1" /> Choice
              </Button>
              <Button size="sm" onClick={() => addQuestion.mutate()} disabled={!canAdd || addQuestion.isPending}>
                {addQuestion.isPending && <Loader2 className="animate-spin mr-1" size={14} />}
                Add question
              </Button>
            </div>
            <div className="text-xs text-muted-foreground">Mark the correct answer with the radio on its left. Two or more choices required.</div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
