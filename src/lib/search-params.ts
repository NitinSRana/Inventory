/**
 * Reading filter state out of the URL.
 *
 * List state lives in `searchParams`, not in component state — that is what
 * makes a filtered view a link someone can send, survive a refresh, and behave
 * under the back button. Next hands every value as `string | string[] |
 * undefined`, and every caller was about to repeat the same two lines.
 *
 * Both functions are total: an absent value, a repeated one, or a value that
 * isn't in the allowed set all come back as `undefined`, so a filter can never
 * be built from something a URL merely asserted.
 */

/** The single value of a param, or undefined. A repeated param takes the first. */
export function one(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  const trimmed = first?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * The value only if it is one the caller allows.
 *
 * Anything typed into the address bar reaches this, so a filter is built from
 * the whitelist rather than from the request — the same shape the report and
 * insights pages already use for their period switches.
 */
export function pick<const T extends string>(
  value: string | string[] | undefined,
  allowed: readonly T[],
): T | undefined {
  const v = one(value);
  return v !== undefined && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

/**
 * A calendar date, or undefined.
 *
 * Dates cannot be whitelisted against a list, so they are shape-checked instead
 * — and then checked for being a real date, so `2026-02-30` is refused rather
 * than rolled into March. Without this a hand-typed `?from=banana` reaches a
 * `::date` cast and Postgres throws, turning a URL typo into a 500. Values are
 * bound as parameters either way, so this is robustness, not injection defence.
 */
export function dateParam(value: string | string[] | undefined): string | undefined {
  const v = one(value);
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const parsed = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== v ? undefined : v;
}

/**
 * A whitelisted row limit. Lists grow by raising this rather than by paging:
 * there is no offset to get out of step with a changing list, no count query,
 * and the back button lands on the same rows it left.
 */
export const LIST_LIMITS = [50, 200, 1000] as const;
export type ListLimit = (typeof LIST_LIMITS)[number];

export function limitFrom(value: string | string[] | undefined): ListLimit {
  const n = Number(one(value));
  return (LIST_LIMITS as readonly number[]).includes(n) ? (n as ListLimit) : LIST_LIMITS[0];
}
