import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { Plus, Search, SearchX, Tag } from 'lucide-react';

import { PageTitle } from '@/components/data-list';
import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { one } from '@/lib/search-params';
import { requireRole } from '@/server/auth/session';
import { listCategories } from '@/server/catalog/categories';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

/**
 * Laid out as the "Inventory Categories" frame: search, then one card per
 * category with its icon, description, count frequency and how many products
 * it holds.
 *
 * The frame's "Daily Count" chip is not a frequency this app has — counts run
 * weekly to quarterly (COUNT_FREQUENCIES), as the category-detail frame itself
 * offers — so the chip shows the category's real one.
 */
export default async function CategoriesPage({ params, searchParams }: PageProps<'/[locale]/categories'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('categories');
  const { orgId } = await requireRole(locale, 'manager');
  const all = await listCategories(orgId);

  // A shop has tens of categories, not thousands: filtering the list it already
  // has beats another query per keystroke.
  const search = one((await searchParams).q)?.trim() ?? '';
  const needle = search.toLocaleLowerCase();
  const categories = needle
    ? all.filter((c) => `${c.name} ${c.description ?? ''}`.toLocaleLowerCase().includes(needle))
    : all;

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 md:max-w-3xl">
      <div className="flex items-center justify-between gap-3">
        <PageTitle>{t('title')}</PageTitle>
        <Link href={`/${locale}/categories/new`} className={buttonVariants({ className: 'h-11 gap-1.5' })}>
          <Plus aria-hidden className="size-4" />
          <span className="md:hidden">{t('addShort')}</span>
          <span className="hidden md:inline">{t('add')}</span>
        </Link>
      </div>

      {all.length > 0 && (
        // GET form so the search lives in the URL. Enter submits it.
        <form role="search">
          <label htmlFor="q" className="relative block">
            <span className="sr-only">{t('search')}</span>
            <Search
              aria-hidden
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2"
            />
            <Input
              id="q"
              name="q"
              type="search"
              defaultValue={search}
              placeholder={t('search')}
              className="h-12 pl-10"
            />
          </label>
        </form>
      )}

      {all.length === 0 ? (
        <EmptyState icon={Tag} title={t('empty')} body={t('emptyBody')} />
      ) : categories.length === 0 ? (
        <EmptyState icon={SearchX} title={t('noMatches')} />
      ) : (
        <ul className="bg-card divide-border divide-y overflow-hidden rounded-xl border">
          {categories.map((c) => (
            <li key={c.id}>
              <Link
                href={`/${locale}/categories/${c.id}`}
                className="grid min-h-18 grid-cols-[auto_1fr_auto] items-center gap-3 px-3 py-3"
              >
                <span
                  aria-hidden
                  className="bg-muted text-muted-foreground flex size-11 items-center justify-center rounded-lg border text-xl"
                >
                  {c.icon ?? <Tag className="size-5" />}
                </span>
                <span className="flex min-w-0 flex-col items-start gap-1">
                  <span className="w-full truncate text-base font-semibold">{c.name}</span>
                  {c.description && (
                    <span className="text-muted-foreground w-full truncate text-sm">{c.description}</span>
                  )}
                  <Badge variant="outline">
                    {t('frequencyCount', { frequency: t(`frequencies.${c.defaultCountFrequency}`) })}
                  </Badge>
                </span>
                <span className="flex flex-col items-end">
                  <span className="text-lg font-bold tabular-nums">{c.productCount}</span>
                  <span className="text-muted-foreground text-xs">{t('itemsUnit', { count: c.productCount })}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
