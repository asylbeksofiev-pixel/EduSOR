import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { publicEnv } from "@/lib/env";
import { isSupabaseBackend } from "@/lib/env.server";
import { createLocalServerClient } from "@/lib/db/local-engine";

/** Database client acting as the signed-in user (Local SQLite out-of-the-box or Supabase Cloud via .env). */
export async function createClient(): Promise<SupabaseClient<Database>> {
  const cookieStore = await cookies();
  if (!isSupabaseBackend()) {
    const local = await createLocalServerClient({
      getAll() {
        return cookieStore.getAll();
      },
      set(name, value, options) {
        cookieStore.set(name, value, options as never);
      },
    });
    return local as unknown as SupabaseClient<Database>;
  }

  return createServerClient<Database>(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component; the middleware refreshes the session instead.
        }
      },
    },
  });
}

export type ServerClient = Awaited<ReturnType<typeof createClient>>;
