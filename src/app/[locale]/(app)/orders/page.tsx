import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';

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
      <h1 className="text-2xl font-semibold">{t('title')}</h1>

      {orders.length === 0 ? (
        <div className="flex flex-col items-start gap-3 py-12">
          <p className="text-muted-foreground text-sm">{t('empty')}</p>
          {/* The empty state points at where orders actually come from. */}
          <Link
            href={`/${locale}/reorder`}
            className={buttonVariants({ variant: 'outline', className: 'h-11' })}
          >
            {t('fromSuggestions')}
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {orders.map((o) => (
            <li key={o.id}>
              <Link
                href={`/${locale}/orders/${o.id}`}
                className="flex min-h-12 items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate font-medium">{o.supplierName}</span>
                  <span className="text-muted-foreground font-mono text-xs">{o.poNumber}</span>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-0.5">
                  <span className="text-sm font-medium tabular-nums">{money(o.total)}</span>
                  {/* Status as a word, never a colour alone. */}
                  <span className="text-muted-foreground text-xs">
                    {t(`status.${o.status}`)} · {t('lineCount', { count: o.lineCount })}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
