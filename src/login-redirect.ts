/**
 * Weiterleitung zur eigenen Login-Seite einer App unter einem Unterpfad.
 *
 * Auth.js leitet im authorized-Callback auf pages.signIn um und verliert dabei den basePath
 * (/lehrerheft/raeume → /login statt /lehrerheft/login). Deshalb im authorized-Callback:
 *
 *   authorized({ auth, request }) {
 *     return auth?.user ? true : loginRedirect(request.nextUrl, BASE_PATH);
 *   }
 *
 * und auf der Login-Seite den Rücksprung nur über safeCallbackPath() übernehmen.
 * Keine Abhängigkeiten, läuft auch im Proxy (Middleware).
 */

/**
 * Prüft einen Rücksprung (callbackUrl): nur ein relativer Pfad innerhalb von basePath.
 * Abgelehnt werden absolute URLs, "//host", Backslashes, Steuerzeichen, Wege per "/../" aus dem
 * Unterpfad heraus sowie /login und /api/. Dann kommt `${basePath}/` zurück.
 */
export function safeCallbackPath(raw: unknown, basePath: string): string {
  const base = basePath.replace(/\/+$/, "");
  const fallback = `${base}/`;
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 500) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(raw)) return fallback;
  const inBase = (p: string) => !base || p === base || p.startsWith(`${base}/`);
  if (!inBase(raw.split("?")[0])) return fallback;
  let url: URL;
  try {
    url = new URL(raw, "http://intern.invalid");
  } catch {
    return fallback;
  }
  if (url.origin !== "http://intern.invalid" || !inBase(url.pathname)) return fallback;
  const inApp = url.pathname.slice(base.length) || "/";
  if (inApp === "/login" || inApp.startsWith("/login/") || inApp.startsWith("/api/")) return fallback;
  return url.pathname + url.search;
}

/**
 * Antwort für den authorized-Callback: 307 auf `${basePath}${loginPath}?callbackUrl=<Pfad>`.
 * nextUrl.href enthält in Next.js den basePath; als Rücksprung geht nur Pfad + Query mit, nie die Origin.
 */
export function loginRedirect(nextUrl: URL, basePath: string, loginPath = "/login"): Response {
  const base = basePath.replace(/\/+$/, "");
  const here = new URL(nextUrl.href);
  const login = new URL(`${base}${loginPath}`, here.origin);
  login.searchParams.set("callbackUrl", safeCallbackPath(here.pathname + here.search, base));
  return Response.redirect(login, 307);
}
