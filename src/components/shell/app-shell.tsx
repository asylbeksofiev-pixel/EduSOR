import type { ReactNode } from "react";
import type { AppRole, SessionContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { NAV } from "./nav-config";
import { Brand, SidebarNav } from "./sidebar";
import { MobileBottomNav, MobileNav } from "./mobile-nav";
import { LanguageSwitcher } from "./language-switcher";
import { NotificationBell } from "./notification-bell";
import { UserMenu } from "./user-menu";

const SETTINGS: Record<AppRole, string> = {
  super_admin: "/super-admin/settings",
  school_admin: "/admin/settings",
  teacher: "/teacher/settings",
  student: "/student/profile",
};

export async function AppShell({ ctx, role, children }: { ctx: SessionContext; role: AppRole; children: ReactNode }) {
  const supabase = await createClient();
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", ctx.userId)
    .is("read_at", null);
  const school = ctx.memberships.find((m) => m.role === role)?.school;
  const items = NAV[role];

  return (
    <div className="flex min-h-dvh">
      <aside className="no-print glass-sidebar sticky top-0 hidden h-dvh w-66 shrink-0 flex-col py-5 lg:flex">
        <Brand className="mb-6 px-6" />
        <div className="flex-1 overflow-y-auto">
          <SidebarNav items={items} />
        </div>
        {school && (
          <div className="mx-4 mt-4 rounded-xl border border-border/70 bg-muted/45 px-3.5 py-2.5 text-xs font-medium text-muted-foreground">
            {school.name}
          </div>
        )}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print glass-header sticky top-0 z-30 flex h-15 items-center gap-2 px-3 sm:px-6">
          <MobileNav items={items} />
          <Brand className="lg:hidden" />
          <div className="ml-auto flex items-center gap-1.5 sm:gap-2.5">
            <LanguageSwitcher />
            <ThemeToggle />
            <NotificationBell userId={ctx.userId} initialUnread={count ?? 0} />
            <UserMenu name={ctx.profile.full_name} email={ctx.email} role={role} roles={ctx.roles} settingsHref={SETTINGS[role]} />
          </div>
        </header>
        <main className="animate-fade-up mx-auto w-full max-w-7xl flex-1 px-4 pb-24 pt-6 sm:px-6 lg:px-8 lg:pb-10">
          {children}
        </main>
        <MobileBottomNav items={items} />
      </div>
    </div>
  );
}
