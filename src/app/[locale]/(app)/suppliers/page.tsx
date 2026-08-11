import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';

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
      <h1 className="text-2xl font-semibold">{t('title')}</h1>

      {suppliers.length === 0 ? (
        <p className="text-muted-foreground py-12 text-sm">{t('empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {suppliers.map((s) => (
            <li key={s.id}>
              <Link
                href={`/${locale}/suppliers/${s.id}`}
                className="flex min-h-12 items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate font-medium">{s.name}</span>
                  {s.email && (
                    <span className="text-muted-foreground truncate text-xs">{s.email}</span>
                  )}
                </div>
                <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                  {t('leadTimeShort', { days: s.leadTimeDays })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
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
