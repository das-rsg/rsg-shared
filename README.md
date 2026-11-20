# rsg-shared

Gemeinsame Bausteine der Web-Apps des Rhein-Sieg-Gymnasiums: Design, Rollen und Login. Hier liegt nur, was wirklich geteilt wird. Es gibt keine Geheimnisse und keine Daten.

| Import | Inhalt |
|---|---|
| `rsg-shared/roles` | Rollen `Lehrkraft` / `Schueler`, `parseRoles`, `effectiveRole`, `ROLE_LABELS` |
| `rsg-shared/auth` | `schoolProviders()`, `identityProviderId()`, `rolesFromSignIn()`, `personFromSignIn()`, `stableUserKey()`, Dev- und Testlogin |
| `rsg-shared/login-redirect` | `loginRedirect()` und `safeCallbackPath()`: Login-Umleitung unter einem Unterpfad mit sicherem Rücksprung |
| `rsg-shared/csp` | `withCsp()`: Nonce-Content-Security-Policy für den Proxy, Modus per `CSP_MODE` |
| `rsg-shared/portal-link` | Leiste „← Weblehrerzimmer“ (`<PortalLink />`) |
| `rsg-shared/test-banner` | Hinweis „Testsystem“ (`<TestBanner />`, nur mit `TESTSYSTEM=true`) |
| `rsg-shared/portal-link.css` | nur das CSS der Leiste, für Apps ohne RSG-Design (in `theme.css` schon enthalten) |
| `rsg-shared/theme.css` | RSG-Farben, Schriften, iPad-Grundregeln, Tailwind-4-Tokens |

## Einbinden

```bash
npm install github:das-rsg/rsg-shared#v0.5.1
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

## Content-Security-Policy (ab v0.5.0)

Alle Apps teilen sich die Origin `webapps.das-rsg.de`. Eine XSS-Lücke in einer App reicht deshalb bis an das gemeinsame Session-Cookie. Deshalb bekommt jede Next-App dieselbe Nonce-CSP.

`proxy.ts` (statt `export { auth as proxy } from "@/auth"`):
```ts
import { withCsp } from "rsg-shared/csp";
import { auth } from "@/auth";

export const proxy = withCsp(auth, { publicPaths: ["/login"] });
export const config = {
  // "/" extra: Unter einem Unterpfad (basePath) trifft das zweite Muster die nackte Startseite
  // (/anwesenheit ohne Schrägstrich) nicht – sie bliebe sonst ohne CSP und ohne Proxy.
  // Login NICHT mehr ausnehmen (sonst fehlt dort die CSP). Prefetches nicht ausnehmen (sonst ohne Login-Schutz).
  matcher: ["/", "/((?!api/auth|_next/static|_next/image|favicon.ico|manifest.webmanifest).*)"],
};
```

`app/layout.tsx`: `await connection()` (aus `next/server`) im Root-Layout. Nur dynamisch gerenderte Seiten bekommen die Nonce. Statische Seiten (z.B. `/_not-found`) hätten sonst blockierte Skripte. Im Build-Log muss jede Seite `ƒ` sein.

| `CSP_MODE` | Wirkung |
|---|---|
| `report` (Standard) | `Content-Security-Policy-Report-Only`: blockiert nichts, Verstöße erscheinen in der Browser-Konsole |
| `enforce` | `Content-Security-Policy`: Verstöße werden blockiert |
| `off` | kein Header |

- **Policy:**
  - `script-src 'self' 'nonce-…' 'strict-dynamic'` (nur in der Entwicklung zusätzlich `'unsafe-eval'`)
  - `style-src 'self' 'unsafe-inline'`
  - `form-action 'self' https://login.microsoftonline.com`
  - `frame-ancestors 'none'`
  - `object-src 'none'`
  - Rest `'self'`

  Optionen: `formAction` (z.B. Keycloak-Host), `connectSrc`, `frameSelf`, `publicPaths` (exakt oder `"/scan/*"`).
- **Warum ein Wrapper:** `withCsp` umschließt den fertigen Auth-Proxy und ändert dessen Entscheidung nicht. Bitte nicht `auth((req) => …)` mit eigener Funktion verwenden: Auth.js ruft die Funktion auch dann auf, wenn `authorized` `false` liefert.
- **e2e:** Mit `CSP_MODE=enforce` laufen lassen und Konsolenmeldungen „Refused to …“ bzw. `securitypolicyviolation` als Fehler werten (Vorlage: `e2e/csp.ts` im Portal, mit `watchCsp(page)` für weitere Browser-Kontexte).
- **Prüfung gegen den Produktions-Build (Pflicht in der CI, ab v0.5.1):** Die e2e laufen unter `next dev`. Dort erlaubt die Policy `'unsafe-eval'`, deshalb fällt eval im Client-Bundle nur in Produktion auf (Beispiel: zod v4 prüft per `Function("")`, ob JIT geht – zod nicht in Client-Komponenten importieren, auch nicht für Konstanten). Nach `next build`:
  ```yaml
  - name: CSP-Prüfung gegen den Prod-Build
    run: |
      npx rsg-csp-check --dir .next
      CSP_MODE=enforce npx next start -p 3900 &
      npx rsg-csp-check --url http://localhost:3900 --paths /,/login --wait 60
  ```
  Die Prüfung schlägt fehl bei eval / `new Function` / `Function("")` in Client-Chunks, bei einem fehlenden CSP-Header und bei einem `<script>` ohne die Nonce aus dem Header. Weitere Seiten über `--paths`, `--expect report|any` für den Beobachtungsmodus.
- **Nach jedem Next.js-Update:** e2e mit `enforce` und `rsg-csp-check` sind Pflicht. `withCsp` reicht die Nonce über die internen Next-Header `x-middleware-next`, `x-middleware-override-headers` und `x-middleware-request-*` weiter. Ändert Next die, fehlt die Nonce stillschweigend, und unter `enforce` bricht die Seite (fail-closed: keine Lücke, aber kaputt).
- **Unbekannter `CSP_MODE`** (Tippfehler) fällt mit einer Warnung im Log auf `report` zurück.
- **Safari/iPad:** Report-Only ohne `report-to` wertet WebKit nicht aus, Verstöße erscheinen dort nicht in der Konsole. Den Beobachtungsmodus deshalb in Chrome mit offenen DevTools prüfen. Einen öffentlichen Report-Endpunkt gibt es bewusst nicht (unauthentifiziert, Log-Flut).

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

Diese Testperson hat immer die Rolle `Lehrkraft`.

**Weitere Testkonten** (ab v0.4.0), z.B. Schüler:innen, stehen in `TEST_LOGIN_ACCOUNTS`: Konten getrennt durch `;`, Felder durch `|`:

```
TEST_LOGIN_ACCOUNTS='schueler1|Schueler|scrypt$…$…|Mia|Muster|7b;schueler2|Schueler|scrypt$…$…|Ben|Beispiel|7b'
```

Felder: Benutzername, Rolle (`Lehrkraft` | `Schueler`), Passwort-Hash, optional Vorname, Nachname, Klasse. Die E-Mail ist `<benutzername>@test.local`. Ungültige Einträge werden ignoriert. In Compose die ganze Zeile in einfache Anführungszeichen setzen (wegen `$`). Unbekannte Benutzernamen kosten dieselbe Rechenzeit wie bekannte.

**Vor- und Nachname, Klasse** (ab v0.4.0): `personFromSignIn({ account, profile, user })` im jwt-Callback liefert `givenName`, `familyName` und – beim Testlogin – `classCode`. Beim Schul-Login stammen die Namen aus den OIDC-Claims `given_name`/`family_name`; eine Klasse liefert er noch nicht. Die App legt die Werte selbst ins Token und in die Session.

**Login-Umleitung unter Unterpfad** (ab v0.4.0): Auth.js verliert im `authorized`-Callback den basePath (`/lehrerheft/raeume` → `/login`). Abhilfe:

```ts
import { loginRedirect, safeCallbackPath } from "rsg-shared/login-redirect";
// auth.ts
authorized({ auth, request }) { return auth?.user ? true : loginRedirect(request.nextUrl, BASE_PATH); }
// Login-Seite: Rücksprung nur geprüft übernehmen (BASE_PATH abziehen, wenn redirect() ihn selbst setzt)
const target = safeCallbackPath(searchParams.callbackUrl, BASE_PATH);
```

Die Login-Seite ruft `signIn("test", { username, password })` auf; `schoolLoginConfigured()` sagt, ob der Knopf „Mit Schulkonto anmelden“ angezeigt werden soll.

**Mehrere Apps unter einer Domain** (Unterpfade): Alle Apps nutzen dasselbe `AUTH_SECRET`, dann gilt eine Anmeldung für alle. Die Tokens müssen dafür verträglich sein (Rollen in `token.roles`, E-Mail in `token.email`).
