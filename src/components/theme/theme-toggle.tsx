"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "./theme-provider";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();
  const { d } = useI18n();
  const label = theme === "dark" ? d.common.themeLight : d.common.themeDark;

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={label}
      aria-label={label}
      className={cn(
        "glass-pill inline-flex size-9 items-center justify-center rounded-xl text-muted-foreground transition hover:text-foreground active:scale-95",
        className,
      )}
    >
      <Sun className="hidden size-[17px] dark:block" aria-hidden />
      <Moon className="block size-[17px] dark:hidden" aria-hidden />
    </button>
  );
}
