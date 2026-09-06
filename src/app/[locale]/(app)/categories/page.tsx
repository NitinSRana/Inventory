import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { Tag } from 'lucide-react';

import { DataList, DataRow, PageTitle } from '@/components/data-list';
import { EmptyState } from '@/components/empty-state';
import { StickyAction } from '@/components/form';
import { buttonVariants } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireRole } from '@/server/auth/session';
import { listCategories } from '@/server/catalog/categories';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

export default async function CategoriesPage({ params }: PageProps<'/[locale]/categories'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('categories');
  const { orgId } = await requireRole(locale, 'manager');
  const categories = await listCategories(orgId);

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 pb-24">
      <PageTitle>{t('title')}</PageTitle>

      {categories.length === 0 ? (
        <EmptyState icon={Tag} title={t('empty')} body={t('emptyBody')} />
      ) : (
        <>
          <div className="md:hidden">
            <DataList>
              {categories.map((c) => (
                <DataRow
                  key={c.id}
                  href={`/${locale}/categories/${c.id}`}
                  title={c.icon ? `${c.icon} ${c.name}` : c.name}
                  subtitle={c.description ?? undefined}
                  meta={t(`frequencies.${c.defaultCountFrequency}`)}
                />
              ))}
            </DataList>
          </div>

          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('name')}</TableHead>
                  <TableHead>{t('description')}</TableHead>
                  <TableHead>{t('countFrequency')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link href={`/${locale}/categories/${c.id}`} className="hover:underline">
                        {c.icon ? `${c.icon} ${c.name}` : c.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{c.description ?? '—'}</TableCell>
                    <TableCell>{t(`frequencies.${c.defaultCountFrequency}`)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {/* Primary action in the bottom third, thumb-reachable. */}
      <StickyAction>
        <Link
          href={`/${locale}/categories/new`}
          className={buttonVariants({ className: 'h-12 w-full sm:w-fit' })}
        >
          {t('add')}
        </Link>
      </StickyAction>
    </main>
  );
}
