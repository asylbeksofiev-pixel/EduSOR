"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { LayoutGrid, Menu, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { Brand, NAV_ICONS, SidebarNav } from "./sidebar";
import type { NavItem } from "./nav-config";

export function MobileNav({ items }: { items: NavItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger
        className="glass-pill inline-flex size-9 items-center justify-center rounded-xl text-muted-foreground transition hover:text-foreground lg:hidden"
        aria-label="Menu"
      >
        <Menu className="size-[18px]" />
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-slate-950/45 backdrop-blur-xs lg:hidden" />
        <DialogPrimitive.Content className="glass-sidebar fixed inset-y-0 left-0 z-50 flex w-76 max-w-[85vw] flex-col py-5 text-foreground shadow-2xl lg:hidden">
          <DialogPrimitive.Title className="sr-only">Menu</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Navigation</DialogPrimitive.Description>
          <div className="mb-5 flex items-center justify-between px-5">
            <Brand />
            <DialogPrimitive.Close
              className="rounded-xl p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
              aria-label="Close"
            >
              <X className="size-5" />
            </DialogPrimitive.Close>
          </div>
          <div className="flex-1 overflow-y-auto">
            <SidebarNav items={items} onNavigate={() => setOpen(false)} />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function MobileBottomNav({ items }: { items: NavItem[] }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();
  const { d } = useI18n();
  const labels = d.nav as Record<string, string>;
  const primaryItems = items.slice(0, 4);
  const hasMore = items.length > 4;

  return (
    <>
      <nav
        aria-label="Mobile quick navigation"
        className="no-print glass-header fixed inset-x-0 bottom-0 z-30 border-t border-border/80 pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        <div className="mx-auto grid max-w-lg grid-cols-5 items-center px-1.5 py-1.5">
          {primaryItems.map((item) => {
            const Icon = NAV_ICONS[item.icon];
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 text-[10.5px] font-medium transition",
                  active ? "text-primary font-semibold" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className={cn("size-[19px]", active && "text-primary")} aria-hidden />
                <span className="max-w-full truncate">{labels[item.labelKey] ?? item.labelKey}</span>
              </Link>
            );
          })}
          {hasMore && (
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="flex flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 text-[10.5px] font-medium text-muted-foreground transition hover:text-foreground"
            >
              <LayoutGrid className="size-[19px]" aria-hidden />
              <span className="truncate">{d.common.menu}</span>
            </button>
          )}
        </div>
      </nav>

      {hasMore && (
        <DialogPrimitive.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-slate-950/45 backdrop-blur-xs lg:hidden" />
            <DialogPrimitive.Content className="glass-modal fixed inset-x-3 bottom-3 z-50 max-h-[80vh] overflow-y-auto rounded-2xl p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] lg:hidden">
              <div className="mb-3 flex items-center justify-between px-2">
                <DialogPrimitive.Title className="text-sm font-semibold">{d.common.menu}</DialogPrimitive.Title>
                <DialogPrimitive.Description className="sr-only">Navigation</DialogPrimitive.Description>
                <DialogPrimitive.Close className="rounded-lg p-1 text-muted-foreground hover:bg-muted" aria-label="Close">
                  <X className="size-4" />
                </DialogPrimitive.Close>
              </div>
              <SidebarNav items={items} onNavigate={() => setDrawerOpen(false)} />
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
      )}
    </>
  );
}
