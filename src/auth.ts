/**
 * Login-Bausteine für alle RSG-Apps (Auth.js v5).
 *
 * Welcher Login-Dienst genutzt wird, entscheidet nur die Umgebungsvariable
 * AUTH_PROVIDER ("entra" = Standard, "keycloak" = Ausweichzweig ohne Microsoft).
 * Die Apps selbst bleiben dadurch unverändert, wenn die Schule umzieht.
 */
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

/** Alle Provider einer App: Schul-Login, lokal zusätzlich der Dev-Login. */
export function schoolProviders(env: Env = process.env): Provider[] {
  return devLoginEnabled(env) ? [identityProvider(env), devLoginProvider()] : [identityProvider(env)];
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
  if (account && account.provider !== "dev" && profile) return parseRoles(profile.roles);
  if (user && "roles" in user) return parseRoles(user.roles);
  return undefined;
}

/**
 * Stabile Kennung für die Verknüpfung mit eigenen Daten: die E-Mail (klein geschrieben).
 * Bewusst nicht die Entra-oid – die gäbe es nach einem Umzug nicht mehr.
 */
export function stableUserKey(profileOrUser: { email?: string | null; preferred_username?: unknown }): string | null {
  const raw = profileOrUser.email ?? (typeof profileOrUser.preferred_username === "string" ? profileOrUser.preferred_username : null);
  return raw ? raw.trim().toLowerCase() : null;
}
