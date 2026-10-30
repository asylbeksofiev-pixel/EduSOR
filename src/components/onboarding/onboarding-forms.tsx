"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  acceptInvitationAction,
  createSchoolOnboardingAction,
  joinClassByCodeAction,
  requestTeacherAccessAction,
} from "@/lib/actions/onboarding";
import { useI18n } from "@/lib/i18n/client";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Alert } from "@/components/ui/misc";

function useOnboardingError() {
  const { d } = useI18n();
  return (code: string) =>
    (d.onboarding.errors as Record<string, string>)[code] ??
    (d.errors as Record<string, string>)[code] ??
    d.errors.generic;
}

export function StudentJoinClassForm() {
  const { d } = useI18n();
  const msg = useOnboardingError();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const res = await joinClassByCodeAction(code);
          if (res.ok) router.replace("/app");
          else setError(res.error);
        });
      }}
      className="flex flex-col gap-3"
    >
      {error && <Alert tone="danger">{msg(error)}</Alert>}
      <Field label={d.common.classCode} htmlFor="student-class-code">
        <Input
          id="student-class-code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="7AMATH"
          maxLength={24}
          autoComplete="off"
          className="uppercase tracking-wider"
        />
      </Field>
      <Button type="submit" loading={pending} disabled={code.trim().length < 4}>
        {d.onboarding.joinClass}
      </Button>
    </form>
  );
}

export function AcceptInviteForm({ initialToken }: { initialToken?: string }) {
  const { d } = useI18n();
  const msg = useOnboardingError();
  const router = useRouter();
  const [token, setToken] = useState(initialToken ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const autoTried = useRef(false);

  const submit = (value: string) =>
    start(async () => {
      setError(null);
      const res = await acceptInvitationAction(value);
      if (res.ok) router.replace("/app");
      else setError(res.error);
    });

  useEffect(() => {
    if (initialToken && !autoTried.current) {
      autoTried.current = true;
      submit(initialToken);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialToken]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(token);
      }}
      className="flex flex-col gap-3"
    >
      {error && <Alert tone="danger">{msg(error)}</Alert>}
      <Field label={d.onboarding.inviteCode} htmlFor="invite">
        <Input id="invite" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
      </Field>
      <Button type="submit" variant="secondary" loading={pending} disabled={!token.trim()}>
        {d.onboarding.acceptInvite}
      </Button>
    </form>
  );
}

export function TeacherRequestForm() {
  const { d } = useI18n();
  const msg = useOnboardingError();
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [state, setState] = useState<{ error?: string; done?: boolean }>({});
  const [pending, start] = useTransition();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await requestTeacherAccessAction(code, message);
          setState(res.ok ? { done: true } : { error: res.error });
        });
      }}
      className="flex flex-col gap-3"
    >
      {state.error && <Alert tone="danger">{msg(state.error)}</Alert>}
      {state.done && <Alert tone="success">{d.onboarding.requestSent}</Alert>}
      <Field label={d.onboarding.schoolCode} htmlFor="code">
        <Input
          id="code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="GYM1AST"
          maxLength={20}
          autoComplete="off"
          className="uppercase tracking-wider"
        />
      </Field>
      <Field label={d.onboarding.message} htmlFor="message">
        <Textarea id="message" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1000} />
      </Field>
      <Button type="submit" variant="secondary" loading={pending} disabled={code.trim().length < 4}>
        {d.onboarding.sendRequest}
      </Button>
    </form>
  );
}

export function CreateSchoolOnboardingForm() {
  const { d } = useI18n();
  const msg = useOnboardingError();
  const router = useRouter();
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const res = await createSchoolOnboardingAction(name, city);
          if (res.ok) router.replace("/app");
          else setError(res.error);
        });
      }}
      className="flex flex-col gap-3"
    >
      {error && <Alert tone="danger">{msg(error)}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={d.admin.schoolName} htmlFor="new-school-name">
          <Input id="new-school-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Школа-лицей №15" maxLength={200} />
        </Field>
        <Field label={d.admin.city} htmlFor="new-school-city">
          <Input id="new-school-city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Алматы" maxLength={100} />
        </Field>
      </div>
      <Button type="submit" variant="secondary" loading={pending} disabled={name.trim().length < 2}>
        {d.onboarding.createSchoolBtn}
      </Button>
    </form>
  );
}
