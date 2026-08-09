/**
 * Colour carries exactly one meaning in this product: how urgently something
 * expires. It is never the only signal — roughly one in twelve men has
 * red-green colour vision deficiency, and this app's entire palette is red to
 * amber. Every band therefore also carries a text label.
 */
export type Urgency = 'expired' | 'critical' | 'soon' | 'ok';

export function urgencyOf(daysRemaining: number | null): Urgency {
  if (daysRemaining === null) return 'ok';
  if (daysRemaining < 0) return 'expired';
  if (daysRemaining <= 3) return 'critical';
  if (daysRemaining <= 14) return 'soon';
  return 'ok';
}

const styles: Record<Urgency, string> = {
  expired: 'text-destructive',
  critical: 'text-warning',
  soon: 'text-muted-foreground',
  ok: 'text-foreground',
};

const dots: Record<Urgency, string> = {
  expired: 'bg-destructive',
  critical: 'bg-warning',
  soon: 'bg-muted-foreground',
  ok: 'bg-transparent',
};

export function urgencyClass(u: Urgency) {
  return styles[u];
}

/** A shape plus a word, so the state survives without colour. */
export function UrgencyBadge({ urgency, label }: { urgency: Urgency; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${styles[urgency]}`}>
      <span aria-hidden className={`size-2 rounded-full ${dots[urgency]}`} />
      {label}
    </span>
  );
}
