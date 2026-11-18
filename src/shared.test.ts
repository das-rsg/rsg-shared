import { describe, expect, it } from "vitest";
import {
  checkTestLogin,
  devLoginEnabled,
  hashPassword,
  identityProviderId,
  providerKind,
  rolesFromSignIn,
  schoolLoginConfigured,
  schoolProviders,
  stableUserKey,
  testLoginEnabled,
  verifyPassword,
} from "./auth";
import { effectiveRole, parseRoles } from "./roles";

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
