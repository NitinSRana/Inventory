'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

import { Field, StickyAction } from '@/components/form';
import { Button, buttonVariants } from '@/components/ui/button';
import type { ImportPreview, RowError } from '@/server/catalog/import';

/**
 * Check the file, then import it.
 *
 * The dry run already existed in `importProductsCsv` and nothing ever asked for
 * it, so a 2,000-row catalogue went straight in on one click. Two clicks now:
 * the first says what would happen and shows five parsed rows, the second
 * writes. Seeing "Semi-Skimmed Milk / 5000112637922 / 1.45" is the only thing
 * that catches a column that mapped to the wrong field.
 *
 * This is the one client component in the flow, and only because a Server
 * Component cannot hold the file between the two steps: React resets an
 * uncontrolled form once its action runs, so the browser's copy is gone by the
 * time the preview renders. The text comes back from the server instead.
 */
export type ImportState =
  | { status: 'idle' }
  | { status: 'empty' }
  | { status: 'blocked'; preview: ImportPreview }
  | { status: 'ready'; preview: ImportPreview; text: string };

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
  templateHref,
  addSupplierHref,
}: {
  action: (prev: ImportState, formData: FormData) => Promise<ImportState>;
  templateHref: string;
  addSupplierHref: string;
}) {
  const t = useTranslations('import');
  const [state, formAction, pending] = useActionState(action, { status: 'idle' } as ImportState);

  const preview = state.status === 'blocked' || state.status === 'ready' ? state.preview : null;
  const ready = state.status === 'ready';

  return (
    <div className="flex flex-col gap-6">
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
              rows: state.preview.totalRows,
              problems: state.preview.errors.length,
            })}
          </p>

          <ul className="flex flex-col gap-2">
            {groupErrors(state.preview.errors).map((g) => (
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

      {/* Clean file. The counts answer "what will this do"; the rows answer
          "did my columns land where I think they did". */}
      {ready && (
        <div className="flex flex-col gap-3 rounded-lg border p-4">
          <p role="status" className="text-sm font-medium tabular-nums">
            {t('willImport', {
              create: state.preview.toCreate,
              update: state.preview.toUpdate,
            })}
          </p>
          {state.preview.sample.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground text-left">
                    <th className="py-1 pr-4 font-normal">{t('sampleName')}</th>
                    <th className="py-1 pr-4 font-normal">{t('sampleBarcode')}</th>
                    <th className="py-1 pr-4 text-right font-normal">{t('samplePrice')}</th>
                  </tr>
                </thead>
                <tbody>
                  {state.preview.sample.map((row, i) => (
                    <tr key={i} className="border-t">
                      <td className="py-1 pr-4">{row.name}</td>
                      <td className="py-1 pr-4 font-mono text-xs">{row.gtin ?? '—'}</td>
                      <td className="py-1 pr-4 text-right tabular-nums">{row.sellPrice ?? '—'}</td>
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
      {preview && preview.unknownColumns.length > 0 && (
        <p className="text-muted-foreground text-sm">
          {t('ignoredColumns', { names: preview.unknownColumns.slice(0, 10).join(', ') })}
        </p>
      )}

      {preview && preview.unknownSuppliers.length > 0 && (
        <div className="flex flex-col items-start gap-2">
          <p className="text-muted-foreground text-sm">
            {t('unknownSuppliers', { names: preview.unknownSuppliers.slice(0, 10).join(', ') })}
          </p>
          {/* Telling someone to add a supplier without a way to do it was a
              dead end. `next` brings them straight back here. */}
          <Link
            href={addSupplierHref}
            className={buttonVariants({ variant: 'outline', className: 'h-11' })}
          >
            {t('addSupplier')}
          </Link>
        </div>
      )}

      <form action={formAction} className="flex flex-col gap-4">
        <Field name="file" label={t('fileLabel')} hint={ready ? t('replaceFile') : undefined}>
          {/* Native file input: the OS picker already handles cloud drives and
              recent files better than anything worth building. */}
          <input
            id="file"
            name="file"
            type="file"
            accept=".csv,text/csv"
            required={!ready}
            className="border-input file:bg-muted file:text-foreground h-12 w-full rounded-lg border bg-transparent px-3 py-2 text-sm file:mr-3 file:h-8 file:rounded-md file:border-0 file:px-3"
          />
        </Field>

        {/* The checked file, carried back to the confirm step. React clears the
            file input once the first action runs, so this is what the second
            submit actually imports.
            ponytail: a ~200KB ceiling — roughly 2,000 rows — before the action
            payload gets unreasonable. Stream to storage if a chain ever needs
            more than one shop's catalogue in one file. */}
        {ready && <textarea name="text" defaultValue={state.text} hidden readOnly />}

        <details className="text-sm">
          <summary className="cursor-pointer py-2">{t('formatTitle')}</summary>
          <div className="flex flex-col gap-2 pt-2">
            <p className="text-muted-foreground">{t('formatBody')}</p>
            <p className="text-muted-foreground text-xs">{t('formatColumns')}</p>
            <a
              href={templateHref}
              download="catalogue-template.csv"
              className={buttonVariants({ variant: 'outline', className: 'h-11 w-fit' })}
            >
              {t('downloadTemplate')}
            </a>
          </div>
        </details>

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
      </form>
    </div>
  );
}
