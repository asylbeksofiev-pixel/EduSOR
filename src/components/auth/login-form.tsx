"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { GraduationCap, School, ShieldCheck, UserCheck } from "lucide-react";
import type { z } from "zod";
import { loginSchema } from "@/lib/validation/auth";
import { loginAction, quickDemoLoginAction } from "@/lib/actions/auth-forms";
import { useI18n } from "@/lib/i18n/client";
import { useTranslateError } from "@/lib/i18n/use-tv";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Alert } from "@/components/ui/misc";

export function LoginForm({ next, linkError, showDemo = false }: { next?: string; linkError?: boolean; showDemo?: boolean }) {
  const { d } = useI18n();
  const te = useTranslateError();
  const [serverError, setServerError] = useState<string | null>(linkError ? "generic" : null);
  const [pending, start] = useTransition();
  const form = useForm<z.input<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { identifier: "", password: "", next },
  });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit((values) => {
    setServerError(null);
    start(async () => {
      const res = await loginAction(values);
      if (res && !res.ok) setServerError(res.error);
    });
  });

  const handleDemo = (role: "teacher" | "student" | "admin" | "super") => {
    setServerError(null);
    start(async () => {
      const res = await quickDemoLoginAction(role);
      if (res && !res.ok) setServerError(res.error);
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {serverError && <Alert tone="danger">{te(serverError)}</Alert>}
        <Field label={d.auth.identifier} htmlFor="identifier" error={te(errors.identifier?.message)} hint={d.auth.studentLoginHint}>
          <Input id="identifier" autoComplete="username" autoCapitalize="none" aria-invalid={!!errors.identifier} {...form.register("identifier")} />
        </Field>
        <Field label={d.auth.password} htmlFor="password" error={te(errors.password?.message)}>
          <Input id="password" type="password" autoComplete="current-password" aria-invalid={!!errors.password} {...form.register("password")} />
        </Field>
        <div className="flex justify-end">
          <Link href="/forgot-password" className="text-[13px] font-medium text-primary hover:underline">
            {d.auth.forgot}
          </Link>
        </div>
        <Button type="submit" size="lg" loading={pending}>
          {d.auth.login}
        </Button>
      </form>

      {showDemo && (
        <div className="rounded-2xl border border-border bg-muted/40 p-3.5">
          <p className="text-xs font-semibold text-foreground">{d.auth.demoAccountsTitle}</p>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">{d.auth.demoAccountsSubtitle}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => handleDemo("teacher")}
              className="flex items-center gap-2 rounded-xl border border-border bg-surface/80 px-3 py-2 text-left text-xs font-medium transition hover:border-primary/40 hover:bg-primary-soft/50 disabled:opacity-50"
            >
              <UserCheck className="size-4 shrink-0 text-primary" />
              <span className="truncate">{d.roles.teacher}</span>
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => handleDemo("student")}
              className="flex items-center gap-2 rounded-xl border border-border bg-surface/80 px-3 py-2 text-left text-xs font-medium transition hover:border-primary/40 hover:bg-primary-soft/50 disabled:opacity-50"
            >
              <GraduationCap className="size-4 shrink-0 text-primary" />
              <span className="truncate">{d.roles.student}</span>
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => handleDemo("admin")}
              className="flex items-center gap-2 rounded-xl border border-border bg-surface/80 px-3 py-2 text-left text-xs font-medium transition hover:border-primary/40 hover:bg-primary-soft/50 disabled:opacity-50"
            >
              <School className="size-4 shrink-0 text-primary" />
              <span className="truncate">{d.roles.school_admin}</span>
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => handleDemo("super")}
              className="flex items-center gap-2 rounded-xl border border-border bg-surface/80 px-3 py-2 text-left text-xs font-medium transition hover:border-primary/40 hover:bg-primary-soft/50 disabled:opacity-50"
            >
              <ShieldCheck className="size-4 shrink-0 text-primary" />
              <span className="truncate">Super Admin</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
