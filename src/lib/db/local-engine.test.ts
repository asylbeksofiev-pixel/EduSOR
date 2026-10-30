import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLocalAdminClient, createLocalServerClient } from "./local-engine";
import { resetSqliteDbForTests } from "./sqlite";

function createCookieJar() {
  const map = new Map<string, string>();
  return {
    getAll: () => Array.from(map.entries()).map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => {
      if (!value) map.delete(name);
      else map.set(name, value);
    },
  };
}

describe("Local SQLite engine & role-based registration RPCs", () => {
  beforeEach(() => {
    process.env.DATABASE_MODE = "local";
    process.env.EDUSOR_SQLITE_PATH = ":memory:";
    resetSqliteDbForTests();
  });

  afterEach(() => {
    resetSqliteDbForTests();
  });

  it("seeds demo accounts, classes with join_code, and resolves nested PostgREST joins", async () => {
    const admin = createLocalAdminClient();

    const { data: cls, error: clsErr } = await admin
      .from("classes")
      .select("id, name, join_code, schools(name, join_code)")
      .eq("join_code", "7AMATH")
      .maybeSingle();

    expect(clsErr).toBeNull();
    expect(cls).toBeTruthy();
    expect((cls as Record<string, unknown>).name).toBe("7А");
    const school = (cls as Record<string, unknown>).schools as Record<string, unknown>;
    expect(school.join_code).toBe("GYM1AST");

    const { data: assessments, error: assErr } = await admin
      .from("assessments")
      .select("id, title, type, status, classes!inner(name, join_code), subjects(name_ru)")
      .eq("status", "published");

    expect(assErr).toBeNull();
    expect(Array.isArray(assessments)).toBe(true);
    expect((assessments as unknown[]).length).toBeGreaterThanOrEqual(2);
  });

  it("signs up a student and enrolls into class + school via join_class_by_code", async () => {
    const jar = createCookieJar();
    const client = await createLocalServerClient(jar);

    const { data: signUpData, error: signUpErr } = await client.auth.signUp({
      email: "new.student@example.com",
      password: "Password123!",
      options: { data: { full_name: "Алия Серикова", locale: "ru" } },
    });

    expect(signUpErr).toBeNull();
    expect(signUpData.user?.id).toBeTruthy();

    const authed = await createLocalServerClient(jar);
    const { data: classId, error: rpcErr } = await authed.rpc("join_class_by_code", {
      p_join_code: "7AMATH",
    });

    expect(rpcErr).toBeNull();
    expect(typeof classId).toBe("string");

    const admin = createLocalAdminClient();
    const { data: enrollments } = await admin
      .from("class_enrollments")
      .select("class_id, student_id")
      .eq("student_id", signUpData.user!.id);

    expect(enrollments).toEqual([{ class_id: classId, student_id: signUpData.user!.id }]);

    const { data: memberships } = await admin
      .from("school_memberships")
      .select("role, status")
      .eq("user_id", signUpData.user!.id);

    expect(memberships).toEqual([{ role: "student", status: "active" }]);
  });

  it("signs up a school admin and provisions a new school via create_school_with_admin", async () => {
    const jar = createCookieJar();
    const client = await createLocalServerClient(jar);

    const { data: signUpData } = await client.auth.signUp({
      email: "director@lyceum42.kz",
      password: "Password123!",
      options: { data: { full_name: "Ержан Касымов", locale: "ru" } },
    });

    const authed = await createLocalServerClient(jar);
    const { data: schoolId, error: rpcErr } = await authed.rpc("create_school_with_admin", {
      p_name: "Лицей №42",
      p_city: "Алматы",
    });

    expect(rpcErr).toBeNull();
    expect(typeof schoolId).toBe("string");

    const admin = createLocalAdminClient();
    const { data: memberships } = await admin
      .from("school_memberships")
      .select("role, status")
      .eq("user_id", signUpData.user!.id)
      .eq("school_id", schoolId as string);

    const roles = (memberships as { role: string; status: string }[]).map((m) => m.role).sort();
    expect(roles).toEqual(["school_admin", "teacher"]);

    const { data: years } = await admin
      .from("academic_years")
      .select("name, is_current")
      .eq("school_id", schoolId as string);

    expect(years).toEqual([{ name: "2026–2027", is_current: true }]);
  });

  it("signs up a teacher and submits a school join request via request_teacher_access", async () => {
    const jar = createCookieJar();
    const client = await createLocalServerClient(jar);

    const { data: signUpData } = await client.auth.signUp({
      email: "new.teacher@example.com",
      password: "Password123!",
      options: { data: { full_name: "Динара Нурланова", locale: "ru" } },
    });

    const authed = await createLocalServerClient(jar);
    const { data: reqId, error: rpcErr } = await authed.rpc("request_teacher_access", {
      p_join_code: "GYM1AST",
      p_message: "Учитель математики",
    });

    expect(rpcErr).toBeNull();
    expect(typeof reqId).toBe("string");

    const admin = createLocalAdminClient();
    const { data: reqRow } = await admin
      .from("teacher_verification_requests")
      .select("user_id, status")
      .eq("id", reqId as string)
      .maybeSingle();

    expect(reqRow).toEqual({ user_id: signUpData.user!.id, status: "pending" });
  });

  it("persists and deserializes ai_exam_checks records for Gemini СОР/СОЧ checks", async () => {
    const jar = createCookieJar();
    const client = await createLocalServerClient(jar);

    const { data: loginData, error: loginErr } = await client.auth.signInWithPassword({
      email: "teacher@gym1.edusor.local",
      password: "EduSor-dev-2026",
    });
    expect(loginErr).toBeNull();
    expect(loginData.user?.email).toBe("teacher@gym1.edusor.local");

    const admin = createLocalAdminClient();
    const { data: schoolRow } = await admin
      .from("schools")
      .select("id")
      .eq("join_code", "GYM1AST")
      .single();

    const authed = await createLocalServerClient(jar);
    const tasksPayload = [
      {
        number: "1",
        promptSummary: "Линейное уравнение",
        studentAnswer: "x = 5",
        awardedPoints: 3,
        maxPoints: 3,
        descriptors: [{ title: "Находит корень", awarded: 3, max: 3, comment: "Верно" }],
        feedback: "Отлично",
        improvement: "",
        needsReview: false,
      },
    ];

    const { data: inserted, error: insErr } = await authed
      .from("ai_exam_checks")
      .insert({
        school_id: (schoolRow as { id: string }).id,
        teacher_id: loginData.user!.id,
        kind: "sor",
        title: "СОР №1 — Алгебра",
        student_name: "Айдар С.",
        subject: "Алгебра",
        grade: 7,
        source_text: "1) 2x = 10 => x = 5",
        total_score: 3,
        max_score: 3,
        percent: 100,
        mark: 5,
        summary: "Работа выполнена полностью верно.",
        feedback: "Молодец!",
        tasks: tasksPayload,
        model: "gemini-2.5-flash",
      })
      .select("*")
      .single();

    expect(insErr).toBeNull();
    expect((inserted as Record<string, unknown>).mark).toBe(5);
    expect(Array.isArray((inserted as Record<string, unknown>).tasks)).toBe(true);
  });
});
