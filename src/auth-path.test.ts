import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { authAppPrefix, authBasePath, authRouteHandlers, withAppPrefix } from "./auth-path";

describe("authBasePath / authAppPrefix", () => {
  it("nimmt den Pfad aus AUTH_URL", () => {
    const env = { AUTH_URL: "https://webapps.das-rsg.de/lehrerheft/api/auth" };
    expect(authBasePath(env)).toBe("/lehrerheft/api/auth");
    expect(authAppPrefix(env)).toBe("/lehrerheft");
  });
  it("Portal und lokale Entwicklung: /api/auth ohne Präfix", () => {
    expect(authBasePath({ AUTH_URL: "https://webapps.das-rsg.de/api/auth" })).toBe("/api/auth");
    expect(authBasePath({})).toBe("/api/auth");
    expect(authAppPrefix({})).toBe("");
  });
  it("Schrägstrich am Ende und NEXTAUTH_URL", () => {
    expect(authBasePath({ NEXTAUTH_URL: "http://localhost:8088/anwesenheit/api/auth/" })).toBe("/anwesenheit/api/auth");
  });
  it("ungültige oder unpassende AUTH_URL fällt auf /api/auth zurück", () => {
    for (const AUTH_URL of ["kaputt", "https://x.de/lehrerheft", "https://x.de/a/../api/auth", "https://x.de/a%2F/api/auth", "https://x.de/a b/api/auth"]) {
      expect(authBasePath({ AUTH_URL }), AUTH_URL).toBe("/api/auth");
    }
  });
});

describe("withAppPrefix", () => {
  it("setzt den Präfix vor, Query bleibt", () => {
    const u = withAppPrefix(new URL("http://h/api/auth/callback/x?code=1"), "/lehrerheft");
    expect(u.href).toBe("http://h/lehrerheft/api/auth/callback/x?code=1");
  });
  it("lässt vorhandenen Präfix und leeren Präfix unverändert", () => {
    const a = new URL("http://h/lehrerheft/api/auth/session");
    expect(withAppPrefix(a, "/lehrerheft")).toBe(a);
    const b = new URL("http://h/api/auth/session");
    expect(withAppPrefix(b, "")).toBe(b);
  });
  it("verwechselt ähnliche Präfixe nicht", () => {
    expect(withAppPrefix(new URL("http://h/lehrerheft2/api/auth"), "/lehrerheft").pathname).toBe("/lehrerheft/lehrerheft2/api/auth");
  });
});

describe("authRouteHandlers", () => {
  const seen: string[] = [];
  const h = {
    GET: async (req: NextRequest) => (seen.push(`GET ${new URL(req.url).pathname}`), new Response("ok")),
    POST: async (req: NextRequest) => (seen.push(`POST ${new URL(req.url).pathname} ${await req.text()}`), new Response("ok")),
  };
  it("reicht die Anfrage mit Präfix weiter, inkl. Body", async () => {
    seen.length = 0;
    const r = authRouteHandlers(h, { AUTH_URL: "https://x.de/klassenarbeitsplan/api/auth" });
    await r.GET(new NextRequest("https://x.de/api/auth/providers"));
    await r.POST(new NextRequest("https://x.de/api/auth/signin/test", { method: "POST", body: "csrfToken=abc" }));
    expect(seen).toEqual(["GET /klassenarbeitsplan/api/auth/providers", "POST /klassenarbeitsplan/api/auth/signin/test csrfToken=abc"]);
  });
  it("ohne Präfix sind es die Original-Handler", () => {
    expect(authRouteHandlers(h, { AUTH_URL: "https://x.de/api/auth" })).toBe(h);
    expect(authRouteHandlers(h, {})).toBe(h);
  });
});
