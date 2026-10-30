"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { GraduationCap, School, UserCheck } from "lucide-react";
import type { z } from "zod";
import { registerSchema, type RegisterRole } from "@/lib/validation/auth";
import { registerAction } from "@/lib/actions/auth-forms";
import { useI18n } from "@/lib/i18n/client";
import { useTranslateError } from "@/lib/i18n/use-tv";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Alert } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

export function RegisterForm({ invite }: { invite?: string }) {
  const { d, locale } = useI18n();
  const te = useTranslateError();
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  const form = useForm<z.input<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      role: "student",
      fullName: "",
      email: "",
      password: "",
      passwordRepeat: "",
      invite,
      classCode: "",
      schoolCode: "",
      schoolName: "",
      schoolCity: "",
    },
  });

  const selectedRole = (form.watch("role") ?? "student") as RegisterRole;
  const { errors } = form.formState;

  const setRole = (role: RegisterRole) => {
    form.setValue("role", role, { shouldValidate: false });
    form.clearErrors();
  };

  const onSubmit = form.handleSubmit((values) => {
    setServerError(null);
    start(async () => {
      const res = await registerAction(values, locale);
      if (!res) return;
      if (!res.ok) {
        if (res.fieldErrors) {
          for (const [k, v] of Object.entries(res.fieldErrors)) {
            form.setError(k as keyof typeof values, { message: v });
          }
        } else {
          setServerError(res.error);
        }
      } else {
        setDone(true);
      }
    });
  });

  if (done) return <Alert tone="success">{d.auth.checkEmail}</Alert>;

  const roleOptions: { id: RegisterRole; label: string; hint: string; icon: typeof GraduationCap }[] = [
    { id: "student", label: d.roles.student, hint: d.auth.roleStudentHint, icon: GraduationCap },
    { id: "teacher", label: d.roles.teacher, hint: d.auth.roleTeacherHint, icon: UserCheck },
    { id: "school_admin", label: d.common.classes === "Сыныптар" ? "Мектеп" : "Школа", hint: d.auth.roleAdminHint, icon: School },
  ];

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {invite && <Alert tone="info">{d.auth.inviteBanner}</Alert>}
      {serverError && <Alert tone="danger">{te(serverError)}</Alert>}

      {!invite && (
        <div>
          <p className="mb-2 text-[13px] font-medium text-foreground">{d.auth.chooseRole}</p>
          <div className="grid grid-cols-3 gap-2">
            {roleOptions.map((opt) => {
              const Icon = opt.icon;
              const active = selectedRole === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setRole(opt.id)}
                  className={cn(
                    "flex flex-col items-start gap-1 rounded-xl border p-2.5 text-left transition",
                    active
                      ? "border-primary bg-primary-soft/70 text-foreground shadow-xs"
                      : "border-border bg-surface/60 text-muted-foreground hover:border-border-strong hover:text-foreground",
                  )}
                >
                  <Icon className={cn("size-4", active ? "text-primary" : "text-muted-foreground")} />
                  <span className="text-xs font-semibold">{opt.label}</span>
                  <span className="line-clamp-2 text-[10.5px] leading-tight opacity-85">{opt.hint}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <Field label={d.common.fullName} htmlFor="fullName" error={te(errors.fullName?.message)}>
        <Input id="fullName" autoComplete="name" aria-invalid={!!errors.fullName} {...form.register("fullName")} />
      </Field>

      <Field label={d.common.email} htmlFor="email" error={te(errors.email?.message)}>
        <Input id="email" type="email" autoComplete="email" aria-invalid={!!errors.email} {...form.register("email")} />
      </Field>

      {!invite && selectedRole === "student" && (
        <Field label={d.auth.classCodeLabel} htmlFor="classCode" hint={d.auth.classCodeHint} error={te(errors.classCode?.message)}>
          <Input
            id="classCode"
            placeholder="7AMATH"
            autoComplete="off"
            className="uppercase tracking-wider"
            aria-invalid={!!errors.classCode}
            {...form.register("classCode")}
          />
        </Field>
      )}

      {!invite && selectedRole === "teacher" && (
        <Field label={d.auth.schoolCodeOptional} htmlFor="schoolCode" hint={d.auth.schoolCodeHint} error={te(errors.schoolCode?.message)}>
          <Input
            id="schoolCode"
            placeholder="GYM1AST"
            autoComplete="off"
            className="uppercase tracking-wider"
            aria-invalid={!!errors.schoolCode}
            {...form.register("schoolCode")}
          />
        </Field>
      )}

      {!invite && selectedRole === "school_admin" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={d.auth.schoolNameLabel} htmlFor="schoolName" error={te(errors.schoolName?.message)}>
            <Input id="schoolName" placeholder="Школа-лицей №15" aria-invalid={!!errors.schoolName} {...form.register("schoolName")} />
          </Field>
          <Field label={d.auth.schoolCityLabel} htmlFor="schoolCity" error={te(errors.schoolCity?.message)}>
            <Input id="schoolCity" placeholder="Алматы" aria-invalid={!!errors.schoolCity} {...form.register("schoolCity")} />
          </Field>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={d.auth.password} htmlFor="password" error={te(errors.password?.message)}>
          <Input id="password" type="password" autoComplete="new-password" aria-invalid={!!errors.password} {...form.register("password")} />
        </Field>
        <Field label={d.auth.passwordRepeat} htmlFor="passwordRepeat" error={te(errors.passwordRepeat?.message)}>
          <Input id="passwordRepeat" type="password" autoComplete="new-password" aria-invalid={!!errors.passwordRepeat} {...form.register("passwordRepeat")} />
        </Field>
      </div>

      <p className="text-xs text-muted-foreground">
        {d.auth.acceptTerms}{" "}
        <Link href="/terms" className="underline">
          {d.legal.termsTitle}
        </Link>{" "}
        ·{" "}
        <Link href="/privacy" className="underline">
          {d.legal.privacyTitle}
        </Link>
      </p>
      <Button type="submit" size="lg" loading={pending}>
        {d.auth.register}
      </Button>
    </form>
  );
}
