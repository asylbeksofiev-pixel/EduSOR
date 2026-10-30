export const LOCAL_SESSION_COOKIE = "edusor_session";

export type LocalSessionPayload = {
  sub: string;
  email: string;
  exp: number;
};

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signToken(payload: Record<string, unknown>, secret: string): Promise<string> {
  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return `${body}.${toBase64Url(new Uint8Array(sig))}`;
}

export async function verifyToken<T extends { exp?: number }>(token: string | undefined | null, secret: string): Promise<T | null> {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sigStr = token.slice(dot + 1);
  try {
    const key = await hmacKey(secret);
    const sigBytes = fromBase64Url(sigStr);
    const ok = await crypto.subtle.verify("HMAC", key, sigBytes as BufferSource, new TextEncoder().encode(body));
    if (!ok) return null;
    const parsed = JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as T;
    if (typeof parsed.exp === "number" && parsed.exp * 1000 < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}
