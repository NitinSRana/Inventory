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
    // Capped at desktop widths, full width on a phone. A form is a reading
    // measure, not a table: a 13-character barcode field stretched across the
    // 896px content column reads as a rendering fault, and .claude/rules/ui.md
    // calls that out directly. The cap starts at md, so aisle screens keep
    // their full-width 44px targets untouched.
    <div className="flex flex-col gap-2 md:max-w-lg">
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
 * Two fields side by side — but only once there is room for two.
 *
 * A grid rather than flex so the columns stay equal when one label wraps to two
 * lines and the other does not.
 *
 * Stacked below `sm`, and that is not cosmetic: two inputs sharing a 375px row
 * leave about 170px each, on screens like Receive that are used one-handed and
 * gloved in a cold aisle. `.claude/rules/ui.md` sets a 44px minimum there for
 * accessibility reasons (the European Accessibility Act), not stylistic ones.
 */
export function FieldRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:max-w-lg">{children}</div>;
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
