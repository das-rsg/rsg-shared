/**
 * Hinweisleiste „Testsystem“ für den Seitenanfang. Erscheint nur mit TESTSYSTEM=true
 * (zur Laufzeit gelesen, also nur in Server-Komponenten verwenden).
 */
export function TestBanner({ show }: { show?: boolean }) {
  if (!(show ?? process.env.TESTSYSTEM === "true")) return null;
  return (
    <p className="rsg-test-banner" role="note">
      Testsystem – nur Fantasiedaten eintragen, keine echten Schülerdaten.
    </p>
  );
}
