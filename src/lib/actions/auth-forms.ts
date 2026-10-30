"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";
import { serverEnv, isSupabaseBackend } from "@/lib/env.server";
import { forgotSchema, loginSchema, registerSchema, resetSchema, fieldErrors, LOGIN_RE } from "@/lib/validation/auth";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { audit } from "@/lib/server/audit";
import { fail, type ActionResult } from "./result";

function safeNext(next: string | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/app";
}

export async function loginAction(input: unknown): Promise<ActionResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return fail("validation", fieldErrors(parsed.error));
  const { identifier, password, next } = parsed.data;

  const ip = await clientIp();
  if (!(await rateLimit(`login:${ip}`, 20, 300)) || !(await rateLimit(`login:${identifier.toLowerCase()}`, 10, 300))) {
    return fail("rateLimited");
  }

  const lower = identifier.toLowerCase();
  let email = lower;
  if (!lower.includes("@")) {
    if (!LOGIN_RE.test(lower)) return fail("invalidCredentials");
    email = `${lower}@${serverEnv().STUDENT_LOGIN_EMAIL_DOMAIN}`;
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.code === "email_not_confirmed") return fail("emailNotConfirmed");
    return fail("invalidCredentials");
  }
  redirect(safeNext(next));
}

const DEMO_ACCOUNTS = {
  teacher: { email: "teacher@gym1.edusor.local", password: "EduSor-dev-2026" },
  student: { email: "aidar.s@students.edusor.local", password: "EduSor-dev-2026" },
  admin: { email: "admin@gym1.edusor.local", password: "EduSor-dev-2026" },
  super: { email: "superadmin@edusor.local", password: "EduSor-dev-2026" },
} as const;

export async function quickDemoLoginAction(role: keyof typeof DEMO_ACCOUNTS): Promise<ActionResult> {
  if (isSupabaseBackend() && process.env.NODE_ENV === "production") {
    return fail("forbidden");
  }
  const creds = DEMO_ACCOUNTS[role];
  if (!creds) return fail("invalidCredentials");
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: role === "student" ? `aidar.s@${serverEnv().STUDENT_LOGIN_EMAIL_DOMAIN}` : creds.email,
    password: creds.password,
  });
  if (error) return fail("invalidCredentials");
  redirect("/app");
}

export async function registerAction(input: unknown, locale: string): Promise<ActionResult<{ needsConfirmation: boolean }>> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) return fail("validation", fieldErrors(parsed.error));
  const { role, fullName, email, password, invite, classCode, schoolCode, schoolName, schoolCity } = parsed.data;

  if (email.endsWith(`@${serverEnv().STUDENT_LOGIN_EMAIL_DOMAIN}`)) return fail("validation", { email: "email" });
  const ip = await clientIp();
  if (!(await rateLimit(`register:${ip}`, 15, 3600))) return fail("rateLimited");

  // Pre-validate optional codes before creating the user so typos never leave half-created accounts.
  const admin = createAdminClient();
  if (!invite && role === "student" && classCode?.trim()) {
    const code = classCode.trim().toUpperCase();
    const { data: cls } = await admin.from("classes").select("id").eq("join_code", code).maybeSingle();
    if (!cls) return fail("validation", { classCode: "invalid" });
  }
  if (!invite && role === "teacher" && schoolCode?.trim()) {
    const code = schoolCode.trim().toUpperCase();
    const { data: sch } = await admin.from("schools").select("id").eq("join_code", code).eq("is_active", true).maybeSingle();
    if (!sch) return fail("validation", { schoolCode: "invalid" });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName, locale: locale === "kk" ? "kk" : "ru", pending_invite: invite || null, preferred_role: role },
      emailRedirectTo: `${publicEnv.NEXT_PUBLIC_APP_URL}/auth/callback?next=/app`,
    },
  });
  if (error) {
    if (error.code === "weak_password") return fail("validation", { password: "minPassword" });
    if (error.code === "user_already_exists" || error.code === "email_exists") return fail("validation", { email: "invalid" });
    if (error.code === "over_email_send_rate_limit" || error.status === 429) return fail("rateLimited");
    return fail("generic");
  }

  if (data.session) {
    const userId = data.user?.id ?? null;
    if (invite?.trim()) {
      const { data: schoolId } = await supabase.rpc("accept_invitation", { p_token: invite.trim() });
      if (schoolId) await audit({ actorId: userId, schoolId, action: "invitation.accepted", entityType: "school", entityId: schoolId });
    } else if (role === "student" && classCode?.trim()) {
      const { data: classId } = await supabase.rpc("join_class_by_code", { p_join_code: classCode.trim().toUpperCase() });
      if (classId) await audit({ actorId: userId, schoolId: null, action: "class.joined_by_code", entityType: "class", entityId: classId });
    } else if (role === "school_admin" && schoolName?.trim()) {
      const { data: schoolId } = await supabase.rpc("create_school_with_admin", {
        p_name: schoolName.trim(),
        p_city: schoolCity?.trim() || null,
      });
      if (schoolId) await audit({ actorId: userId, schoolId, action: "school.self_created", entityType: "school", entityId: schoolId });
    } else if (role === "teacher" && schoolCode?.trim()) {
      await supabase.rpc("request_teacher_access", {
        p_join_code: schoolCode.trim().toUpperCase(),
        p_message: "",
      });
    }
    redirect("/app");
  }
  return { ok: true, data: { needsConfirmation: true } };
}

export async function forgotPasswordAction(input: unknown): Promise<ActionResult> {
  const parsed = forgotSchema.safeParse(input);
  if (!parsed.success) return fail("validation", fieldErrors(parsed.error));
  const ip = await clientIp();
  if (!(await rateLimit(`forgot:${ip}`, 5, 900))) return fail("rateLimited");
  const supabase = await createClient();
  // Always report success to avoid leaking which emails exist.
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${publicEnv.NEXT_PUBLIC_APP_URL}/auth/callback?next=/reset-password`,
  });
  return { ok: true, data: undefined };
}

export async function resetPasswordAction(input: unknown): Promise<ActionResult> {
  const parsed = resetSchema.safeParse(input);
  if (!parsed.success) return fail("validation", fieldErrors(parsed.error));
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("forbidden");
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return fail(error.code === "same_password" ? "validation" : "generic", error.code === "same_password" ? { password: "invalid" } : undefined);
  return { ok: true, data: undefined };
}
