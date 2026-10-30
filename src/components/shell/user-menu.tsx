"use client";

import Link from "next/link";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { ChevronDown, LogOut, Repeat, Settings } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { signOutAction } from "@/lib/actions/auth";
import type { AppRole } from "@/lib/auth/session";

const HOME: Record<AppRole, string> = {
  super_admin: "/super-admin/dashboard",
  school_admin: "/admin/dashboard",
  teacher: "/teacher/dashboard",
  student: "/student/dashboard",
};

export function UserMenu({
  name,
  email,
  role,
  roles,
  settingsHref,
}: {
  name: string;
  email: string | null;
  role: AppRole;
  roles: AppRole[];
  settingsHref: string;
}) {
  const { d } = useI18n();
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("") || "?";

  return (
    <Dropdown.Root>
      <Dropdown.Trigger className="glass-pill flex h-9.5 items-center gap-2 rounded-xl px-2 py-1 transition hover:border-border-strong">
        <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-xs font-bold text-white">
          {initials}
        </span>
        <span className="hidden text-left md:block">
          <span className="block max-w-36 truncate text-[12.5px] font-semibold leading-tight text-foreground">{name || email}</span>
          <span className="block text-[10.5px] leading-tight text-muted-foreground">{d.roles[role]}</span>
        </span>
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content align="end" sideOffset={8} className="glass-modal animate-scale-in z-50 min-w-60 rounded-2xl p-1.5">
          <div className="px-3 py-2">
            <p className="truncate text-xs font-semibold text-foreground">{name}</p>
            {email && <p className="truncate text-[11.5px] text-muted-foreground">{email}</p>}
          </div>
          <Dropdown.Separator className="my-1 h-px bg-border/80" />
          {roles
            .filter((r) => r !== role)
            .map((r) => (
              <Dropdown.Item key={r} asChild>
                <Link
                  href={HOME[r]}
                  className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm outline-none transition data-[highlighted]:bg-muted"
                >
                  <Repeat className="size-4 text-primary" /> {d.roles[r]}
                </Link>
              </Dropdown.Item>
            ))}
          <Dropdown.Item asChild>
            <Link
              href={settingsHref}
              className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm outline-none transition data-[highlighted]:bg-muted"
            >
              <Settings className="size-4 text-muted-foreground" /> {d.common.settings}
            </Link>
          </Dropdown.Item>
          <Dropdown.Separator className="my-1 h-px bg-border/80" />
          <Dropdown.Item
            onSelect={() => void signOutAction()}
            className="flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-danger outline-none transition data-[highlighted]:bg-danger-soft"
          >
            <LogOut className="size-4" /> {d.common.signOut}
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
