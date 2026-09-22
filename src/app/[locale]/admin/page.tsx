import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { Store } from 'lucide-react';

import { PageTitle, StatTile } from '@/components/data-list';
import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requirePlatformAdmin } from '@/server/platform/admins';
import { listShops } from '@/server/platform/shops';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

/**
 * Every shop on the platform.
 *
 * "Signed up but never signed in" is the fact worth having here — it is the
 * difference between an approval that worked and one where the email never
 * arrived — and it is the one thing no tenant-scoped query can answer, since
 * auth.users is outside the app's reach. See app.platform_shops() in 0018.
 */
export default async function AdminShopsPage({ params }: PageProps<'/[locale]/admin'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePlatformAdmin();

  const t = await getTranslations('admin');
  const format = await getFormatter();
  const shops = await listShops();

  const date = (v: Date | null) =>
    v ? format.dateTime(new Date(v), { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  const signedIn = shops.filter((s) => s.lastSignInAt !== null).length;
  const selling = shops.filter((s) => s.saleCount > 0).length;

  return (
    <main className="flex flex-1 flex-col gap-4 p-4">
      <PageTitle caption={t('shopsIntro')}>{t('shops')}</PageTitle>

      {shops.length === 0 ? (
        <EmptyState icon={Store} title={t('noShops')} body={t('noShopsBody')} />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 md:max-w-lg">
            <StatTile label={t('shopsTile')}>{shops.length}</StatTile>
            <StatTile label={t('signedInTile')}>{signedIn}</StatTile>
            <StatTile label={t('sellingTile')}>{selling}</StatTile>
          </div>

          <div className="bg-card overflow-hidden rounded-xl border">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>{t('shopColumn')}</TableHead>
                  <TableHead>{t('countryColumn')}</TableHead>
                  <TableHead>{t('joinedColumn')}</TableHead>
                  <TableHead className="text-right">{t('peopleColumn')}</TableHead>
                  <TableHead className="text-right">{t('productsColumn')}</TableHead>
                  <TableHead className="text-right">{t('salesColumn')}</TableHead>
                  <TableHead>{t('lastSaleColumn')}</TableHead>
                  <TableHead>{t('lastSignInColumn')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shops.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell className="text-muted-foreground">{s.countryCode}</TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">{date(s.createdAt)}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.memberCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.productCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.saleCount}</TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">{date(s.lastSaleAt)}</TableCell>
                    <TableCell className="tabular-nums">
                      {/* No members at all means the invitation is still
                          unclaimed — nobody has ever opened the shop. */}
                      {s.memberCount === 0 ? (
                        <Badge variant="outline">{t('notSignedIn')}</Badge>
                      ) : (
                        <span className="text-muted-foreground">{date(s.lastSignInAt)}</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </main>
  );
}
