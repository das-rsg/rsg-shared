# rsg-shared

Gemeinsame Bausteine der Web-Apps des Rhein-Sieg-Gymnasiums: Design, Rollen und Login. Hier liegt nur, was wirklich geteilt wird. Es gibt keine Geheimnisse und keine Daten.

| Import | Inhalt |
|---|---|
| `rsg-shared/roles` | Rollen `Lehrkraft` / `Schueler`, `parseRoles`, `effectiveRole`, `ROLE_LABELS` |
| `rsg-shared/auth` | `schoolProviders()`, `identityProviderId()`, `rolesFromSignIn()`, `stableUserKey()`, Dev-Login |
| `rsg-shared/portal-link` | Leiste „← Weblehrerzimmer“ (`<PortalLink />`) |
| `rsg-shared/test-banner` | Hinweis „Testsystem“ (`<TestBanner />`, nur mit `TESTSYSTEM=true`) |
| `rsg-shared/portal-link.css` | nur das CSS der Leiste, für Apps ohne RSG-Design (in `theme.css` schon enthalten) |
| `rsg-shared/theme.css` | RSG-Farben, Schriften, iPad-Grundregeln, Tailwind-4-Tokens |

## Einbinden

```bash
npm install github:das-rsg/rsg-shared#v0.3.0
```

`next.config.ts`:
```ts
const nextConfig = { transpilePackages: ["rsg-shared"] };
```

`app/globals.css`:
```css
@import "tailwindcss";
@import "rsg-shared/theme.css";
```

`auth.ts` (Auth.js v5):
```ts
import NextAuth from "next-auth";
import { parseRoles } from "rsg-shared/roles";
import { rolesFromSignIn, schoolProviders } from "rsg-shared/auth";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: schoolProviders(),
  session: { strategy: "jwt" },
  callbacks: {
    jwt({ token, account, profile, user }) {
      const roles = rolesFromSignIn({ account, profile, user });
      if (roles) token.roles = roles;
      return token;
    },
    session({ session, token }) {
      session.user.roles = parseRoles(token.roles);
      return session;
    },
  },
});
```

Die Login-Seite ruft `signIn(identityProviderId())` auf.

## Login-Dienst wechseln

| `AUTH_PROVIDER` | Dienst | Variablen |
|---|---|---|
| `entra` (Standard) | Microsoft Entra ID | `AUTH_MICROSOFT_ENTRA_ID_ID`, `_SECRET`, `_ISSUER` |
| `keycloak` | eigener Login-Dienst (Ausweichzweig ohne Microsoft) | `AUTH_KEYCLOAK_ID`, `_SECRET`, `_ISSUER` |

Beide liefern die Rollen im Claim `roles`. In Entra sind das App-Rollen, in Keycloak ein Protocol-Mapper.

## Regeln für die Umzugsfähigkeit
- Nur Standard-OpenID-Connect, keine Graph API.
- Rollen nur über `rolesFromSignIn`/`parseRoles`. Ohne Rolle gibt es keinen Zugriff, und niemand wird stillschweigend zur Schüler:in.
- Eigene Daten über `stableUserKey()` (E-Mail) verknüpfen, nie über die Entra-`oid`.

## Version veröffentlichen

```bash
npm test && git tag vX.Y.Z && git push --tags
```

Danach in den Apps die Version in `package.json` anheben.

## Testsystem mit Passwort-Login

Für ein Testsystem ohne Microsoft-Login (z.B. `webapps.das-rsg.de`) gibt es einen Testlogin mit Benutzername und Passwort. Er ist auch in Produktion aktiv, aber nur, wenn **beide** Variablen gesetzt sind:

| Variable | Inhalt |
|---|---|
| `TEST_LOGIN_USER` | Benutzername, z.B. `test` |
| `TEST_LOGIN_PASSWORD_HASH` | Hash, nie das Passwort selbst: `node -e 'import("rsg-shared/auth").then(m => console.log(m.hashPassword(process.argv[1])))' 'PASSWORT'` |
| `TEST_LOGIN_NAME` | Anzeigename (Standard „Testlehrkraft“) |
| `TEST_LOGIN_EMAIL` | Kennung für die Daten (Standard `<user>@test.local`) |
| `TESTSYSTEM=true` | zeigt `<TestBanner />` („nur Fantasiedaten“) |

Die Testperson hat immer die Rolle `Lehrkraft`. Die Login-Seite ruft `signIn("test", { username, password })` auf; `schoolLoginConfigured()` sagt, ob der Knopf „Mit Schulkonto anmelden“ angezeigt werden soll.

**Mehrere Apps unter einer Domain** (Unterpfade): Alle Apps nutzen dasselbe `AUTH_SECRET`, dann gilt eine Anmeldung für alle. Die Tokens müssen dafür verträglich sein (Rollen in `token.roles`, E-Mail in `token.email`).
