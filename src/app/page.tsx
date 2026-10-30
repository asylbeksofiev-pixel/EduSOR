import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  CheckCircle2,
  FileText,
  GraduationCap,
  Lightbulb,
  School,
  ShieldCheck,
  Sparkles,
  UserCheck,
} from "lucide-react";
import { getI18n } from "@/lib/i18n/server";
import { getSessionContext } from "@/lib/auth/session";
import { Brand } from "@/components/shell/sidebar";
import { LanguageSwitcher } from "@/components/shell/language-switcher";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default async function LandingPage() {
  if (await getSessionContext()) redirect("/app");
  const { d } = await getI18n();

  const features = [
    { icon: FileText, title: d.landing.f1Title, text: d.landing.f1Text },
    { icon: ShieldCheck, title: d.landing.f2Title, text: d.landing.f2Text },
    { icon: Sparkles, title: d.landing.f3Title, text: d.landing.f3Text },
    { icon: Lightbulb, title: d.landing.f4Title, text: d.landing.f4Text },
  ];

  const steps = [
    { title: d.landing.step1Title, text: d.landing.step1Text },
    { title: d.landing.step2Title, text: d.landing.step2Text },
    { title: d.landing.step3Title, text: d.landing.step3Text },
  ];

  const roles = [
    { icon: UserCheck, title: d.roles.teacher, text: d.landing.roleTeacherDesc },
    { icon: GraduationCap, title: d.roles.student, text: d.landing.roleStudentDesc },
    { icon: School, title: d.roles.school_admin, text: d.landing.roleAdminDesc },
  ];

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="glass-header sticky top-0 z-30">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-8">
          <Brand />
          <div className="flex items-center gap-2 sm:gap-2.5">
            <LanguageSwitcher />
            <ThemeToggle />
            <Button asChild variant="secondary" size="sm" className="hidden sm:inline-flex">
              <Link href="/login">{d.landing.ctaLogin}</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/register">{d.landing.ctaRegister}</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="animate-fade-up flex-1">
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-8 px-4 pb-12 pt-10 sm:px-8 sm:pb-16 sm:pt-16 lg:grid-cols-[1.15fr_0.85fr]">
          <div>
            <Badge tone="primary" className="mb-4 px-3 py-1 text-xs font-semibold">
              <Sparkles className="size-3.5" /> {d.landing.badge}
            </Badge>
            <h1 className="text-3xl font-bold leading-[1.15] tracking-tight text-foreground sm:text-4xl lg:text-[42px]">
              {d.landing.title}
            </h1>
            <p className="mt-4 max-w-xl text-[15.5px] leading-relaxed text-muted-foreground sm:text-base">
              {d.landing.subtitle}
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Button asChild size="lg" className="w-full sm:w-auto">
                <Link href="/register">
                  {d.landing.ctaRegister} <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="secondary" className="w-full sm:w-auto">
                <Link href="/login">{d.landing.ctaLogin}</Link>
              </Button>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">{d.landing.note}</p>
          </div>

          {/* Interactive-style Liquid Glass Showcase Card */}
          <div className="glass-card rounded-3xl p-5 sm:p-6">
            <div className="flex items-center justify-between gap-2 border-b border-border/80 pb-3.5">
              <div>
                <p className="text-sm font-bold text-foreground">{d.landing.previewCardTitle}</p>
                <p className="text-xs text-muted-foreground">{d.landing.previewAiTag}</p>
              </div>
              <Badge tone="success">9 / 10 {d.common.pointsShort}</Badge>
            </div>

            <div className="mt-4 flex flex-col gap-2.5">
              <div className="rounded-2xl border border-border/70 bg-muted/40 p-3.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-foreground">#1 · Свойства степени</span>
                  <span className="font-bold text-success">2 / 2 {d.common.pointsShort}</span>
                </div>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CheckCircle2 className="size-3.5 shrink-0 text-success" />
                  Применены тождества степеней, ответ верен
                </p>
              </div>

              <div className="rounded-2xl border border-border/70 bg-muted/40 p-3.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-foreground">#2 · Линейное уравнение</span>
                  <span className="font-bold text-success">4 / 4 {d.common.pointsShort}</span>
                </div>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CheckCircle2 className="size-3.5 shrink-0 text-success" />
                  Раскрыты скобки, приведены подобные, корень найден
                </p>
              </div>

              <div className="rounded-2xl border border-primary/25 bg-primary-soft/55 p-3.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-foreground">#3 · Текстовая задача (рубрика)</span>
                  <span className="font-bold text-primary">3 / 4 {d.common.pointsShort}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Gemini AI: уравнение составлено верно (+2 б.), вычислительная неточность на последнем шаге (+1 б.).
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Key Capabilities */}
        <section className="mx-auto max-w-6xl px-4 py-8 sm:px-8 sm:py-12">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {features.map(({ icon: Icon, title, text }) => (
              <div key={title} className="glass-card glass-card-interactive rounded-2xl p-5">
                <div className="mb-3.5 flex size-10 items-center justify-center rounded-xl border border-primary/20 bg-primary-soft text-primary">
                  <Icon className="size-5" />
                </div>
                <h2 className="text-[15.5px] font-bold tracking-tight text-foreground">{title}</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Gemini AI Highlight + 3 Steps */}
        <section className="mx-auto max-w-6xl px-4 py-8 sm:px-8 sm:py-12">
          <div className="glass-card rounded-3xl p-6 sm:p-8">
            <Badge tone="info" className="mb-3">
              <Sparkles className="size-3.5" /> {d.landing.aiFeatureBadge}
            </Badge>
            <h2 className="max-w-2xl text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              {d.landing.aiFeatureTitle}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-[15px]">
              {d.landing.aiFeatureText}
            </p>

            <div className="mt-7 grid gap-4 border-t border-border/80 pt-6 md:grid-cols-3">
              {steps.map((step) => (
                <div key={step.title} className="rounded-2xl border border-border/70 bg-muted/35 p-4">
                  <h3 className="text-sm font-bold text-foreground">{step.title}</h3>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{step.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Roles */}
        <section className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-8">
          <h2 className="mb-5 text-lg font-bold tracking-tight text-foreground sm:text-xl">{d.landing.rolesHeading}</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {roles.map(({ icon: Icon, title, text }) => (
              <div key={title} className="glass-card glass-card-interactive flex items-start gap-3.5 rounded-2xl p-5">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary-soft text-primary">
                  <Icon className="size-5" />
                </div>
                <div>
                  <h3 className="text-[15px] font-bold text-foreground">{title}</h3>
                  <p className="mt-1 text-[13.5px] leading-relaxed text-muted-foreground">{text}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="glass-header border-t border-b-0 px-4 py-6 text-center text-xs text-muted-foreground">
        <span>EduSOR</span> ·{" "}
        <Link href="/privacy" className="hover:text-foreground hover:underline">
          {d.legal.privacyTitle}
        </Link>{" "}
        ·{" "}
        <Link href="/terms" className="hover:text-foreground hover:underline">
          {d.legal.termsTitle}
        </Link>
      </footer>
    </div>
  );
}
