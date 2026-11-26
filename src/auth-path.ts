/**
 * Auth.js für eine App unter einem Unterpfad (z.B. /lehrerheft).
 *
 * Problem: Next.js reicht Anfragen an den Route-Handler OHNE den basePath weiter
 * (/lehrerheft/api/auth/signin → /api/auth/signin). Ein fester Auth.js-basePath "/api/auth"
 * passt zwar zum Routing, aber Auth.js baut daraus auch die Rücksprungadresse für Microsoft
 * (redirect_uri) – ohne App-Präfix. Dann landet der OAuth-Callback beim Portal statt in der App,
 * und deren signIn/jwt-Callbacks laufen nicht.
 *
 * Lösung: basePath = voller Pfad aus AUTH_URL, und der Route-Handler setzt den Präfix wieder
 * vor die Anfrage, bevor Auth.js sie sieht:
 *
 *   // auth.ts
 *   NextAuth({ basePath: authBasePath(), … })
 *
 *   // app/api/auth/[...nextauth]/route.ts
 *   export const { GET, POST } = authRouteHandlers(handlers);
 *
 * Ohne Unterpfad (Portal, lokale Entwicklung ohne AUTH_URL) ändert sich nichts.
 */
import { NextRequest } from "next/server";

type Env = Record<string, string | undefined>;
type Handler = (req: NextRequest) => Promise<Response>;

const AUTH_PATH = "/api/auth";
/** Nur einfache Pfadsegmente vor /api/auth, z.B. /lehrerheft oder /a/b-c */
const VALID = /^(?:\/[A-Za-z0-9_-]+)*\/api\/auth$/;

/** Der Auth.js-basePath: Pfad von AUTH_URL (z.B. /lehrerheft/api/auth), sonst /api/auth. */
export function authBasePath(env: Env = process.env): string {
  const raw = env.AUTH_URL ?? env.NEXTAUTH_URL;
  if (!raw) return AUTH_PATH;
  let path: string;
  try {
    path = new URL(raw).pathname.replace(/\/+$/, "");
  } catch {
    return AUTH_PATH;
  }
  return VALID.test(path) ? path : AUTH_PATH;
}

/** Der App-Präfix vor /api/auth, z.B. "/lehrerheft"; "" für das Portal. */
export function authAppPrefix(env: Env = process.env): string {
  return authBasePath(env).slice(0, -AUTH_PATH.length);
}

/** Setzt den App-Präfix vor den Pfad, falls Next.js ihn entfernt hat. */
export function withAppPrefix(url: URL, prefix: string): URL {
  if (!prefix || url.pathname === prefix || url.pathname.startsWith(`${prefix}/`)) return url;
  const fixed = new URL(url);
  fixed.pathname = `${prefix}${url.pathname}`;
  return fixed;
}

/** Route-Handler für app/api/auth/[...nextauth]/route.ts, passend zu authBasePath(). */
export function authRouteHandlers(
  handlers: { GET: Handler; POST: Handler },
  env: Env = process.env,
): { GET: Handler; POST: Handler } {
  const prefix = authAppPrefix(env);
  if (!prefix) return handlers;
  const fix = (req: NextRequest): NextRequest => {
    const url = new URL(req.url);
    const fixed = withAppPrefix(url, prefix);
    return fixed === url ? req : new NextRequest(fixed, req);
  };
  return {
    GET: (req) => handlers.GET(fix(req)),
    POST: (req) => handlers.POST(fix(req)),
  };
}
