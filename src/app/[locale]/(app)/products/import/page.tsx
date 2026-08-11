import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { BackLink } from '@/components/back-link';
import { Button, buttonVariants } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { requireRole } from '@/server/auth/session';
import { importProductsCsv, type RowError } from '@/server/catalog/import';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

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

export default async function ImportPage({ params, searchParams }: PageProps<'/[locale]/products/import'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { created, updated } = await searchParams;
  const t = await getTranslations('import');
  const tBack = await getTranslations('back');
  await requireRole(locale, 'manager');

  async function upload(formData: FormData) {
    'use server';
    const { orgId } = await requireRole(locale, 'manager');
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) {
      redirect(`/${locale}/products/import?empty=1`);
    }

    const result = await importProductsCsv(orgId, await file.text());
    if (result.errors.length > 0) {
      // Errors travel in the URL so the page stays a Server Component and a
      // refresh does not re-upload. Truncated: nobody reads 400 line numbers.
      const payload = encodeURIComponent(
        JSON.stringify({
          t: result.totalRows,
          e: result.errors.slice(0, 50),
          s: result.unknownSuppliers.slice(0, 10),
        }),
      );
      redirect(`/${locale}/products/import?problems=${payload}`);
    }
    redirect(`/${locale}/products/import?created=${result.created}&updated=${result.updated}`);
  }

  const { problems, empty } = await searchParams;
  const report = typeof problems === 'string' ? JSON.parse(decodeURIComponent(problems)) : null;
  const grouped = report ? groupErrors(report.e as RowError[]) : [];

  return (
    <main className="flex flex-1 flex-col gap-6 p-4 pb-28">
      <BackLink href={`/${locale}/products`} label={tBack('products')} />
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground text-sm">{t('intro')}</p>
      </div>

      {/* Success. States what changed rather than just "done". */}
      {created !== undefined && (
        <div className="flex flex-col items-start gap-3 rounded-lg border p-4">
          <p role="status" className="text-sm tabular-nums">
            {t('imported', { created: Number(created), updated: Number(updated ?? 0) })}
          </p>
          <Link
            href={`/${locale}/products`}
            className={buttonVariants({ variant: 'outline', className: 'h-11' })}
          >
            {t('viewProducts')}
          </Link>
        </div>
      )}

      {empty && (
        <p role="alert" className="text-destructive text-sm">
          {t('noFile')}
        </p>
      )}

      {/* Failure. Nothing was written — say so first, because the owner's real
          fear is a half-imported catalogue. */}
      {report && (
        <div className="border-destructive/40 flex flex-col gap-3 rounded-lg border p-4">
          <p role="alert" className="text-destructive text-sm font-medium">
            {t('nothingImported')}
          </p>
          <p className="text-muted-foreground text-sm tabular-nums">
            {t('problemSummary', { rows: report.t, problems: report.e.length })}
          </p>

          <ul className="flex flex-col gap-2">
            {grouped.map((g) => (
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

          {report.s?.length > 0 && (
            <div className="flex flex-col items-start gap-2">
              <p className="text-muted-foreground text-sm">
                {t('unknownSuppliers', { names: report.s.join(', ') })}
              </p>
              {/* Telling someone to add a supplier without a way to do it was a
                  dead end. `next` brings them straight back here. */}
              <Link
                href={`/${locale}/suppliers/new?next=${encodeURIComponent(`/${locale}/products/import`)}`}
                className={buttonVariants({ variant: 'outline', className: 'h-11' })}
              >
                {t('addSupplier')}
              </Link>
            </div>
          )}
        </div>
      )}

      <form action={upload} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="file">{t('fileLabel')}</Label>
          {/* Native file input: the OS picker already handles cloud drives and
              recent files better than anything worth building. */}
          <input
            id="file"
            name="file"
            type="file"
            accept=".csv,text/csv"
            required
            className="border-input file:bg-muted file:text-foreground h-12 w-full rounded-lg border bg-transparent px-3 py-2 text-sm file:mr-3 file:h-8 file:rounded-md file:border-0 file:px-3"
          />
        </div>

        <details className="text-sm">
          <summary className="cursor-pointer py-2">{t('formatTitle')}</summary>
          <div className="flex flex-col gap-2 pt-2">
            <p className="text-muted-foreground">{t('formatBody')}</p>
            <p className="text-muted-foreground text-xs">{t('formatColumns')}</p>
            <a
              href={`/${locale}/products/import/template`}
              download="catalogue-template.csv"
              className={buttonVariants({ variant: 'outline', className: 'h-11 w-fit' })}
            >
              {t('downloadTemplate')}
            </a>
          </div>
        </details>

        <Button type="submit" className="fixed inset-x-4 bottom-20 sm:bottom-6 h-12 sm:static sm:w-fit">
          {t('submit')}
        </Button>
      </form>
    </main>
  );
}
