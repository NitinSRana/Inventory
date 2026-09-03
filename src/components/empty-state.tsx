import type { LucideIcon } from 'lucide-react';

/**
 * What a screen looks like before it has anything to show.
 *
 * Three of the four states a screen owes the reader are cheap; this is the one
 * that gets skipped, and it is the one a new store sees on every screen in
 * week one. So it is a component, not a paragraph — that way it cannot drift
 * into three different shapes across the app, which is exactly what it had.
 *
 * Left-aligned, not centred: the eye is already at the left margin from the
 * title above, and a centred block on a 375px screen reads as an error.
 */
export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: LucideIcon;
  title: string;
  /** What goes here and why it is empty. Omit when the title says it all. */
  body?: string;
  /** The one thing that fills it. An empty screen with no way out is a dead end. */
  action?: React.ReactNode;
}) {
  return (
    // Capped, or an empty screen becomes a 896px-wide dashed rectangle holding
    // a 24px icon and two short lines — which reads as something broken rather
    // than as "nothing here yet". Full width on a phone, where it already fits.
    <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed px-4 py-12 md:max-w-lg md:py-8">
      <Icon aria-hidden className="text-muted-foreground size-6" strokeWidth={1.5} />
      <div className="flex flex-col gap-1">
        <p className="font-medium">{title}</p>
        {body && <p className="text-muted-foreground max-w-prose text-sm">{body}</p>}
      </div>
      {action}
    </div>
  );
}
