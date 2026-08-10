/**
 * Role ranking. No database import, so it stays a pure module.
 *
 * The spec's three roles nest: Owner does everything, Manager does products,
 * purchase orders and counts, Staff scans, receives, counts and writes off. A
 * total order is enough — a permission matrix would be more machinery than
 * three roles justify.
 */

export const ROLE_RANK = { staff: 1, manager: 2, owner: 3 } as const;

export type Role = keyof typeof ROLE_RANK;

export function isRole(value: string | null | undefined): value is Role {
  return value !== null && value !== undefined && value in ROLE_RANK;
}

/**
 * Does `role` meet `required`?
 *
 * An unknown role is denied rather than defaulting to staff: a membership row
 * with a role this build does not recognise is a bug, and guessing at it is how
 * a permission check becomes decorative.
 */
export function roleAtLeast(role: string | null | undefined, required: Role): boolean {
  if (!isRole(role)) return false;
  return ROLE_RANK[role] >= ROLE_RANK[required];
}
