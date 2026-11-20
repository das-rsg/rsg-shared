import { describe, expect, it, vi } from "vitest";
import { createNonce, cspHeader, cspMode, isPublicPath, withCsp } from "./csp";

const req = (url: string, basePath = "", headers: Record<string, string> = {}) => {
  const r = new Request(url, { headers }) as Request & { nextUrl: URL & { basePath: string } };
  r.nextUrl = Object.assign(new URL(url), { basePath });
  return r;
};
const next = () => new Response(null, { headers: { "x-middleware-next": "1" } });
const nonceOf = (csp: string) => csp.match(/'nonce-([^']+)'/)![1];

describe("cspHeader", () => {
  const n = createNonce();

  it("Produktion: Nonce + strict-dynamic, kein unsafe-eval, keine Inline-Skripte", () => {
    const h = cspHeader(n);
    expect(h).toContain(`script-src 'self' 'nonce-${n}' 'strict-dynamic'`);
    expect(h).not.toContain("unsafe-eval");
    expect(h.match(/script-src[^;]*/)![0]).not.toContain("unsafe-inline");
    for (const d of ["default-src 'self'", "object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'", "font-src 'self'", "connect-src 'self'", "img-src 'self' data: blob:"]) {
      expect(h).toContain(d);
    }
  });

  it("Styles inline erlaubt, aber ohne Nonce (sonst wirkt unsafe-inline nicht)", () => {
    expect(cspHeader(n).match(/style-src[^;]*/)![0]).toBe("style-src 'self' 'unsafe-inline'");
  });

  it("form-action erlaubt Entra und optional weitere Login-Anbieter", () => {
    expect(cspHeader(n)).toContain("form-action 'self' https://login.microsoftonline.com");
    expect(cspHeader(n, { formAction: ["https://login.das-rsg.de"] })).toContain("https://login.microsoftonline.com https://login.das-rsg.de");
  });

  it("unsafe-eval nur in der Entwicklung", () => {
    expect(cspHeader(n, { dev: true })).toContain("'strict-dynamic' 'unsafe-eval'");
  });

  it("weist kaputte Nonces ab (kein Einschleusen weiterer Direktiven)", () => {
    expect(() => cspHeader("abc")).toThrow();
    expect(() => cspHeader("AAAAAAAAAAAAAAAAAAAAAA=='; script-src *")).toThrow();
  });

  it("Nonce ist pro Aufruf neu", () => {
    expect(createNonce()).not.toBe(createNonce());
    expect(createNonce()).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});

describe("cspMode", () => {
  it("Standard ist report, Tippfehler fallen mit einer Warnung (einmal) auf report zurück", () => {
    expect(cspMode({})).toBe("report");
    expect(cspMode({ CSP_MODE: "Enforce" })).toBe("enforce");
    expect(cspMode({ CSP_MODE: "off" })).toBe("off");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(cspMode({ CSP_MODE: "scharf" })).toBe("report");
    expect(cspMode({ CSP_MODE: "scharf" })).toBe("report");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/unbekannt/);
    warn.mockRestore();
  });
});

describe("isPublicPath", () => {
  it("exakt oder Präfix mit /*", () => {
    expect(isPublicPath("/login", ["/login"])).toBe(true);
    expect(isPublicPath("/login2", ["/login"])).toBe(false);
    expect(isPublicPath("/scan", ["/scan/*"])).toBe(true);
    expect(isPublicPath("/scan/x", ["/scan/*"])).toBe(true);
    expect(isPublicPath("/scanner", ["/scan/*"])).toBe(false);
  });
});

describe("withCsp", () => {
  it("reicht CSP und Nonce an das Rendering weiter und behält alle Request-Header", async () => {
    const p = withCsp(async () => next(), { env: { CSP_MODE: "enforce" } });
    const res = await p(req("https://x.test/lehrerheft/raeume", "/lehrerheft", { cookie: "a=1", "accept-language": "de" }));
    const csp = res.headers.get("content-security-policy")!;
    expect(csp).toContain("'strict-dynamic'");
    const keys = res.headers.get("x-middleware-override-headers")!.split(",");
    expect(keys).toEqual(expect.arrayContaining(["cookie", "accept-language", "content-security-policy", "x-nonce"]));
    expect(res.headers.get("x-middleware-request-cookie")).toBe("a=1");
    expect(res.headers.get("x-middleware-request-content-security-policy")).toBe(csp);
    expect(res.headers.get("x-middleware-request-x-nonce")).toBe(nonceOf(csp));
  });

  it("report: nur Report-Only-Header (Next liest die Nonce auch daraus)", async () => {
    const res = await withCsp(async () => next(), { env: {} })(req("https://x.test/"));
    expect(res.headers.get("content-security-policy")).toBeNull();
    expect(res.headers.get("content-security-policy-report-only")).toContain("'nonce-");
    expect(res.headers.get("x-middleware-request-content-security-policy-report-only")).toContain("'nonce-");
  });

  it("jede Anfrage bekommt eine neue Nonce", async () => {
    const p = withCsp(async () => next(), { env: {} });
    const a = (await p(req("https://x.test/"))).headers.get("content-security-policy-report-only")!;
    const b = (await p(req("https://x.test/"))).headers.get("content-security-policy-report-only")!;
    expect(nonceOf(a)).not.toBe(nonceOf(b));
  });

  it("lässt die Login-Weiterleitung des Auth-Proxys unverändert (nur CSP dazu, keine Request-Header)", async () => {
    const redirect = Response.redirect("https://x.test/lehrerheft/login?callbackUrl=%2Flehrerheft%2Fraeume", 307);
    const res = await withCsp(async () => redirect, { env: { CSP_MODE: "enforce" } })(req("https://x.test/lehrerheft/raeume", "/lehrerheft"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://x.test/lehrerheft/login?callbackUrl=%2Flehrerheft%2Fraeume");
    expect(res.headers.get("x-middleware-override-headers")).toBeNull();
    expect(res.headers.get("content-security-policy")).toContain("default-src");
  });

  it("öffentliche Pfade (ohne basePath) umgehen den Auth-Proxy, bekommen aber die CSP", async () => {
    let called = 0;
    const p = withCsp(async () => (called++, Response.redirect("https://x.test/lehrerheft/login", 307)), { publicPaths: ["/login"], env: {} });
    const pub = await p(req("https://x.test/lehrerheft/login?callbackUrl=x", "/lehrerheft"));
    expect(called).toBe(0);
    expect(pub.headers.get("x-middleware-next")).toBe("1");
    expect(pub.headers.get("content-security-policy-report-only")).toContain("'nonce-");
    await p(req("https://x.test/lehrerheft/raeume", "/lehrerheft"));
    expect(called).toBe(1);
  });

  it("Proxy ohne Rückgabe gilt als weiter (wie bei Next)", async () => {
    const res = await withCsp(async () => undefined, { env: {} })(req("https://x.test/"));
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("übernimmt Request-Header, die der innere Proxy schon geändert hat", async () => {
    const inner = async () =>
      new Response(null, {
        headers: { "x-middleware-next": "1", "x-middleware-override-headers": "cookie,x-eigen", "x-middleware-request-cookie": "neu=1", "x-middleware-request-x-eigen": "ja" },
      });
    const res = await withCsp(inner, { env: {} })(req("https://x.test/", "", { cookie: "alt=1", "x-weg": "1" }));
    const keys = res.headers.get("x-middleware-override-headers")!.split(",");
    expect(keys).toEqual(expect.arrayContaining(["cookie", "x-eigen", "x-nonce"]));
    expect(keys).not.toContain("x-weg");
    expect(res.headers.get("x-middleware-request-cookie")).toBe("neu=1");
  });

  it("off: Antwort unverändert, kein Header", async () => {
    const res = await withCsp(async () => next(), { env: { CSP_MODE: "off" } })(req("https://x.test/"));
    expect(res.headers.get("content-security-policy")).toBeNull();
    expect(res.headers.get("content-security-policy-report-only")).toBeNull();
    expect(res.headers.get("x-middleware-override-headers")).toBeNull();
  });
});
