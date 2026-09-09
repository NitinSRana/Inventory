'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

import { Field, StickyAction } from '@/components/form';
import { Button, buttonVariants } from '@/components/ui/button';
import type { RowError } from '@/server/catalog/import';

/**
 * Check the file, then import it.
 *
 * The dry run already existed in `importProductsCsv` and nothing ever asked for
 * it, so a 2,000-row catalogue went straight in on one click. Two clicks now:
 * the first says what would happen and shows five parsed rows, the second
 * writes. Seeing "Semi-Skimmed Milk / 5000112637922 / 1.45" is the only thing
 * that catches a column that mapped to the wrong field.
 *
 * Two importers share this: the catalogue and opening stock. Everything that
 * differs between them — the summary sentence, the sample's columns, the
 * format notes — arrives already worded, so this component knows nothing about
 * what either file means.
 *
 * It is the one client component in the flow, and only because a Server
 * Component cannot hold the file between the two steps: React resets an
 * uncontrolled form once its action runs, so the browser's copy is gone by the
 * time the preview renders. The text comes back from the server instead.
 */
export type CheckedFile = {
  totalRows: number;
  errors: RowError[];
  /** Header columns no alias matched — ignored during the import, not silently. */
  unknownColumns: string[];
  /** Suppliers the file names that the shop has not set up. Catalogue only. */
  unknownSuppliers: string[];
  /** What importing this would do, already worded by the caller. */
  summary: string;
  /** A few rows as parsed, with their own column headings. */
  sample: { columns: string[]; rows: string[][] };
};

export type ImportState =
  | { status: 'idle' }
  | { status: 'empty' }
  | { status: 'blocked'; checked: CheckedFile; text: string }
  | { status: 'ready'; checked: CheckedFile; text: string };

/** Errors are grouped by column so one wrong header reads as one problem, not 400. */
function groupErrors(errors: RowError[]) {
  const groups = new Map<string, { column: string; message: string; lines: number[] }>();
  for (const e of errors) {
    const key = `${e.column}:${e.message}`;
    const g = groups.get(key) ?? { column: e.column, message: e.message, lines: [] };
    g.lines.push(e.line);
    groups.set(key, g);
  }
  return [...groups.values()];
}

export function ImportForm({
  action,
  addSupplierHref,
  children,
}: {
  action: (prev: ImportState, formData: FormData) => Promise<ImportState>;
  /** Omitted by importers that cannot produce an unknown supplier. */
  addSupplierHref?: string;
  /** The "what the file needs" note and its template link, from the page. */
  children: React.ReactNode;
}) {
  const t = useTranslations('import');
  const [state, formAction, pending] = useActionState(action, { status: 'idle' } as ImportState);

  const held = state.status === 'blocked' || state.status === 'ready' ? state : null;
  const checked = held?.checked ?? null;
  const ready = state.status === 'ready';

  return (
    // One form around everything: the panels carry buttons that need to post
    // the checked file back, and a button outside the form posts nothing.
    <form action={formAction} className="flex flex-col gap-6">
      {state.status === 'empty' && (
        <p role="alert" className="text-destructive text-sm">
          {t('noFile')}
        </p>
      )}

      {/* Failure. Nothing was written — say so first, because the owner's real
          fear is a half-imported catalogue. */}
      {state.status === 'blocked' && (
        <div className="border-destructive/40 flex flex-col gap-3 rounded-lg border p-4">
          <p role="alert" className="text-destructive text-sm font-medium">
            {t('nothingImported')}
          </p>
          <p className="text-muted-foreground text-sm tabular-nums">
            {t('problemSummary', {
              rows: state.checked.totalRows,
              problems: state.checked.errors.length,
            })}
          </p>

          <ul className="flex flex-col gap-2">
            {groupErrors(state.checked.errors).map((g) => (
              <li key={`${g.column}-${g.message}`} className="text-sm">
                <span className="font-medium">{t(`problems.${g.message}`)}</span>
                <span className="text-muted-foreground block text-xs tabular-nums">
                  {t('onLines', {
                    count: g.lines.length,
                    lines: g.lines.slice(0, 8).join(', ') + (g.lines.length > 8 ? '…' : ''),
                  })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Clean file. The summary answers "what will this do"; the rows answer
          "did my columns land where I think they did". */}
      {ready && (
        <div className="flex flex-col gap-3 rounded-lg border p-4">
          <p role="status" className="text-sm font-medium tabular-nums">
            {state.checked.summary}
          </p>
          {state.checked.sample.rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground text-left">
                    {state.checked.sample.columns.map((c, i) => (
                      <th key={c} className={`py-1 pr-4 font-normal ${i > 0 ? 'text-right' : ''}`}>
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {state.checked.sample.rows.map((row, i) => (
                    <tr key={i} className="border-t">
                      {row.map((cell, j) => (
                        <td
                          key={j}
                          className={`py-1 pr-4 ${j > 0 ? 'text-right tabular-nums' : ''}`}
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-muted-foreground text-xs">{t('sampleCaption')}</p>
        </div>
      )}

      {/* Shown on both outcomes: an ignored column is just as wrong on a file
          that would otherwise import cleanly. */}
      {checked && checked.unknownColumns.length > 0 && (
        <p className="text-muted-foreground text-sm">
          {t('ignoredColumns', { names: checked.unknownColumns.slice(0, 10).join(', ') })}
        </p>
      )}

      {checked && addSupplierHref && checked.unknownSuppliers.length > 0 && (
        <div className="flex flex-col items-start gap-2">
          <p className="text-muted-foreground text-sm">
            {t('unknownSuppliers', { names: checked.unknownSuppliers.slice(0, 10).join(', ') })}
          </p>
          {/* Ordering, not importing, is the real problem: suppliers have to
              exist before a product file can reference them. The file already
              names them, so retyping each one into a form is busywork — and the
              manual route stays for anyone who wants to fill in lead times and
              minimums while they are there. */}
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              name="createSuppliers"
              value="1"
              variant="outline"
              disabled={pending}
              className="h-11"
            >
              {t('createSuppliers', { count: checked.unknownSuppliers.length })}
            </Button>
            <Link
              href={addSupplierHref}
              className={buttonVariants({ variant: 'outline', className: 'h-11' })}
            >
              {t('addSupplier')}
            </Link>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-4">
        <Field name="file" label={t('fileLabel')} hint={ready ? t('replaceFile') : undefined}>
          {/* Native file input: the OS picker already handles cloud drives and
              recent files better than anything worth building. */}
          <input
            id="file"
            name="file"
            type="file"
            accept=".csv,text/csv"
            required={!checked}
            className="border-input file:bg-muted file:text-foreground h-12 w-full rounded-lg border bg-transparent px-3 py-2 text-sm file:mr-3 file:h-8 file:rounded-md file:border-0 file:px-3"
          />
        </Field>

        {/* The checked file, carried back to the confirm step. React clears the
            file input once the first action runs, so this is what the second
            submit actually imports.
            ponytail: a ~200KB ceiling — roughly 2,000 rows — before the action
            payload gets unreasonable. Stream to storage if a chain ever needs
            more than one shop's catalogue in one file. */}
        {held && <textarea name="text" defaultValue={held.text} hidden readOnly />}

        {children}

        <StickyAction>
          <Button
            type="submit"
            name={ready ? 'confirm' : undefined}
            value={ready ? '1' : undefined}
            disabled={pending}
            className="h-12 w-full sm:w-fit"
          >
            {pending ? t('working') : ready ? t('submit') : t('check')}
          </Button>
        </StickyAction>
      </div>
    </form>
  );
}
