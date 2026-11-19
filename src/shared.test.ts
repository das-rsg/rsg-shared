import { describe, expect, it } from "vitest";
import {
  checkTestLogin,
  devLoginEnabled,
  hashPassword,
  identityProviderId,
  personFromSignIn,
  providerKind,
  testAccounts,
  rolesFromSignIn,
  schoolLoginConfigured,
  schoolProviders,
  stableUserKey,
  testLoginEnabled,
  verifyPassword,
} from "./auth";
import { loginRedirect, safeCallbackPath } from "./login-redirect";
import { effectiveRole, parseRoles } from "./roles";

describe("Mehrere Testkonten (TEST_LOGIN_ACCOUNTS)", () => {
  const h1 = hashPassword("geheim1", Buffer.alloc(16, 1));
  const h2 = hashPassword("geheim2", Buffer.alloc(16, 2));
  const env = {
    TEST_LOGIN_USER: "test",
    TEST_LOGIN_PASSWORD_HASH: h1,
    TEST_LOGIN_ACCOUNTS: `schueler1|Schueler|${h2}|Mia|Muster|7b; kaputt|Admin|${h2}; ohnehash|Schueler|nix; Test|Schueler|${h2}`,
  };

  it("liest das bisherige Konto und gültige weitere Konten, ignoriert ungültige und doppelte", () => {
    expect(testAccounts(env).map((a) => `${a.username}:${a.role}`)).toEqual(["test:Lehrkraft", "schueler1:Schueler"]);
  });

  it("meldet Schüler:in mit Rolle, Namen, Klasse und Test-E-Mail an", () => {
    expect(checkTestLogin(" Schueler1 ", "geheim2", env)).toEqual({
      id: "test-schueler1",
      name: "Mia Muster",
      email: "schueler1@test.local",
      roles: ["Schueler"],
      givenName: "Mia",
      familyName: "Muster",
      classCode: "7b",
    });
  });

  it("lehnt falsches Passwort, fremdes Passwort und unbekannte Benutzer ab", () => {
    expect(checkTestLogin("schueler1", "geheim1", env)).toBeNull();
    expect(checkTestLogin("test", "geheim2", env)).toBeNull();
    expect(checkTestLogin("niemand", "geheim2", env)).toBeNull();
  });

  it("verwirft ein Zusatzkonto mit derselben E-Mail wie das bisherige Konto", () => {
    const clash = { ...env, TEST_LOGIN_EMAIL: "lehrer@test.local", TEST_LOGIN_ACCOUNTS: `lehrer|Schueler|${h2}` };
    expect(testAccounts(clash).map((a) => a.email)).toEqual(["lehrer@test.local"]);
    expect(checkTestLogin("lehrer", "geheim2", clash)).toBeNull();
  });

  it("aktiviert den Testlogin auch nur mit TEST_LOGIN_ACCOUNTS", () => {
    expect(testLoginEnabled({ TEST_LOGIN_ACCOUNTS: `s|Schueler|${h2}` })).toBe(true);
    expect(testLoginEnabled({ TEST_LOGIN_ACCOUNTS: "s|Schueler|" })).toBe(false);
  });
});

describe("personFromSignIn", () => {
  it("liest given_name/family_name aus dem Schul-Login", () => {
    expect(
      personFromSignIn({ account: { provider: "microsoft-entra-id" } as never, profile: { given_name: " Lena ", family_name: "Müller-Schmidt" } }),
    ).toEqual({ givenName: "Lena", familyName: "Müller-Schmidt" });
  });
  it("übernimmt beim Testlogin Namen und Klasse aus dem Konto", () => {
    expect(
      personFromSignIn({ account: { provider: "test" } as never, user: { givenName: "Mia", familyName: "Muster", classCode: "7b" } as never }),
    ).toEqual({ givenName: "Mia", familyName: "Muster", classCode: "7b" });
  });
  it("gibt ohne Anmeldevorgang undefined zurück", () => {
    expect(personFromSignIn({ account: null })).toBeUndefined();
  });
});

describe("Login-Weiterleitung unter Unterpfad", () => {
  it("lässt nur Pfade innerhalb des Unterpfads zu", () => {
    expect(safeCallbackPath("/anwesenheit/bestaetigen/abc?x=1", "/anwesenheit")).toBe("/anwesenheit/bestaetigen/abc?x=1");
    for (const bad of [
      "https://evil.example/anwesenheit/",
      "//evil.example/anwesenheit",
      "/anwesenheit/../lehrerheft/raeume",
      "/lehrerheft/raeume",
      "/anwesenheit\\..\\x",
      "javascript:alert(1)",
      "/anwesenheit/login",
      "/anwesenheit/api/auth/signout",
      "/anwesenheitX/",
    ]) {
      expect(safeCallbackPath(bad, "/anwesenheit"), bad).toBe("/anwesenheit/");
    }
  });

  it("ohne Unterpfad (Portal) bleibt der Schutz vor fremden Origins", () => {
    expect(safeCallbackPath("/lehrerheft/raeume", "")).toBe("/lehrerheft/raeume");
    expect(safeCallbackPath("//evil.example", "")).toBe("/");
    expect(safeCallbackPath("/login", "")).toBe("/");
  });

  it("leitet auf die Login-Seite der App um und behält den Rücksprung", () => {
    const env = { AUTH_URL: "https://webapps.das-rsg.de/lehrerheft/api/auth" };
    const res = loginRedirect(new URL("http://intern-host:3000/lehrerheft/raeume?id=3"), "/lehrerheft", "/login", env);
    expect(res.status).toBe(307);
    const to = new URL(res.headers.get("location")!);
    // Origin aus AUTH_URL, nicht aus der Anfrage
    expect(to.origin + to.pathname).toBe("https://webapps.das-rsg.de/lehrerheft/login");
    expect(to.searchParams.get("callbackUrl")).toBe("/lehrerheft/raeume?id=3");
    // ohne AUTH_URL (lokal): Origin der Anfrage
    const local = new URL(loginRedirect(new URL("http://localhost:3004/lehrerheft/x"), "/lehrerheft", "/login", {}).headers.get("location")!);
    expect(local.origin).toBe("http://localhost:3004");
  });
});

describe("Rollen", () => {
  it("liest nur bekannte Rollen aus dem Token", () => {
    expect(parseRoles(["Lehrkraft", "Admin", "Lehrkraft"])).toEqual(["Lehrkraft"]);
    expect(parseRoles("Schueler")).toEqual(["Schueler"]);
    expect(parseRoles(undefined)).toEqual([]);
    expect(parseRoles({ roles: ["Lehrkraft"] })).toEqual([]);
  });

  it("Lehrkräfte dürfen die Schüleransicht, Schüler:innen nie die Lehreransicht", () => {
    expect(effectiveRole(["Lehrkraft"], true)).toBe("Schueler");
    expect(effectiveRole(["Lehrkraft"], false)).toBe("Lehrkraft");
    expect(effectiveRole(["Schueler"], false)).toBe("Schueler");
    expect(effectiveRole([], false)).toBeNull();
  });
});

describe("Login-Dienst wählen", () => {
  it("Standard ist Entra ID", () => {
    expect(providerKind({})).toBe("entra");
    expect(identityProviderId({})).toBe("microsoft-entra-id");
  });

  it("Keycloak per AUTH_PROVIDER (Ausweichzweig ohne Microsoft)", () => {
    expect(providerKind({ AUTH_PROVIDER: "Keycloak" })).toBe("keycloak");
    expect(identityProviderId({ AUTH_PROVIDER: "keycloak" })).toBe("keycloak");
  });

  it("Tippfehler fallen sofort auf", () => {
    expect(() => providerKind({ AUTH_PROVIDER: "logineo" })).toThrow(/unbekannt/);
  });
});

describe("Dev-Login", () => {
  it("nur lokal und nur mit DEV_LOGIN=true", () => {
    expect(devLoginEnabled({ DEV_LOGIN: "true", NODE_ENV: "development" })).toBe(true);
    expect(devLoginEnabled({ DEV_LOGIN: "true", NODE_ENV: "production" })).toBe(false);
    expect(devLoginEnabled({ NODE_ENV: "development" })).toBe(false);
  });

  it("wird in Produktion nie als Provider angeboten", () => {
    expect(schoolProviders({ DEV_LOGIN: "true", NODE_ENV: "production" })).toHaveLength(1);
    expect(schoolProviders({ DEV_LOGIN: "true", NODE_ENV: "development" })).toHaveLength(2);
  });
});

describe("rolesFromSignIn", () => {
  const account = (provider: string) => ({ provider, type: "oidc", providerAccountId: "x" }) as never;

  it("nimmt bei Entra/Keycloak den Claim roles aus dem Profil", () => {
    expect(rolesFromSignIn({ account: account("microsoft-entra-id"), profile: { roles: ["Lehrkraft"] } })).toEqual(["Lehrkraft"]);
    expect(rolesFromSignIn({ account: account("keycloak"), profile: { roles: ["Schueler", "offline_access"] } })).toEqual(["Schueler"]);
  });

  it("ohne Rolle im Profil gibt es keine Rolle – kein stilles Schüler:in-Fallback", () => {
    expect(rolesFromSignIn({ account: account("microsoft-entra-id"), profile: {} })).toEqual([]);
  });

  it("nimmt beim Dev-Login die gewählte Rolle", () => {
    expect(rolesFromSignIn({ account: account("dev"), user: { id: "1", roles: ["Schueler"] } as never })).toEqual(["Schueler"]);
  });

  it("ändert bei Token-Auffrischung nichts", () => {
    expect(rolesFromSignIn({})).toBeUndefined();
  });
});

describe("stableUserKey", () => {
  it("nutzt die E-Mail, klein geschrieben", () => {
    expect(stableUserKey({ email: " Max.Muster@DAS-RSG.de " })).toBe("max.muster@das-rsg.de");
    expect(stableUserKey({ preferred_username: "Lena@das-rsg.de" })).toBe("lena@das-rsg.de");
    expect(stableUserKey({})).toBeNull();
  });
});

describe("Testlogin", () => {
  const env = { TEST_LOGIN_USER: "Test", TEST_LOGIN_PASSWORD_HASH: hashPassword("geheim-123"), NODE_ENV: "production" };

  it("ist nur mit Benutzer und Hash aktiv – auch in Produktion", () => {
    expect(testLoginEnabled({})).toBe(false);
    expect(testLoginEnabled({ TEST_LOGIN_USER: "test", TEST_LOGIN_PASSWORD_HASH: "geheim" })).toBe(false);
    expect(testLoginEnabled(env)).toBe(true);
    expect(schoolProviders(env)).toHaveLength(2);
  });

  it("prüft Benutzername (ohne Groß/klein) und Passwort", () => {
    expect(checkTestLogin("test", "geheim-123", env)).toMatchObject({ email: "test@test.local", roles: ["Lehrkraft"] });
    expect(checkTestLogin(" TEST ", "geheim-123", env)).not.toBeNull();
    expect(checkTestLogin("test", "geheim-12", env)).toBeNull();
    expect(checkTestLogin("andere", "geheim-123", env)).toBeNull();
    expect(checkTestLogin("test", undefined, env)).toBeNull();
  });

  it("speichert das Passwort nur als Hash mit Salz", () => {
    const a = hashPassword("x");
    expect(a).toMatch(/^scrypt\$/);
    expect(a).not.toBe(hashPassword("x"));
    expect(verifyPassword("x", a)).toBe(true);
    expect(verifyPassword("y", a)).toBe(false);
    expect(verifyPassword("x", "kaputt")).toBe(false);
  });

  it("übernimmt die Rolle Lehrkraft aus dem Testnutzer", () => {
    const account = { provider: "test", type: "credentials", providerAccountId: "x" } as never;
    expect(rolesFromSignIn({ account, profile: {} as never, user: { id: "1", roles: ["Lehrkraft"] } as never })).toEqual(["Lehrkraft"]);
  });

  it("Schul-Login-Knopf nur, wenn eingerichtet", () => {
    expect(schoolLoginConfigured({})).toBe(false);
    expect(schoolLoginConfigured({ AUTH_MICROSOFT_ENTRA_ID_ID: "x" })).toBe(true);
    expect(schoolLoginConfigured({ AUTH_PROVIDER: "keycloak", AUTH_KEYCLOAK_ID: "x" })).toBe(true);
  });
});
