import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isSupabaseConfigured } from "@/lib/env";
import { LOCAL_SESSION_COOKIE, verifyToken, type LocalSessionPayload } from "@/lib/db/session-token";

const PROTECTED_PREFIXES = ["/teacher", "/student", "/admin", "/super-admin", "/app", "/onboarding", "/notifications"];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const path = request.nextUrl.pathname;
  const isProtected = PROTECTED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const useSupabase =
    process.env.DATABASE_MODE !== "local" &&
    isSupabaseConfigured() &&
    serviceKey.length >= 16 &&
    !serviceKey.startsWith("your-");

  if (!useSupabase) {
    const secret = process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16
      ? process.env.SESSION_SECRET
      : "edusor-default-local-session-secret-2026";
    const token = request.cookies.get(LOCAL_SESSION_COOKIE)?.value;
    const session = await verifyToken<LocalSessionPayload>(token, secret);
    if (!session && isProtected) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
      return NextResponse.redirect(url);
    }
    return response;
  }

  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/jobs|api/storage|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)"],
};
