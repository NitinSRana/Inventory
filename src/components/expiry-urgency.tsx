import { AlertTriangle, Circle, Clock } from 'lucide-react';

/**
 * The urgency ladder: icon, word and hue — always all three.
 *
 * The *form* escalates as well as the colour — plain text, then tinted text with
 * an icon, then a filled chip. That is what makes the ladder readable in
 * greyscale, at an angle, by the roughly one man in twelve with red-green colour
 * vision deficiency. Only the expired tier gets a chip; if everything were
 * chipped, nothing would be urgent.
 *
 * Three screens consume this, so the accessibility argument lives in one file.
 */
export type Urgency = 'expired' | 'critical' | 'soon' | 'ok';

export function urgencyOf(daysRemaining: number | null): Urgency {
  if (daysRemaining === null) return 'ok';
  if (daysRemaining < 0) return 'expired';
  if (daysRemaining <= 3) return 'critical';
  if (daysRemaining <= 14) return 'soon';
  return 'ok';
}

/** For a figure that should carry the same urgency as its row. */
export function urgencyClass(urgency: Urgency) {
  return {
    expired: 'text-destructive',
    critical: 'text-warning',
    soon: 'text-muted-foreground',
    ok: 'text-foreground',
  }[urgency];
}

const TIERS = {
  expired: {
    Icon: AlertTriangle,
    // The only tier with a filled chip — the top of the ladder, used sparingly.
    className:
      'bg-destructive-subtle text-destructive rounded-md px-2 py-0.5 font-medium',
  },
  critical: { Icon: Clock, className: 'text-warning font-medium' },
  soon: { Icon: Circle, className: 'text-muted-foreground' },
  ok: { Icon: null, className: 'text-foreground' },
} as const;

export function UrgencyBadge({ urgency, label }: { urgency: Urgency; label: string }) {
  const { Icon, className } = TIERS[urgency];
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm ${className}`}>
      {/* aria-hidden throughout: the adjacent word is the label. */}
      {Icon && <Icon aria-hidden strokeWidth={2.4} className="size-4 shrink-0" />}
      {label}
    </span>
  );
}
