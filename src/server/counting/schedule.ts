/**
 * Count scheduling arithmetic. No database import, so it stays a pure module.
 */

export const COUNT_INTERVAL_DAYS = {
  weekly: 7,
  biweekly: 14,
  monthly: 30,
  quarterly: 90,
} as const;

export type ScheduledFrequency = keyof typeof COUNT_INTERVAL_DAYS;

/**
 * ponytail: fresh weekly, ambient monthly is CLAUDE.md's stated placeholder,
 * not a validated default. Confirm against a real store before trusting it.
 */
export const DEFAULT_FREQUENCY: ScheduledFrequency = 'monthly';

export function intervalDays(frequency: string | null | undefined): number {
  return (
    COUNT_INTERVAL_DAYS[frequency as ScheduledFrequency] ?? COUNT_INTERVAL_DAYS[DEFAULT_FREQUENCY]
  );
}

/**
 * Days past due. Negative means not yet due.
 *
 * A product never counted is due now, not infinitely overdue — otherwise a
 * freshly imported catalogue buries genuinely drifting stock under thousands of
 * products nobody has ever touched.
 */
export function daysOverdue(
  lastCountedAt: Date | null,
  frequency: string | null | undefined,
  now: Date,
): number {
  if (!lastCountedAt) return 0;
  const elapsed = (now.getTime() - lastCountedAt.getTime()) / 864e5;
  return Math.floor(elapsed - intervalDays(frequency));
}
