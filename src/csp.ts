/**
 * Content-Security-Policy mit Nonce für alle Next-Apps des Weblehrerzimmers.
 *
 * Alle Apps teilen sich eine Origin (webapps.das-rsg.de). Eine XSS-Lücke in einer App
 * reicht dadurch bis an das gemeinsame Session-Cookie und die Daten der anderen Apps.
 * Die Nonce-CSP lässt nur Skripte zu, die der Server selbst ausgeliefert hat.
 *
 * Einbau in proxy.ts (statt `export { auth as proxy }`):
 *
 *   import { auth } from "@/auth";
 *   import { withCsp } from "rsg-shared/csp";
 *   export const proxy = withCsp(auth, { publicPaths: ["/login"] });
 *   export const config = { matcher: [ … Login NICHT mehr ausnehmen, damit auch sie die CSP bekommt … ] };
 *
 * Modus über CSP_MODE (Laufzeit, ohne neuen Build umschaltbar):
 *   report  (Standard) Content-Security-Policy-Report-Only: blockiert nichts, Verstöße stehen in der Browser-Konsole
 *   enforce            Content-Security-Policy: Verstöße werden blockiert
 *   off                kein Header
 *
 * Next.js liest die Nonce aus dem CSP-Request-Header (auch Report-Only) und setzt sie selbst an seine Skripte.
 * Voraussetzung: dynamisch gerenderte Seiten (bei auth() ohnehin der Fall).
 * Keine Abhängigkeiten, läuft im Proxy.
 */

type Env = Record<string, string | undefined>;

export type CspMode = "report" | "enforce" | "off";

export function cspMode(env: Env = process.env): CspMode {
  const v = (env.CSP_MODE ?? "report").trim().toLowerCase();
  if (v === "report" || v === "enforce" || v === "off") return v;
  throw new Error(`CSP_MODE="${env.CSP_MODE}" ist unbekannt (erlaubt: report, enforce, off)`);
}

export type CspOptions = {
  /** Entwicklung: React braucht dort 'unsafe-eval' für Fehler-Stacks. */
  dev?: boolean;
  /** Weitere Ziele für Formulare (Login-Anbieter). Entra ist immer erlaubt; Keycloak-Host hier ergänzen. */
  formAction?: string[];
  /** Weitere Ziele für fetch/WebSocket. */
  connectSrc?: string[];
  /** Darf die Seite in einem Frame derselben Origin erscheinen? Standard: nein. */
  frameSelf?: boolean;
};

/** Login-Anbieter, an den der Auth.js-Signin per Formular/Weiterleitung geht (Chrome prüft form-action auch beim Redirect). */
const ENTRA = "https://login.microsoftonline.com";

const NONCE_RE = /^[A-Za-z0-9+/_-]{16,}={0,2}$/;

export function cspHeader(nonce: string, opts: CspOptions = {}): string {
  if (!NONCE_RE.test(nonce)) throw new Error("ungültige Nonce");
  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(opts.dev ? ["'unsafe-eval'"] : [])]],
    // React setzt style-Attribute; bei Styles ist das Risiko gering. Keine Nonce hier – sonst ignoriert der Browser 'unsafe-inline'.
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:"]],
    ["font-src", ["'self'"]],
    ["connect-src", ["'self'", ...(opts.connectSrc ?? [])]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'", ENTRA, ...(opts.formAction ?? [])]],
    ["frame-ancestors", [opts.frameSelf ? "'self'" : "'none'"]],
  ];
  return directives.map(([k, v]) => `${k} ${v.join(" ")}`).join("; ");
}

/** 16 zufällige Bytes, base64 – pro Anfrage neu. */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

export function cspHeaderName(mode: Exclude<CspMode, "off">): string {
  return mode === "enforce" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only";
}

type ProxyRequest = Request & { nextUrl?: URL & { basePath?: string } };
type Proxy<R extends ProxyRequest, A extends unknown[]> = (req: R, ...rest: A) => unknown;

export type WithCspOptions = CspOptions & {
  /** Pfade (ohne basePath), für die der Auth-Proxy nicht läuft, die aber die CSP bekommen – z.B. "/login". Exakt oder mit "/*" als Präfix. */
  publicPaths?: string[];
  env?: Env;
};

function pathWithoutBase(req: ProxyRequest): string {
  const url = req.nextUrl ?? new URL(req.url);
  const base = req.nextUrl?.basePath ?? "";
  const p = url.pathname;
  return base && (p === base || p.startsWith(base + "/")) ? p.slice(base.length) || "/" : p;
}

export function isPublicPath(path: string, publicPaths: string[] = []): boolean {
  return publicPaths.some((pp) => (pp.endsWith("/*") ? path === pp.slice(0, -2) || path.startsWith(pp.slice(0, -1)) : path === pp));
}

/**
 * Hängt die CSP an die Antwort des Auth-Proxys und gibt sie samt Nonce an das Rendering weiter.
 * Der Auth-Proxy (und damit authorized) bleibt unverändert – keine eigene Callback-Funktion an auth(),
 * denn dann ruft Auth.js sie auch bei authorized === false auf.
 */
export function withCsp<R extends ProxyRequest, A extends unknown[]>(proxy: Proxy<R, A>, opts: WithCspOptions = {}) {
  return async (req: R, ...rest: A): Promise<Response> => {
    const env = opts.env ?? process.env;
    const mode = cspMode(env);
    const isPublic = isPublicPath(pathWithoutBase(req), opts.publicPaths);
    const res = isPublic ? nextResponse() : ((await proxy(req, ...rest)) as Response | undefined) ?? nextResponse();
    if (mode === "off") return res;

    const nonce = createNonce();
    const name = cspHeaderName(mode);
    const value = cspHeader(nonce, { dev: env.NODE_ENV === "development", ...opts });
    const out = new Response(res.body, res);
    out.headers.set(name, value);

    // Nur wenn Next die Anfrage weiterrendert: CSP und Nonce als Request-Header durchreichen.
    // Next ersetzt dann ALLE Request-Header durch die Override-Liste – deshalb die vorhandenen mitgeben.
    if (out.headers.get("x-middleware-next") === "1") {
      const forwarded = new Headers(req.headers);
      const already = out.headers.get("x-middleware-override-headers");
      if (already) {
        // ein anderer Proxy hat schon Request-Header geändert: genau dessen Stand übernehmen
        for (const k of [...forwarded.keys()]) if (!already.split(",").map((s) => s.trim()).includes(k)) forwarded.delete(k);
        for (const k of already.split(",").map((s) => s.trim()).filter(Boolean)) {
          const v = out.headers.get(`x-middleware-request-${k}`);
          if (v === null) forwarded.delete(k);
          else forwarded.set(k, v);
        }
      }
      forwarded.set(name.toLowerCase(), value);
      forwarded.set("x-nonce", nonce);
      const keys: string[] = [];
      forwarded.forEach((v, k) => {
        out.headers.set(`x-middleware-request-${k}`, v);
        keys.push(k);
      });
      out.headers.set("x-middleware-override-headers", keys.join(","));
    }
    return out;
  };
}

function nextResponse(): Response {
  return new Response(null, { headers: { "x-middleware-next": "1" } });
}
