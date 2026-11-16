/**
 * Schmale Leiste „← Weblehrerzimmer“ für den Seitenanfang jeder App.
 * Ziel: NEXT_PUBLIC_PORTAL_URL (lokal Standard http://localhost:3000).
 * Gestaltung über die Klasse .rsg-portal-link aus rsg-shared/theme.css.
 */
export function PortalLink({ href }: { href?: string }) {
  const target = href ?? process.env.NEXT_PUBLIC_PORTAL_URL ?? "http://localhost:3000";
  return (
    <nav className="rsg-portal-link" aria-label="Weblehrerzimmer">
      <a href={target}>
        <span aria-hidden="true">←</span> Weblehrerzimmer
      </a>
    </nav>
  );
}
