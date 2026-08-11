import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { ClipboardList } from 'lucide-react';

import { DataList, DataRow, PageTitle } from '@/components/data-list';
import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { organizations } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { requireOrg } from '@/server/auth/session';
import { listPurchaseOrders } from '@/server/purchasing/orders';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

export default async function OrdersPage({ params }: PageProps<'/[locale]/orders'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('orders');
  const format = await getFormatter();
  const { orgId } = await requireOrg(locale);

  const [org] = await withTenant(orgId, (tx) => tx.select().from(organizations));
  const orders = await listPurchaseOrders(orgId);
  const money = (v: string) => format.number(Number(v), { style: 'currency', currency: org.currencyCode });

  return (
    <main className="flex flex-1 flex-col gap-4 p-4">
      <PageTitle>{t('title')}</PageTitle>

      {orders.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={t('empty')}
          body={t('emptyBody')}
          // Points at where orders actually come from, rather than a blank form.
          action={
            <Link
              href={`/${locale}/reorder`}
              className={buttonVariants({ variant: 'outline', className: 'h-11' })}
            >
              {t('fromSuggestions')}
            </Link>
          }
        />
      ) : (
        <DataList>
          {orders.map((o) => (
            <DataRow
              key={o.id}
              href={`/${locale}/orders/${o.id}`}
              title={o.supplierName}
              subtitle={
                <span className="flex items-center gap-2">
                  {/* The badge carries the word, never a colour on its own —
                      "Part delivered" has to survive being read in greyscale. */}
                  <Badge variant={o.status === 'received' ? 'secondary' : 'outline'}>
                    {t(`status.${o.status}`)}
                  </Badge>
                  <span className="font-mono">{o.poNumber}</span>
                </span>
              }
              value={money(o.total)}
              meta={t('lineCount', { count: o.lineCount })}
            />
          ))}
        </DataList>
      )}
    </main>
  );
}
