import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiConfigured, aiModels } from "@/lib/ai/client";
import { extractDocx, extractPdf, renderPdfPage, toDataUrl } from "@/lib/ai/extract";
import { checkExamPaperWithGemini } from "@/lib/ai/tasks";
import { markFromPercent } from "@/lib/assessment/grading";
import { isLocale } from "@/lib/i18n/config";
import { rateLimit } from "@/lib/server/rate-limit";
import { audit } from "@/lib/server/audit";
import type { Json } from "@/lib/supabase/database.types";

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function GET() {
  const ctx = await getSessionContext();
  if (!ctx || (!ctx.roles.includes("teacher") && !ctx.roles.includes("school_admin") && !ctx.roles.includes("super_admin"))) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const supabase = await createClient();
  const { data: checks } = await supabase
    .from("ai_exam_checks")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(20);

  return NextResponse.json({
    ok: true,
    configured: aiConfigured(),
    models: aiModels(),
    checks: checks ?? [],
  });
}

export async function POST(request: Request) {
  const ctx = await getSessionContext();
  if (!ctx || (!ctx.roles.includes("teacher") && !ctx.roles.includes("school_admin") && !ctx.roles.includes("super_admin"))) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  if (!(await rateLimit(`ai-exam:${ctx.userId}`, 25, 600))) {
    return NextResponse.json({ ok: false, error: "rateLimited" }, { status: 429 });
  }

  if (!aiConfigured()) {
    return NextResponse.json({ ok: false, error: "aiUnavailable" }, { status: 503 });
  }

  const membership = ctx.memberships.find((m) => m.role === "teacher" || m.role === "school_admin") ?? ctx.memberships[0];
  let schoolId = membership?.school_id ?? null;
  if (!schoolId && ctx.roles.includes("super_admin")) {
    const admin = createAdminClient();
    const { data: firstSchool } = await admin.from("schools").select("id").limit(1).maybeSingle();
    schoolId = firstSchool?.id ?? null;
  }
  if (!schoolId) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  let kind: "sor" | "soch" = "sor";
  let title = "";
  let studentName = "";
  let subject = "";
  let grade: number | null = null;
  let rubricText = "";
  let workText = "";
  let file: File | null = null;

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const rawKind = String(form.get("kind") ?? "sor");
    kind = rawKind === "soch" ? "soch" : "sor";
    title = String(form.get("title") ?? "").trim().slice(0, 240);
    studentName = String(form.get("studentName") ?? "").trim().slice(0, 200);
    subject = String(form.get("subject") ?? "").trim().slice(0, 120);
    const g = Number(form.get("grade") ?? "");
    grade = Number.isInteger(g) && g >= 1 && g <= 12 ? g : null;
    rubricText = String(form.get("rubricText") ?? "").trim().slice(0, 16000);
    workText = String(form.get("workText") ?? "").trim().slice(0, 24000);
    const f = form.get("file");
    if (f instanceof File && f.size > 0) file = f;
  } else {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    kind = body.kind === "soch" ? "soch" : "sor";
    title = String(body.title ?? "").trim().slice(0, 240);
    studentName = String(body.studentName ?? "").trim().slice(0, 200);
    subject = String(body.subject ?? "").trim().slice(0, 120);
    const g = Number(body.grade ?? "");
    grade = Number.isInteger(g) && g >= 1 && g <= 12 ? g : null;
    rubricText = String(body.rubricText ?? "").trim().slice(0, 16000);
    workText = String(body.workText ?? "").trim().slice(0, 24000);
  }

  const imageDataUrls: string[] = [];
  const extractedChunks: string[] = [];
  if (workText) extractedChunks.push(workText);

  if (file) {
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ ok: false, error: "fileTooLarge" }, { status: 400 });
    }
    const mime = file.type || (file.name.toLowerCase().endsWith(".docx") ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "");
    if (!ALLOWED_MIME.has(mime)) {
      return NextResponse.json({ ok: false, error: "fileType" }, { status: 400 });
    }
    const buf = new Uint8Array(await file.arrayBuffer());
    if (mime.startsWith("image/")) {
      imageDataUrls.push(toDataUrl(buf, mime));
    } else if (mime === "application/pdf") {
      try {
        const pdf = await extractPdf(buf);
        for (const p of pdf.pages) {
          extractedChunks.push(`[Стр. ${p.page}]\n${p.text}`);
        }
        for (const pageNo of pdf.scanned.slice(0, 5)) {
          try {
            imageDataUrls.push(await renderPdfPage(buf, pageNo));
          } catch {
            // Canvas rendering is optional if native bindings aren't available.
          }
        }
      } catch {
        return NextResponse.json({ ok: false, error: "uploadFailed" }, { status: 400 });
      }
    } else {
      try {
        const doc = await extractDocx(buf);
        for (const p of doc.pages) {
          if (p.text) extractedChunks.push(p.text);
        }
      } catch {
        return NextResponse.json({ ok: false, error: "uploadFailed" }, { status: 400 });
      }
    }
  }

  const combinedWorkText = extractedChunks.join("\n\n").trim();
  if (!combinedWorkText && imageDataUrls.length === 0) {
    return NextResponse.json({ ok: false, error: "emptyWork" }, { status: 400 });
  }

  const locale = isLocale(ctx.profile.locale) ? ctx.profile.locale : "ru";
  const effectiveTitle = title || (kind === "soch" ? "СОЧ" : "СОР");

  // Privacy rule: studentName is NEVER passed to the external AI provider.
  const aiRes = await checkExamPaperWithGemini(
    {
      kind,
      title: effectiveTitle,
      subject: subject || null,
      grade,
      rubricText: rubricText || null,
      workText: combinedWorkText || null,
      imageDataUrls,
      locale,
    },
    { userId: ctx.userId, schoolId },
  );

  if (!aiRes.ok) {
    return NextResponse.json(
      { ok: false, error: aiRes.error === "unavailable" ? "aiUnavailable" : "aiFailed", detail: aiRes.detail },
      { status: aiRes.error === "unavailable" ? 503 : 502 },
    );
  }

  // Clamp and normalize all task & descriptor scores server-side.
  const normalizedTasks = aiRes.data.tasks.map((task) => {
    const descriptors = task.descriptors.map((desc) => {
      const max = round2(Math.max(0.5, desc.max));
      const awarded = round2(Math.min(max, Math.max(0, desc.awarded)));
      return { ...desc, max, awarded };
    });
    const maxPoints = descriptors.length
      ? round2(descriptors.reduce((s, d) => s + d.max, 0))
      : round2(Math.max(1, task.maxPoints));
    const rawAwarded = descriptors.length
      ? descriptors.reduce((s, d) => s + d.awarded, 0)
      : task.awardedPoints;
    const awardedPoints = round2(Math.min(maxPoints, Math.max(0, rawAwarded)));
    return { ...task, maxPoints, awardedPoints, descriptors };
  });

  const maxScore = round2(normalizedTasks.reduce((s, t) => s + t.maxPoints, 0)) || round2(Math.max(1, aiRes.data.maxScore));
  const totalScore = round2(Math.min(maxScore, normalizedTasks.reduce((s, t) => s + t.awardedPoints, 0)));
  const percent = round2((totalScore / maxScore) * 100);
  const mark = markFromPercent(percent);

  const admin = createAdminClient();
  const { data: saved, error: dbErr } = await admin
    .from("ai_exam_checks")
    .insert({
      school_id: schoolId,
      teacher_id: ctx.userId,
      kind,
      title: effectiveTitle,
      student_name: studentName || null,
      subject: subject || null,
      grade,
      rubric_text: rubricText || null,
      source_text: (aiRes.data.extractedStudentText || combinedWorkText || file?.name || "").slice(0, 30000),
      summary: aiRes.data.summaryForTeacher,
      feedback: aiRes.data.feedbackForStudent,
      tasks: normalizedTasks as unknown as NonNullable<Json>,
      total_score: totalScore,
      max_score: maxScore,
      percent,
      mark,
      model: aiRes.model,
    })
    .select("*")
    .single();

  if (dbErr) {
    return NextResponse.json({ ok: false, error: "generic" }, { status: 500 });
  }

  await audit({
    actorId: ctx.userId,
    schoolId,
    action: "ai.exam_checked",
    entityType: "ai_exam_check",
    entityId: saved.id,
    metadata: { kind, totalScore, maxScore, percent, mark, model: aiRes.model },
  });

  return NextResponse.json({ ok: true, check: saved });
}
