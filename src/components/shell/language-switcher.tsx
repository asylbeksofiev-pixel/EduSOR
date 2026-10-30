"use client";

import { useTransition } from "react";
import { Languages } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { setLocaleAction } from "@/lib/actions/locale";
import { cn } from "@/lib/utils";

export function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, d } = useI18n();
  const [pending, start] = useTransition();
  return (
    <div
      className={cn("glass-pill inline-flex h-9 items-center gap-0.5 rounded-xl p-1", className)}
      role="group"
      aria-label={d.common.language}
    >
      <Languages className="mx-1 hidden size-3.5 text-muted-foreground sm:block" aria-hidden />
      {(["ru", "kk"] as const).map((l) => (
        <button
          key={l}
          type="button"
          disabled={pending}
          aria-pressed={locale === l}
          onClick={() => start(() => setLocaleAction(l))}
          className={cn(
            "rounded-lg px-2 py-1 text-xs font-semibold transition-all",
            locale === l ? "bg-primary text-primary-foreground shadow-2xs" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {l === "ru" ? "Рус" : "Қаз"}
        </button>
      ))}
    </div>
  );
}
