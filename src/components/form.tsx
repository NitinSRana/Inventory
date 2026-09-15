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
  required = false,
  children,
}: {
  name: string;
  label: React.ReactNode;
  /** Why the field matters, or where the number comes from. Never a placeholder. */
  hint?: React.ReactNode;
  error?: React.ReactNode;
  /** Draws the asterisk only; the control's own `required` is what enforces it. */
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    // Capped at desktop widths, full width on a phone. A form is a reading
    // measure, not a table: a 13-character barcode field stretched across the
    // 896px content column reads as a rendering fault, and .claude/rules/ui.md
    // calls that out directly. The cap starts at md, so aisle screens keep
    // their full-width 44px targets untouched.
    <div className="flex flex-col gap-2 md:max-w-lg">
      <Label htmlFor={name}>
        {label}
        {required && <RequiredMark />}
      </Label>
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

/** The redesign's red asterisk. Hidden from screen readers, which hear the control's `required`. */
function RequiredMark() {
  return (
    <span aria-hidden className="text-destructive ml-1">
      *
    </span>
  );
}

const SEGMENT_COLUMNS: Record<number, string> = {
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-2 sm:grid-cols-4',
  5: 'grid-cols-5',
};

/**
 * A choice among a handful of fixed values, drawn as the redesign's segmented
 * control (unit, VAT band, date type).
 *
 * Native radios underneath, so it is keyboard- and screen-reader-correct and
 * needs no JavaScript: the arrow keys move the choice and the fieldset's legend
 * names the group. Each segment is at least 44px tall.
 */
export function Segmented({
  name,
  label,
  options,
  defaultValue,
  hint,
  required = false,
}: {
  name: string;
  label: React.ReactNode;
  options: { value: string; label: React.ReactNode }[];
  defaultValue: string;
  hint?: React.ReactNode;
  required?: boolean;
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-2 md:max-w-lg">
      <legend className="mb-2 text-sm leading-none font-medium">
        {label}
        {required && <RequiredMark />}
      </legend>
      <div className={`bg-muted grid gap-1 rounded-lg p-1 ${SEGMENT_COLUMNS[options.length] ?? 'grid-cols-2'}`}>
        {options.map((o) => (
          <label
            key={o.value}
            className="has-checked:bg-card has-checked:text-foreground text-muted-foreground has-focus-visible:ring-ring/50 flex min-h-11 cursor-pointer flex-col items-center justify-center rounded-md px-2 text-center text-sm has-checked:font-semibold has-checked:shadow-sm has-focus-visible:ring-3"
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              defaultChecked={o.value === defaultValue}
              required={required}
              className="sr-only"
            />
            {o.label}
          </label>
        ))}
      </div>
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </fieldset>
  );
}

/**
 * A yes/no setting drawn as a switch inside its own bordered row — the
 * redesign's "Sold by Weight". A native checkbox underneath, announced as a
 * switch; the whole row is the tap target.
 */
export function SwitchRow({
  name,
  label,
  hint,
  defaultChecked,
}: {
  name: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
  defaultChecked: boolean;
}) {
  return (
    <label
      htmlFor={name}
      className="bg-card flex min-h-14 cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2 md:max-w-lg"
    >
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold">{label}</span>
        {hint && <span className="text-muted-foreground text-xs">{hint}</span>}
      </span>
      <input id={name} name={name} type="checkbox" role="switch" defaultChecked={defaultChecked} className="peer sr-only" />
      <span
        aria-hidden
        className="bg-input peer-checked:bg-primary peer-focus-visible:ring-ring/50 relative h-6 w-11 shrink-0 rounded-full transition-colors peer-focus-visible:ring-3 after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:after:translate-x-5"
      />
    </label>
  );
}

/** Two short fields that stay side by side even on a phone — prices, stock levels. */
export function FieldPair({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 items-start gap-3 md:max-w-lg">{children}</div>;
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
      className={`border-input bg-card h-12 rounded-lg border px-3 text-sm ${className}`}
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
