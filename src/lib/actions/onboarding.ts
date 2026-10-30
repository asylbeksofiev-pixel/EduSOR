"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { audit } from "@/lib/server/audit";
import { dbErrorCode, fail, type ActionResult } from "./result";

export async function acceptInvitationAction(token: string): Promise<ActionResult> {
  const parsed = z.string().min(16).max(200).safeParse(token.trim());
  if (!parsed.success) return fail("invitation_not_found");
  const supabase = await createClient();
  const { data: schoolId, error } = await supabase.rpc("accept_invitation", { p_token: parsed.data });
  if (error) return fail(dbErrorCode(error));
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await audit({ actorId: user?.id ?? null, schoolId, action: "invitation.accepted", entityType: "school", entityId: schoolId });
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export async function requestTeacherAccessAction(joinCode: string, message: string): Promise<ActionResult> {
  const parsed = z.object({ code: z.string().trim().min(4).max(20), message: z.string().max(1000) }).safeParse({ code: joinCode, message });
  if (!parsed.success) return fail("school_not_found");
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_teacher_access", { p_join_code: parsed.data.code.toUpperCase(), p_message: parsed.data.message });
  if (error) return fail(dbErrorCode(error));
  revalidatePath("/onboarding");
  return { ok: true, data: undefined };
}

export async function joinClassByCodeAction(classCode: string): Promise<ActionResult> {
  const parsed = z.string().trim().min(4).max(24).safeParse(classCode);
  if (!parsed.success) return fail("class_not_found");
  const supabase = await createClient();
  const { data: classId, error } = await supabase.rpc("join_class_by_code", { p_join_code: parsed.data.toUpperCase() });
  if (error) return fail(dbErrorCode(error));
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await audit({ actorId: user?.id ?? null, schoolId: null, action: "class.joined_by_code", entityType: "class", entityId: classId });
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export async function createSchoolOnboardingAction(name: string, city: string): Promise<ActionResult> {
  const parsed = z
    .object({
      name: z.string().trim().min(2).max(200),
      city: z.string().trim().max(100).optional(),
    })
    .safeParse({ name, city });
  if (!parsed.success) return fail("invalid");
  const supabase = await createClient();
  const { data: schoolId, error } = await supabase.rpc("create_school_with_admin", {
    p_name: parsed.data.name,
    p_city: parsed.data.city || null,
  });
  if (error) return fail(dbErrorCode(error));
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await audit({ actorId: user?.id ?? null, schoolId, action: "school.self_created", entityType: "school", entityId: schoolId });
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}
