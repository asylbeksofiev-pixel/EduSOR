"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/client";

export function NotificationBell({ userId, initialUnread }: { userId: string; initialUnread: number }) {
  const { d } = useI18n();
  const [unread, setUnread] = useState(initialUnread);

  useEffect(() => setUnread(initialUnread), [initialUnread]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, () =>
        setUnread((n) => n + 1),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  return (
    <Link
      href="/notifications"
      className="glass-pill relative inline-flex size-9 items-center justify-center rounded-xl text-muted-foreground transition hover:text-foreground active:scale-95"
      aria-label={`${d.nav.notifications}${unread ? ` (${unread})` : ""}`}
    >
      <Bell className="size-[18px]" />
      {unread > 0 && (
        <span className="absolute -right-1 -top-1 flex min-w-4.5 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-4.5 text-white shadow-xs">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}
