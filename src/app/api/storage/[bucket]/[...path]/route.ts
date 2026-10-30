import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env.server";
import { STORAGE_DIR } from "@/lib/db/sqlite";
import { verifyToken } from "@/lib/db/session-token";

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export async function GET(request: Request, context: { params: Promise<{ bucket: string; path: string[] }> }) {
  const { bucket, path: segments } = await context.params;
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const verified = await verifyToken<{ bucket: string; path: string; exp: number }>(token, serverEnv().SESSION_SECRET);
  const joined = segments.join("/");
  if (!verified || verified.bucket !== bucket || verified.path !== joined) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const safeSegments = segments.map((s) => s.replace(/\.\./g, ""));
  const fullPath = path.join(STORAGE_DIR, bucket.replace(/\.\./g, ""), ...safeSegments);
  if (!existsSync(fullPath)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const buf = readFileSync(fullPath);
  const ext = path.extname(fullPath).slice(1).toLowerCase();
  const contentType = MIME_BY_EXT[ext] ?? "application/octet-stream";
  return new NextResponse(buf, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=300",
    },
  });
}
