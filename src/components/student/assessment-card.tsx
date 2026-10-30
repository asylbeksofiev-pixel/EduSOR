import Link from "next/link";
import { Clock, CalendarClock } from "lucide-react";
import type { Dictionary, Locale } from "@/lib/i18n/config";
import { formatDateTime, subjectName } from "@/lib/i18n/format";
import { STATUS_TONE } from "@/lib/assessment/status";
import type { StudentAssessmentRow } from "@/lib/data/student";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fmt } from "@/lib/utils";

export function StudentAssessmentCard({ a, d, locale }: { a: StudentAssessmentRow; d: Dictionary; locale: Locale }) {
  const action =
    a.status === "in_progress" && a.latest
      ? { href: `/student/attempts/${a.latest.id}`, label: d.attempt.continue }
      : a.canStart
        ? { href: `/student/assessments/${a.id}/instructions`, label: d.attempt.start }
        : a.latest && a.status === "released"
          ? { href: `/student/results/${a.latest.id}`, label: d.results.title }
          : null;

  return (
    <div className="glass-card glass-card-interactive flex flex-col gap-3.5 rounded-2xl p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="primary">{d.assessment.kind[a.kind]}</Badge>
          <span className="text-xs font-medium text-muted-foreground">{subjectName(a.subject, locale)}</span>
          <Badge tone={STATUS_TONE[a.status]} className="sm:hidden">
            {d.status[a.status]}
          </Badge>
        </div>
        <p className="mt-1.5 truncate text-[15.5px] font-semibold tracking-tight text-foreground">{a.title}</p>
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <CalendarClock className="size-3.5 text-primary/80" />
            {a.status === "upcoming"
              ? fmt(d.student.opensAt, { date: formatDateTime(a.starts_at, locale) })
              : a.due_at
                ? fmt(d.student.deadline, { date: formatDateTime(a.due_at, locale) })
                : d.student.noDeadline}
          </span>
          {a.duration_minutes && (
            <span className="inline-flex items-center gap-1.5">
              <Clock className="size-3.5 text-primary/80" />
              {a.duration_minutes} {d.common.minutes}
            </span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
        <Badge tone={STATUS_TONE[a.status]} className="hidden sm:inline-flex">
          {d.status[a.status]}
        </Badge>
        {action && (
          <Button asChild size="sm" variant={a.status === "released" ? "secondary" : "primary"} className="w-full sm:w-auto">
            <Link href={action.href}>{action.label}</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
