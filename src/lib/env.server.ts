import "server-only";
import { z } from "zod";
import { isSupabaseConfigured } from "./env";

const serverSchema = z.object({
  DATABASE_MODE: z.enum(["local", "supabase"]).optional(),
  SESSION_SECRET: z.string().min(16).default("edusor-default-local-session-secret-2026"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional().default(""),
  STUDENT_LOGIN_EMAIL_DOMAIN: z.string().min(3).default("students.edusor.local"),

  AI_PROVIDER: z.enum(["gemini", "openai"]).default("gemini"),
  GEMINI_API_KEY: z.string().optional().default(""),
  GEMINI_MODEL_TEXT: z.string().min(1).default("gemini-2.5-flash"),
  GEMINI_MODEL_VISION: z.string().min(1).default("gemini-2.5-flash"),

  AI_API_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  AI_API_KEY: z.string().optional().default(""),
  AI_MODEL_TEXT: z.string().min(1).default("gpt-4.1-mini"),
  AI_MODEL_VISION: z.string().min(1).default("gpt-4.1-mini"),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600000).default(60000),
  AI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  CRON_SECRET: z.string().optional().default(""),
});

export function serverEnv() {
  return serverSchema.parse({
    ...process.env,
    DATABASE_MODE: process.env.DATABASE_MODE === "supabase" || process.env.DATABASE_MODE === "local" ? process.env.DATABASE_MODE : undefined,
    AI_PROVIDER: process.env.AI_PROVIDER === "openai" ? "openai" : "gemini",
  });
}

export function isSupabaseBackend(): boolean {
  const env = serverEnv();
  if (env.DATABASE_MODE === "local") return false;
  if (env.DATABASE_MODE === "supabase") {
    return isSupabaseConfigured() && env.SUPABASE_SERVICE_ROLE_KEY.length >= 16 && !env.SUPABASE_SERVICE_ROLE_KEY.startsWith("your-");
  }
  return isSupabaseConfigured() && env.SUPABASE_SERVICE_ROLE_KEY.length >= 16 && !env.SUPABASE_SERVICE_ROLE_KEY.startsWith("your-");
}
