import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { publicEnv } from "@/lib/env";
import { serverEnv, isSupabaseBackend } from "@/lib/env.server";
import { createLocalAdminClient } from "@/lib/db/local-engine";

/**
 * Service-role client. Bypasses RLS, used only by verified server code
 * (grading, background jobs, notifications, admin-created accounts).
 */
export function createAdminClient(): SupabaseClient<Database> {
  if (!isSupabaseBackend()) {
    return createLocalAdminClient() as unknown as SupabaseClient<Database>;
  }
  return createClient<Database>(publicEnv.NEXT_PUBLIC_SUPABASE_URL, serverEnv().SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type AdminClient = ReturnType<typeof createAdminClient>;
