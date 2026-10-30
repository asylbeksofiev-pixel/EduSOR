"use client";

import { useState, useRef } from "react";
import { AlertTriangle, CheckCircle2, FileText, Sparkles, Upload, Wand2, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { formatDateTime } from "@/lib/i18n/format";
import { RichText } from "@/components/content/rich-text";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, ProgressBar } from "@/components/ui/misc";
import { cn, formatPoints } from "@/lib/utils";
import type { Tables } from "@/lib/supabase/types";

type SavedCheck = Tables<"ai_exam_checks">;

type TaskItem = {
  number: string;
  promptSummary: string;
  studentAnswer: string;
  awardedPoints: number;
  maxPoints: number;
  descriptors: { title: string; awarded: number; max: number; comment: string }[];
  feedback: string;
  improvement?: string;
  needsReview?: boolean;
};

const SAMPLE_RUBRIC = `Задание 1 (2 балла). Упростите выражение: $(a^3)^2 \\cdot a^{-4}$ при $a = 3$.
Дескрипторы:
- применяет свойства степени с целым показателем (1 б.);
- вычисляет числовое значение выражения = 9 (1 б.).

Задание 2 (4 балла). Решите уравнение: $3(2x - 1) - 4 = 5x + 2$.
Дескрипторы:
- раскрывает скобки и приводит подобные слагаемые (2 б.);
- переносит слагаемые и находит корень $x = 9$ (2 б.).

Задание 3 (4 балла). Катер прошёл по течению реки 24 км за 2 часа, а против течения 16 км за 2 часа. Найдите собственную скорость катера и скорость течения.
Дескрипторы:
- составляет систему уравнений или находит скорости по/против течения: 12 км/ч и 8 км/ч (2 б.);
- находит собственную скорость катера (10 км/ч) и скорость течения (2 км/ч) (2 б.).`;

const SAMPLE_STUDENT_WORK = `1) (a^3)^2 * a^(-4) = a^6 * a^(-4) = a^2. При a = 3: 3^2 = 9. Ответ: 9.

2) 3(2x - 1) - 4 = 5x + 2
6x - 3 - 4 = 5x + 2
6x - 7 = 5x + 2
6x - 5x = 2 + 7
x = 9. Ответ: 9.

3) По течению: 24 : 2 = 12 км/ч.
Против течения: 16 : 2 = 8 км/ч.
Собственная скорость: (12 + 8) : 2 = 10 км/ч.
Скорость течения: 12 - 10 = 3 км/ч.
Ответ: 10 км/ч и 3 км/ч.`;

export function AiExamChecker({
  aiReady,
  modelName,
  subjects,
  initialChecks,
}: {
  aiReady: boolean;
  modelName: string;
  subjects: string[];
  initialChecks: SavedCheck[];
}) {
  const { d, locale } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);

  const [kind, setKind] = useState<"sor" | "soch">("sor");
  const [title, setTitle] = useState("");
  const [studentName, setStudentName] = useState("");
  const [subject, setSubject] = useState(subjects[0] ?? "");
  const [grade, setGrade] = useState("7");
  const [rubricText, setRubricText] = useState("");
  const [workText, setWorkText] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checks, setChecks] = useState<SavedCheck[]>(initialChecks);
  const [activeCheck, setActiveCheck] = useState<SavedCheck | null>(initialChecks[0] ?? null);

  const loadSample = () => {
    setKind("sor");
    setTitle("СОР №1 · Алгебра · Степень и линейные уравнения");
    setStudentName("Демо-ученик, 7А");
    setSubject(subjects[0] || "Алгебра");
    setGrade("7");
    setRubricText(SAMPLE_RUBRIC);
    setWorkText(SAMPLE_STUDENT_WORK);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!file && !workText.trim()) {
      setError(d.aiChecker.emptyWorkError);
      return;
    }
    setLoading(true);
    try {
      const fd = new FormData();
      fd.set("kind", kind);
      fd.set("title", title.trim() || `${d.assessment.kind[kind]} · ${subject || ""}`.trim());
      fd.set("studentName", studentName.trim());
      fd.set("subject", subject.trim());
      fd.set("grade", grade);
      fd.set("rubricText", rubricText);
      fd.set("workText", workText);
      if (file) fd.set("file", file);

      const res = await fetch("/api/ai/check-exam", { method: "POST", body: fd });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; detail?: string; check?: SavedCheck };
      if (!res.ok || !body.ok || !body.check) {
        if (body.error === "aiUnavailable") setError(d.grading.aiKeyMissingHint);
        else if (body.error === "fileTooLarge") setError(d.documents.fileTooLarge);
        else if (body.error === "fileType") setError(d.documents.fileType);
        else if (body.error === "emptyWork") setError(d.aiChecker.emptyWorkError);
        else setError(body.detail ? `${d.errors.aiFailed} (${body.detail})` : d.errors.aiFailed);
      } else {
        setChecks((prev) => [body.check!, ...prev]);
        setActiveCheck(body.check);
      }
    } catch {
      setError(d.errors.network);
    } finally {
      setLoading(false);
    }
  };

  const parsedTasks = Array.isArray(activeCheck?.tasks) ? (activeCheck.tasks as unknown as TaskItem[]) : [];

  return (
    <div className="flex flex-col gap-6">
      {!aiReady && (
        <Alert tone="warning" title={d.aiChecker.envBannerTitle}>
          <p>{d.aiChecker.envBannerText}</p>
          <code className="mt-2 inline-block rounded-lg border border-border bg-surface/80 px-2.5 py-1 font-mono text-xs text-foreground">
            GEMINI_API_KEY=ваш_ключ_google_ai_studio
          </code>
        </Alert>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.05fr_1fr]">
        <Card>
          <CardHeader
            title={d.aiChecker.newCheck}
            description={`Google Gemini · ${modelName}`}
            actions={
              <Button type="button" size="sm" variant="secondary" onClick={loadSample}>
                <Wand2 className="size-4" /> {d.aiChecker.loadSample}
              </Button>
            }
          />
          <CardBody>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {error && <Alert tone="danger">{error}</Alert>}

              <div className="grid gap-3 sm:grid-cols-3">
                <Field label={d.assessment.kindLabel} htmlFor="exam-kind">
                  <Select id="exam-kind" value={kind} onChange={(e) => setKind(e.target.value as "sor" | "soch")}>
                    <option value="sor">{d.assessment.kind.sor}</option>
                    <option value="soch">{d.assessment.kind.soch}</option>
                  </Select>
                </Field>
                <Field label={d.common.subject} htmlFor="exam-subject">
                  <Input
                    id="exam-subject"
                    list="subject-suggestions"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Алгебра"
                  />
                  <datalist id="subject-suggestions">
                    {subjects.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                </Field>
                <Field label={d.common.grade} htmlFor="exam-grade">
                  <Select id="exam-grade" value={grade} onChange={(e) => setGrade(e.target.value)}>
                    {Array.from({ length: 11 }, (_, i) => i + 1).map((g) => (
                      <option key={g} value={String(g)}>
                        {g}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={d.aiChecker.examTitle} htmlFor="exam-title">
                  <Input
                    id="exam-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={d.aiChecker.examTitlePlaceholder}
                  />
                </Field>
                <Field label={d.aiChecker.studentName} htmlFor="exam-student">
                  <Input
                    id="exam-student"
                    value={studentName}
                    onChange={(e) => setStudentName(e.target.value)}
                    placeholder={d.aiChecker.studentNamePlaceholder}
                  />
                </Field>
              </div>

              <Field label={d.aiChecker.rubricLabel} htmlFor="exam-rubric">
                <Textarea
                  id="exam-rubric"
                  rows={5}
                  value={rubricText}
                  onChange={(e) => setRubricText(e.target.value)}
                  placeholder={d.aiChecker.rubricPlaceholder}
                />
              </Field>

              <Field label={d.aiChecker.workFileLabel} hint={d.aiChecker.workFileHint}>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                {file ? (
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary-soft/50 px-4 py-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2 font-medium">
                      <FileText className="size-4 shrink-0 text-primary" />
                      <span className="truncate">{file.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">({(file.size / 1024 / 1024).toFixed(2)} MB)</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setFile(null);
                        if (fileRef.current) fileRef.current.value = "";
                      }}
                      className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label={d.common.remove}
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border-strong bg-muted/35 px-4 py-5 text-center text-sm text-muted-foreground transition hover:border-primary/50 hover:bg-primary-soft/30 hover:text-foreground"
                  >
                    <Upload className="size-5 text-primary" />
                    <span className="font-medium text-foreground">{d.documents.choose}</span>
                    <span className="text-xs">{d.aiChecker.workFileHint}</span>
                  </button>
                )}
              </Field>

              <Field label={d.aiChecker.workTextLabel} htmlFor="exam-work-text">
                <Textarea
                  id="exam-work-text"
                  rows={5}
                  value={workText}
                  onChange={(e) => setWorkText(e.target.value)}
                  placeholder={d.aiChecker.workTextPlaceholder}
                />
              </Field>

              <Button type="submit" size="lg" loading={loading}>
                <Sparkles className="size-4" />
                {loading ? d.aiChecker.checking : d.aiChecker.runCheck}
              </Button>
            </form>
          </CardBody>
        </Card>

        <div className="flex flex-col gap-6">
          {activeCheck ? (
            <Card>
              <CardHeader
                title={activeCheck.title}
                description={[
                  d.assessment.kind[activeCheck.kind],
                  activeCheck.subject,
                  activeCheck.grade ? `${activeCheck.grade} ${d.common.class.toLowerCase()}` : null,
                  activeCheck.student_name,
                  formatDateTime(activeCheck.created_at, locale),
                ]
                  .filter(Boolean)
                  .join(" · ")}
                actions={<Badge tone="primary">{activeCheck.model ?? modelName}</Badge>}
              />
              <CardBody className="flex flex-col gap-5">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-border bg-muted/40 p-3.5">
                    <p className="text-xs font-medium text-muted-foreground">{d.aiChecker.totalScore}</p>
                    <p className="mt-1 text-2xl font-bold tabular-nums">
                      {formatPoints(activeCheck.total_score)} / {formatPoints(activeCheck.max_score)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-border bg-muted/40 p-3.5">
                    <p className="text-xs font-medium text-muted-foreground">{d.common.percent}</p>
                    <p className="mt-1 text-2xl font-bold tabular-nums">{Math.round(Number(activeCheck.percent ?? 0))}%</p>
                    <ProgressBar value={Number(activeCheck.percent ?? 0)} className="mt-2" />
                  </div>
                  <div className="rounded-xl border border-primary/25 bg-primary-soft/50 p-3.5">
                    <p className="text-xs font-medium text-primary">{d.aiChecker.recommendedMark}</p>
                    <p className="mt-1 text-2xl font-bold tabular-nums text-primary">{activeCheck.mark ?? "—"}</p>
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-muted/30 p-4">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {d.aiChecker.teacherSummary}
                  </p>
                  <RichText text={activeCheck.summary} className="text-sm" />
                </div>

                <div className="rounded-xl border border-success/25 bg-success-soft/45 p-4">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-success">
                    {d.aiChecker.studentFeedback}
                  </p>
                  <RichText text={activeCheck.feedback} className="text-sm" />
                </div>

                <div>
                  <h3 className="mb-3 text-sm font-semibold">{d.aiChecker.tasksBreakdown}</h3>
                  <div className="flex flex-col gap-3">
                    {parsedTasks.map((task, idx) => {
                      const full = task.awardedPoints >= task.maxPoints;
                      const zero = task.awardedPoints <= 0;
                      return (
                        <div key={idx} className="rounded-xl border border-border bg-surface/60 p-4">
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <Badge tone={full ? "success" : zero ? "danger" : "warning"}>
                                #{task.number || idx + 1}
                              </Badge>
                              <span className="text-sm font-semibold">{task.promptSummary}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              {task.needsReview && (
                                <Badge tone="warning">
                                  <AlertTriangle className="size-3" /> {d.status.needs_review}
                                </Badge>
                              )}
                              <span className="text-sm font-bold tabular-nums">
                                {formatPoints(task.awardedPoints)} / {formatPoints(task.maxPoints)} {d.common.pointsShort}
                              </span>
                            </div>
                          </div>

                          {task.studentAnswer && (
                            <div className="mb-2.5 rounded-lg border border-border/70 bg-muted/35 p-2.5 text-xs">
                              <span className="font-semibold text-muted-foreground">{d.aiChecker.studentAnswerExtracted}: </span>
                              <RichText text={task.studentAnswer} className="mt-0.5 text-[13px]" />
                            </div>
                          )}

                          {task.descriptors?.length > 0 && (
                            <ul className="mb-2.5 flex flex-col gap-1.5">
                              {task.descriptors.map((desc, di) => (
                                <li key={di} className="flex items-start justify-between gap-3 rounded-lg bg-muted/25 px-3 py-2 text-xs">
                                  <div className="min-w-0">
                                    <p className="font-medium text-foreground">{desc.title}</p>
                                    {desc.comment && <p className="mt-0.5 text-muted-foreground">{desc.comment}</p>}
                                  </div>
                                  <span
                                    className={cn(
                                      "shrink-0 font-semibold tabular-nums",
                                      desc.awarded >= desc.max ? "text-success" : desc.awarded > 0 ? "text-warning" : "text-danger",
                                    )}
                                  >
                                    {formatPoints(desc.awarded)} / {formatPoints(desc.max)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}

                          {task.feedback && <RichText text={task.feedback} className="text-[13px] text-muted-foreground" />}
                          {task.improvement && (
                            <p className="mt-1.5 text-xs text-primary">
                              <span className="font-semibold">{d.aiChecker.improvements}: </span>
                              {task.improvement}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </CardBody>
            </Card>
          ) : (
            <Card>
              <CardHeader title={d.aiChecker.resultTitle} />
              <CardBody>
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">
                    <CheckCircle2 className="size-6" />
                  </div>
                  <p className="text-sm font-semibold">{d.aiChecker.noChecks}</p>
                  <p className="mt-1 max-w-md text-xs text-muted-foreground">{d.aiChecker.subtitle}</p>
                </div>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title={`${d.aiChecker.recentChecks} (${checks.length})`} />
            <CardBody className="p-0">
              {checks.length === 0 ? (
                <p className="px-5 py-6 text-sm text-muted-foreground">{d.aiChecker.noChecks}</p>
              ) : (
                <ul className="max-h-80 divide-y divide-border overflow-y-auto">
                  {checks.map((c) => {
                    const selected = activeCheck?.id === c.id;
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => setActiveCheck(c)}
                          className={cn(
                            "flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition",
                            selected ? "bg-primary-soft/50" : "hover:bg-muted/40",
                          )}
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {c.title} {c.student_name ? `· ${c.student_name}` : ""}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {d.assessment.kind[c.kind]} · {formatDateTime(c.created_at, locale)}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <span className="text-xs font-semibold tabular-nums">
                              {formatPoints(c.total_score)}/{formatPoints(c.max_score)}
                            </span>
                            {c.mark && <Badge tone="primary">{c.mark}</Badge>}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
