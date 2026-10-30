"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";
import { isSupabaseConfigured, publicEnv } from "@/lib/env";

let browserClient: ReturnType<typeof createBrowserClient<Database>> | null = null;

function createFallbackBrowserClient() {
  const noopChannel = {
    on() {
      return noopChannel;
    },
    subscribe(cb?: (status: string) => void) {
      if (cb) setTimeout(() => cb("CLOSED"), 0);
      return noopChannel;
    },
  };
  return {
    channel() {
      return noopChannel;
    },
    async removeChannel() {
      return "ok" as const;
    },
  } as unknown as ReturnType<typeof createBrowserClient<Database>>;
}

export function createClient() {
  if (!isSupabaseConfigured()) {
    browserClient ??= createFallbackBrowserClient();
    return browserClient;
  }
  browserClient ??= createBrowserClient<Database>(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  return browserClient;
}
