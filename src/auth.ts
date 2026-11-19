/**
 * Login-Bausteine für alle RSG-Apps (Auth.js v5).
 *
 * Welcher Login-Dienst genutzt wird, entscheidet nur die Umgebungsvariable
 * AUTH_PROVIDER ("entra" = Standard, "keycloak" = Ausweichzweig ohne Microsoft).
 * Die Apps selbst bleiben dadurch unverändert, wenn die Schule umzieht.
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Account, Profile, User } from "next-auth";
import type { Provider } from "next-auth/providers";
import Credentials from "next-auth/providers/credentials";
import Keycloak from "next-auth/providers/keycloak";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { isRole, parseRoles, type Role } from "./roles";

export type ProviderKind = "entra" | "keycloak";

type Env = Record<string, string | undefined>;

export function providerKind(env: Env = process.env): ProviderKind {
  const value = (env.AUTH_PROVIDER ?? "entra").toLowerCase();
  if (value === "entra" || value === "keycloak") return value;
  throw new Error(`AUTH_PROVIDER="${env.AUTH_PROVIDER}" ist unbekannt (erlaubt: entra, keycloak)`);
}

/** Provider-ID für signIn(), z.B. signIn(identityProviderId()) auf der Login-Seite. */
export function identityProviderId(env: Env = process.env): string {
  return providerKind(env) === "keycloak" ? "keycloak" : "microsoft-entra-id";
}

/**
 * Der Schul-Login. Konfiguration über die Standard-Variablen von Auth.js:
 * entra:    AUTH_MICROSOFT_ENTRA_ID_ID / _SECRET / _ISSUER
 * keycloak: AUTH_KEYCLOAK_ID / _SECRET / _ISSUER
 */
export function identityProvider(env: Env = process.env): Provider {
  return providerKind(env) === "keycloak" ? Keycloak : MicrosoftEntraID;
}

/** Dev-Login nur lokal: niemals in Produktion, egal was in der .env steht. */
export function devLoginEnabled(env: Env = process.env): boolean {
  return env.DEV_LOGIN === "true" && env.NODE_ENV !== "production";
}

/** Login ohne Microsoft mit frei wählbarer Rolle – nur für Entwicklung und Tests. */
export function devLoginProvider(): Provider {
  return Credentials({
    id: "dev",
    name: "Dev-Login",
    credentials: { name: { label: "Name" }, role: { label: "Rolle" } },
    async authorize(credentials) {
      const name = String(credentials?.name ?? "").trim() || "Test";
      const role = credentials?.role;
      if (!isRole(role)) return null;
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, ".");
      return { id: `dev-${slug}`, name, email: `${slug}@dev.local`, roles: [role] };
    },
  });
}

/** Ist der Schul-Login (Entra bzw. Keycloak) eingerichtet? Sonst zeigt die Login-Seite den Knopf nicht. */
export function schoolLoginConfigured(env: Env = process.env): boolean {
  return providerKind(env) === "keycloak" ? !!env.AUTH_KEYCLOAK_ID : !!env.AUTH_MICROSOFT_ENTRA_ID_ID;
}

/** Ein Testkonto: Rolle und Namen stehen in der .env, das Passwort nur als Hash. */
export type TestAccount = {
  username: string;
  role: Role;
  hash: string;
  name: string;
  email: string;
  givenName?: string;
  familyName?: string;
  classCode?: string;
};

/**
 * Alle Testkonten aus der .env:
 * - TEST_LOGIN_USER / _PASSWORD_HASH / _NAME / _EMAIL: ein Konto mit Rolle Lehrkraft (wie bisher)
 * - TEST_LOGIN_ACCOUNTS: weitere Konten, getrennt durch ";", Felder getrennt durch "|":
 *   benutzer|Rolle|scrypt$…$…|Vorname|Nachname|Klasse   (Vorname, Nachname, Klasse optional)
 * Ungültige Einträge (unbekannte Rolle, kein scrypt-Hash, doppelter Benutzername) werden ignoriert.
 */
export function testAccounts(env: Env = process.env): TestAccount[] {
  const out: TestAccount[] = [];
  const seen = new Set<string>();
  const add = (a: TestAccount) => {
    if (!a.username || seen.has(a.username) || !a.hash.startsWith("scrypt$")) return;
    seen.add(a.username);
    out.push(a);
  };
  const legacy = (env.TEST_LOGIN_USER ?? "").trim().toLowerCase();
  if (legacy) {
    add({
      username: legacy,
      role: "Lehrkraft",
      hash: env.TEST_LOGIN_PASSWORD_HASH ?? "",
      name: env.TEST_LOGIN_NAME?.trim() || "Testlehrkraft",
      email: (env.TEST_LOGIN_EMAIL?.trim() || `${legacy}@test.local`).toLowerCase(),
    });
  }
  for (const entry of (env.TEST_LOGIN_ACCOUNTS ?? "").split(";")) {
    const [user = "", role = "", hash = "", given = "", family = "", cls = ""] = entry.split("|").map((x) => x.trim());
    if (!isRole(role)) continue;
    const username = user.toLowerCase();
    add({
      username,
      role,
      hash,
      name: [given, family].filter(Boolean).join(" ") || username,
      email: `${username}@test.local`,
      ...(given ? { givenName: given } : {}),
      ...(family ? { familyName: family } : {}),
      ...(cls ? { classCode: cls } : {}),
    });
  }
  return out;
}

/**
 * Testlogin mit Benutzername und Passwort – für ein Testsystem ohne Microsoft-Login
 * (auch in Produktion). Aktiv nur, wenn mindestens ein gültiges Testkonto in der .env steht.
 * Das Passwort steht nie im Klartext in der .env, sondern als Hash von hashPassword().
 */
export function testLoginEnabled(env: Env = process.env): boolean {
  return testAccounts(env).length > 0;
}

/** Hash im Format scrypt$<salt>$<hash> (base64url), siehe README „Testsystem“. */
export function hashPassword(password: string, salt: Buffer = randomBytes(16)): string {
  return `scrypt$${salt.toString("base64url")}$${scryptSync(password, salt, 32).toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [kind, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  if (expected.length === 0) return false;
  const actual = scryptSync(password, Buffer.from(salt, "base64url"), expected.length);
  return timingSafeEqual(actual, expected);
}

/** Vergleichs-Hash, damit ein unbekannter Benutzername genauso lange braucht wie ein bekannter. */
const DUMMY_HASH = hashPassword("dummy", Buffer.alloc(16));

function toUser(a: TestAccount) {
  const roles: Role[] = [a.role];
  return {
    id: `test-${a.username}`,
    name: a.name,
    email: a.email,
    roles,
    ...(a.givenName ? { givenName: a.givenName } : {}),
    ...(a.familyName ? { familyName: a.familyName } : {}),
    ...(a.classCode ? { classCode: a.classCode } : {}),
  };
}

/** Die Testperson aus TEST_LOGIN_USER (Rolle Lehrkraft, Kennung TEST_LOGIN_EMAIL) – z.B. für Seeds. */
export function testUser(env: Env = process.env) {
  const user = (env.TEST_LOGIN_USER ?? "").trim().toLowerCase();
  const email = (env.TEST_LOGIN_EMAIL?.trim() || `${user}@test.local`).toLowerCase();
  const roles: Role[] = ["Lehrkraft"];
  return { id: `test-${user}`, name: env.TEST_LOGIN_NAME?.trim() || "Testlehrkraft", email, roles };
}

/** Prüft Benutzername und Passwort gegen alle Testkonten; null bei falschen Angaben. */
export function checkTestLogin(username: unknown, password: unknown, env: Env = process.env) {
  if (typeof username !== "string" || typeof password !== "string") return null;
  const wanted = username.trim().toLowerCase();
  const account = testAccounts(env).find((a) => a.username === wanted);
  // Immer einen scrypt-Vergleich rechnen: die Antwortzeit verrät nicht, ob es den Benutzer gibt
  const ok = verifyPassword(password, account?.hash ?? DUMMY_HASH);
  return account && ok ? toUser(account) : null;
}

/** Provider "test" für signIn("test", { username, password }). */
export function testLoginProvider(env: Env = process.env): Provider {
  return Credentials({
    id: "test",
    name: "Testzugang",
    credentials: { username: { label: "Benutzername" }, password: { label: "Passwort", type: "password" } },
    async authorize(credentials) {
      return checkTestLogin(credentials?.username, credentials?.password, env);
    },
  });
}

/** Alle Provider einer App: Schul-Login, lokal zusätzlich der Dev-Login, im Testsystem der Testlogin. */
export function schoolProviders(env: Env = process.env): Provider[] {
  return [
    identityProvider(env),
    ...(devLoginEnabled(env) ? [devLoginProvider()] : []),
    ...(testLoginEnabled(env) ? [testLoginProvider(env)] : []),
  ];
}

/** Testsystem-Hinweis an? (TESTSYSTEM=true) */
export function isTestSystem(env: Env = process.env): boolean {
  return env.TESTSYSTEM === "true";
}

/**
 * Rollen beim Anmelden ermitteln (im jwt-Callback aufrufen).
 * Gibt undefined zurück, wenn kein Anmeldevorgang stattfindet (Token-Auffrischung).
 */
export function rolesFromSignIn({
  account,
  profile,
  user,
}: {
  account?: Account | null;
  profile?: Profile;
  user?: User | (User & { roles?: unknown });
}): Role[] | undefined {
  if (account && account.provider !== "dev" && account.provider !== "test" && profile) return parseRoles(profile.roles);
  if (user && "roles" in user) return parseRoles(user.roles);
  return undefined;
}

/** Vor-, Nachname und Klasse einer Person, soweit der Login sie liefert. */
export type PersonClaims = { givenName?: string; familyName?: string; classCode?: string };

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/**
 * Vor- und Nachname (und Klasse) beim Anmelden ermitteln – im jwt-Callback aufrufen und ins Token legen.
 * Schul-Login: OIDC-Claims given_name / family_name (Entra liefert sie mit dem Scope "profile").
 * Testlogin: aus TEST_LOGIN_ACCOUNTS. Die Klasse liefert der Schul-Login noch nicht (offen: Entra-Attribut).
 * Gibt undefined zurück, wenn kein Anmeldevorgang stattfindet (Token-Auffrischung).
 */
export function personFromSignIn({
  account,
  profile,
  user,
}: {
  account?: Account | null;
  profile?: Profile;
  user?: User | (User & PersonClaims);
}): PersonClaims | undefined {
  if (!account) return undefined;
  const school = account.provider !== "dev" && account.provider !== "test" && profile;
  const src: Record<string, unknown> = school
    ? { givenName: profile.given_name, familyName: profile.family_name }
    : { ...(user ?? {}) };
  const out: PersonClaims = {};
  const given = text(src.givenName);
  const family = text(src.familyName);
  const cls = text(src.classCode);
  if (given) out.givenName = given;
  if (family) out.familyName = family;
  if (cls) out.classCode = cls;
  return out;
}

/**
 * Stabile Kennung für die Verknüpfung mit eigenen Daten: die E-Mail (klein geschrieben).
 * Bewusst nicht die Entra-oid – die gäbe es nach einem Umzug nicht mehr.
 */
export function stableUserKey(profileOrUser: { email?: string | null; preferred_username?: unknown }): string | null {
  const raw = profileOrUser.email ?? (typeof profileOrUser.preferred_username === "string" ? profileOrUser.preferred_username : null);
  return raw ? raw.trim().toLowerCase() : null;
}
