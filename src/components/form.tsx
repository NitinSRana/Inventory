import { Label } from '@/components/ui/label';

/**
 * The form pieces every data-entry screen was hand-rolling.
 *
 * `<div className="flex flex-col gap-2"><Label/><Input/></div>` appeared twenty
 * times across six screens, at three different input heights, and the sticky
 * submit button's class string had already drifted into a version that sat
 * behind the bottom nav. Those are the two failure modes a design system exists
 * to prevent, so they live here now.
 */

/**
 * Label, control, hint, error — in that order, always.
 *
 * `name` doubles as the control's id: every form in this app already keeps the
 * two identical, and tying them together here means a field cannot ship with a
 * label pointing at nothing.
 */
export function Field({
  name,
  label,
  hint,
  error,
  children,
}: {
  name: string;
  label: React.ReactNode;
  /** Why the field matters, or where the number comes from. Never a placeholder. */
  hint?: React.ReactNode;
  error?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={name}>{label}</Label>
      {children}
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Two fields side by side. A grid rather than flex so the columns stay equal
 * when one label wraps to two lines and the other does not.
 */
export function FieldRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}

/**
 * A native select. The OS picker beats any custom listbox one-handed, and it
 * costs nothing to ship.
 */
export function NativeSelect({
  className = '',
  ...props
}: React.ComponentProps<'select'>) {
  return (
    <select
      className={`border-input bg-muted h-12 rounded-lg border px-3 text-sm ${className}`}
      {...props}
    />
  );
}

/**
 * The one primary action, parked in the bottom third where a thumb reaches.
 *
 * `bottom-20` clears the 56px navigation bar. Getting that wrong put the Save
 * button *underneath* the nav on the product screens, which is why this is a
 * component and not a class string copied between files. Static from `sm` up,
 * where reach is not the constraint.
 *
 * Positions only — the child sizes itself with `w-full sm:w-fit`.
 */
export function StickyAction({ children }: { children: React.ReactNode }) {
  // Pinned above the tab bar for as long as there is a tab bar. That switch is
  // md, not sm: the bottom bar hides at md, so at sm the action used to scroll
  // away while the bar it was clearing was still on screen.
  return <div className="fixed inset-x-4 bottom-20 z-30 md:static md:z-auto">{children}</div>;
}
