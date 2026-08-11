import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { Truck } from 'lucide-react';

import { DataList, DataRow, PageTitle } from '@/components/data-list';
import { EmptyState } from '@/components/empty-state';
import { buttonVariants } from '@/components/ui/button';
import { requireOrg } from '@/server/auth/session';
import { listSuppliers } from '@/server/catalog/suppliers';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

export default async function SuppliersPage({ params }: PageProps<'/[locale]/suppliers'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('suppliers');
  const { orgId } = await requireOrg(locale);
  const suppliers = await listSuppliers(orgId);

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 pb-24">
      <PageTitle>{t('title')}</PageTitle>

      {suppliers.length === 0 ? (
        <EmptyState icon={Truck} title={t('empty')} body={t('emptyBody')} />
      ) : (
        <DataList>
          {suppliers.map((s) => (
            <DataRow
              key={s.id}
              href={`/${locale}/suppliers/${s.id}`}
              title={s.name}
              subtitle={s.email ?? undefined}
              meta={t('leadTimeShort', { days: s.leadTimeDays })}
            />
          ))}
        </DataList>
      )}

      {/* Primary action in the bottom third, thumb-reachable. */}
      <Link
        href={`/${locale}/suppliers/new`}
        className={buttonVariants({ className: 'fixed inset-x-4 bottom-20 sm:bottom-6 h-12 sm:static sm:w-fit' })}
      >
        {t('add')}
      </Link>
    </main>
  );
}
