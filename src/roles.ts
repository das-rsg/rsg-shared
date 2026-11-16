/**
 * Rollen der RSG-Web-Apps. Sie kommen als Claim `roles` aus dem Login
 * (heute Entra-App-Rollen, später ggf. Keycloak) und heißen überall gleich.
 */
export const ROLES = ["Lehrkraft", "Schueler"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  Lehrkraft: "Lehrkraft",
  Schueler: "Schüler:in",
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** Liest die bekannten Rollen aus einem Token-Claim; Unbekanntes wird verworfen. */
export function parseRoles(claim: unknown): Role[] {
  const values = Array.isArray(claim) ? claim : typeof claim === "string" ? [claim] : [];
  return [...new Set(values.filter(isRole))];
}

/**
 * Welche Rolle bestimmt die Ansicht? Lehrkräfte können zur Kontrolle
 * die Schüleransicht einschalten; Schüler:innen nie die Lehreransicht.
 */
export function effectiveRole(roles: Role[], wantsStudentView: boolean): Role | null {
  if (roles.includes("Lehrkraft")) return wantsStudentView ? "Schueler" : "Lehrkraft";
  if (roles.includes("Schueler")) return "Schueler";
  return null;
}
