import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { BackLink } from '@/components/back-link';
import { ImportForm, type ImportState } from '@/components/import-form';
import { buttonVariants } from '@/components/ui/button';
import { requireRole } from '@/server/auth/session';
import { importProductsCsv } from '@/server/catalog/import';
import { createSupplier } from '@/server/catalog/suppliers';
import { PageTitle } from '@/components/data-list';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

export default async function ImportPage({
  params,
  searchParams,
}: PageProps<'/[locale]/products/import'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { created, updated, ignored } = await searchParams;
  const t = await getTranslations('import');
  const tBack = await getTranslations('back');
  await requireRole(locale, 'manager');

  /**
   * One action, three buttons.
   *
   * Check dry-runs and hands the parsed text back for the preview; Import
   * writes that same text; Create suppliers fills the gap the file named and
   * re-checks. The write path never re-reads the file input, so what gets
   * imported is exactly what was shown.
   */
  async function run(_prev: ImportState, formData: FormData): Promise<ImportState> {
    'use server';
    const { orgId } = await requireRole(locale, 'manager');

    const file = formData.get('file');
    const fresh = file instanceof File && file.size > 0;
    const carried = formData.get('text');
    if (!fresh && typeof carried !== 'string') return { status: 'empty' };
    const text = fresh ? await (file as File).text() : (carried as string);

    // A newly chosen file is always checked first — never imported on a click
    // whose label described the previous one.
    const confirmed = !fresh && formData.get('confirm') === '1';

    if (formData.get('createSuppliers') === '1') {
      // Re-derived here rather than posted: the names come out of the file the
      // server just read, not out of the browser.
      const { unknownSuppliers } = await importProductsCsv(orgId, text, { dryRun: true });
      for (const name of unknownSuppliers) await createSupplier(orgId, { name });
    }

    const result = await importProductsCsv(orgId, text, { dryRun: !confirmed });
    if (result.errors.length > 0) return { status: 'blocked', preview: result, text };
    if (!confirmed) return { status: 'ready', preview: result, text };

    // A dropped column on a successful import is the worse case: nothing looks
    // wrong until someone tries to sell a product whose price never arrived.
    const dropped = result.unknownColumns.length
      ? `&ignored=${encodeURIComponent(result.unknownColumns.slice(0, 10).join(', '))}`
      : '';
    redirect(
      `/${locale}/products/import?created=${result.created}&updated=${result.updated}${dropped}`,
    );
  }

  return (
    <main className="flex flex-1 flex-col gap-6 p-4 pb-28">
      <BackLink href={`/${locale}/products`} label={tBack('products')} />
      <PageTitle caption={t('intro')}>{t('title')}</PageTitle>

      {/* Success. States what changed rather than just "done". */}
      {created !== undefined && (
        <div className="flex flex-col items-start gap-3 rounded-lg border p-4">
          <p role="status" className="text-sm tabular-nums">
            {t('imported', { created: Number(created), updated: Number(updated ?? 0) })}
          </p>
          {typeof ignored === 'string' && ignored && (
            <p className="text-muted-foreground text-sm">{t('ignoredColumns', { names: ignored })}</p>
          )}
          <Link
            href={`/${locale}/products`}
            className={buttonVariants({ variant: 'outline', className: 'h-11' })}
          >
            {t('viewProducts')}
          </Link>
        </div>
      )}

      <ImportForm
        action={run}
        templateHref={`/${locale}/products/import/template`}
        addSupplierHref={`/${locale}/suppliers/new?next=${encodeURIComponent(`/${locale}/products/import`)}`}
      />
    </main>
  );
}
