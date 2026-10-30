"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  BookOpen,
  ClipboardList,
  FileSearch,
  FileText,
  GraduationCap,
  Home,
  Library,
  LineChart,
  ListChecks,
  Radio,
  School,
  ScrollText,
  Settings,
  Sparkles,
  Trophy,
  User,
  Users,
  UserSquare2,
  type LucideIcon,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import type { NavIcon, NavItem } from "./nav-config";

export const NAV_ICONS: Record<NavIcon, LucideIcon> = {
  home: Home,
  classes: GraduationCap,
  students: Users,
  subjects: BookOpen,
  bank: Library,
  assessments: ClipboardList,
  ai: Sparkles,
  documents: FileText,
  live: Radio,
  analytics: BarChart3,
  settings: Settings,
  results: Trophy,
  progress: LineChart,
  profile: User,
  teachers: UserSquare2,
  reports: ListChecks,
  schools: School,
  users: Users,
  audit: ScrollText,
  review: FileSearch,
};

export function SidebarNav({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { d } = useI18n();
  const labels = d.nav as Record<string, string>;
  return (
    <nav className="flex flex-col gap-1 px-3" aria-label="Main">
      {items.map((item) => {
        const Icon = NAV_ICONS[item.icon];
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[13.5px] font-medium transition-all duration-150",
              active
                ? "border border-primary/20 bg-sidebar-active font-semibold text-primary shadow-2xs"
                : "border border-transparent text-sidebar-foreground hover:bg-muted/65 hover:text-foreground",
            )}
          >
            <Icon className={cn("size-[18px] shrink-0", active ? "text-primary" : "text-muted-foreground")} aria-hidden />
            <span className="truncate">{labels[item.labelKey] ?? item.labelKey}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function Brand({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className="flex size-8.5 items-center justify-center rounded-xl bg-primary text-sm font-bold text-white shadow-xs">
        E
      </div>
      <span className="text-[16px] font-bold tracking-tight text-foreground">EduSOR</span>
    </div>
  );
}
