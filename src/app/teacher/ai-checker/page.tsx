import { requireRole } from "@/lib/auth/session";
import { getI18n } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { subjectName } from "@/lib/i18n/format";
import { aiConfigured, aiModels } from "@/lib/ai/client";
import { PageHeader } from "@/components/ui/misc";
import { AiExamChecker } from "@/components/grading/ai-exam-checker";

export const dynamic = "force-dynamic";

export default async function TeacherAiCheckerPage() {
  const ctx = await requireRole("teacher");
  const { d, locale } = await getI18n();
  const supabase = await createClient();

  const [{ data: subjects }, { data: checks }] = await Promise.all([
    ctx.schoolId
      ? supabase.from("subjects").select("name_ru, name_kk").eq("school_id", ctx.schoolId).order("name_ru")
      : Promise.resolve({ data: [] }),
    supabase.from("ai_exam_checks").select("*").order("created_at", { ascending: false }).limit(25),
  ]);

  const subjectNames = Array.from(new Set((subjects ?? []).map((s) => subjectName(s, locale)).filter((s) => s && s !== "—")));
  const models = aiModels();

  return (
    <>
      <PageHeader title={d.aiChecker.title} description={d.aiChecker.subtitle} />
      <AiExamChecker
        aiReady={aiConfigured()}
        modelName={models.text}
        subjects={subjectNames}
        initialChecks={checks ?? []}
      />
    </>
  );
}
