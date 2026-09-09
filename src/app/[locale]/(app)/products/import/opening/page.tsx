import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { BackLink } from '@/components/back-link';
import { ImportForm, type CheckedFile, type ImportState } from '@/components/import-form';
import { buttonVariants } from '@/components/ui/button';
import { PageTitle } from '@/components/data-list';
import { trimQuantity } from '@/lib/quantity';
import { requireRole } from '@/server/auth/session';
import {
  MAX_OPENING_ROWS,
  importOpeningStockCsv,
  type OpeningStockPreview,
} from '@/server/stock/opening-stock';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

/**
 * How much of the catalogue is actually on the shelf on day one.
 *
 * Separate from the catalogue import because they are separate decisions: the
 * catalogue is what the shop sells and can be re-imported safely, whereas this
 * posts receipts and running it twice receives everything twice. That is
 * exactly why it insists on the check step before it writes.
 */
export default async function OpeningStockPage({
  params,
  searchParams,
}: PageProps<'/[locale]/products/import/opening'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { received } = await searchParams;
  const t = await getTranslations('import');
  const tBack = await getTranslations('back');
  await requireRole(locale, 'manager');

  async function run(_prev: ImportState, formData: FormData): Promise<ImportState> {
    'use server';
    const { orgId, userId } = await requireRole(locale, 'manager');
    const t = await getTranslations('import');

    const file = formData.get('file');
    const fresh = file instanceof File && file.size > 0;
    const carried = formData.get('text');
    if (!fresh && typeof carried !== 'string') return { status: 'empty' };
    const text = fresh ? await (file as File).text() : (carried as string);

    const confirmed = !fresh && formData.get('confirm') === '1';
    const result = await importOpeningStockCsv(orgId, text, {
      dryRun: !confirmed,
      actorId: userId,
    });

    const checked = (p: OpeningStockPreview): CheckedFile => ({
      totalRows: p.totalRows,
      errors: p.errors,
      unknownColumns: p.unknownColumns,
      unknownSuppliers: [],
      summary: t('opening.willReceive', { count: p.toReceive }),
      sample: {
        columns: [t('sampleName'), t('opening.sampleQuantity'), t('opening.sampleExpiry')],
        rows: p.sample.map((r) => [r.name, trimQuantity(r.quantity), r.expiryDate ?? '—']),
      },
    });

    if (result.errors.length > 0) return { status: 'blocked', checked: checked(result), text };
    if (!confirmed) return { status: 'ready', checked: checked(result), text };

    redirect(`/${locale}/products/import/opening?received=${result.received}`);
  }

  return (
    <main className="flex flex-1 flex-col gap-6 p-4 pb-28">
      <BackLink href={`/${locale}/products/import`} label={tBack('import')} />
      <PageTitle caption={t('opening.intro')}>{t('opening.title')}</PageTitle>

      {received !== undefined && (
        <div className="flex flex-col items-start gap-3 rounded-lg border p-4">
          <p role="status" className="text-sm tabular-nums">
            {t('opening.received', { count: Number(received) })}
          </p>
          <Link
            href={`/${locale}/products`}
            className={buttonVariants({ variant: 'outline', className: 'h-11' })}
          >
            {t('viewProducts')}
          </Link>
        </div>
      )}

      <ImportForm action={run}>
        <details className="text-sm">
          <summary className="cursor-pointer py-2">{t('formatTitle')}</summary>
          <div className="flex flex-col gap-2 pt-2">
            <p className="text-muted-foreground">{t('opening.formatBody')}</p>
            <p className="text-muted-foreground text-xs">{t('opening.formatColumns')}</p>
            <p className="text-muted-foreground text-xs tabular-nums">
              {t('opening.rowLimit', { max: MAX_OPENING_ROWS })}
            </p>
            <a
              href={`/${locale}/products/import/opening/template`}
              download="opening-stock-template.csv"
              className={buttonVariants({ variant: 'outline', className: 'h-11 w-fit' })}
            >
              {t('downloadTemplate')}
            </a>
          </div>
        </details>
      </ImportForm>
    </main>
  );
}
