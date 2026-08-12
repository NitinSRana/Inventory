import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import Decimal from 'decimal.js';
import { ShoppingCart, Trash2 } from 'lucide-react';

import { BarcodeField } from '@/components/barcode-field';
import { DataList, DataRow, HeadlineFigure, PageTitle } from '@/components/data-list';
import { EmptyState } from '@/components/empty-state';
import { Field, StickyAction } from '@/components/form';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { organizations } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { addToCart, encodeCart, parseCart, removeFromCart } from '@/lib/cart';
import { trimQuantity } from '@/lib/quantity';
import { requireOrg } from '@/server/auth/session';
import { findProductByBarcode, getProductsByIds } from '@/server/catalog/products';
import { UnpricedProductError, checkout } from '@/server/pos/checkout';
import { InsufficientStockError } from '@/server/stock/fefo';
import { getProductStock } from '@/server/stock/levels';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

export default async function CheckoutPage({
  params,
  searchParams,
}: PageProps<'/[locale]/checkout'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { gtin, cart: cartParam, error, done } = await searchParams;
  const t = await getTranslations('checkout');
  const format = await getFormatter();
  const { orgId } = await requireOrg(locale);

  const [org] = await withTenant(orgId, (tx) => tx.select().from(organizations));
  const money = (v: string) => format.number(Number(v), { style: 'currency', currency: org.currencyCode });

  if (typeof done === 'string') {
    return (
      <main className="flex flex-1 flex-col items-start gap-4 p-4">
        <PageTitle>{t('saleComplete')}</PageTitle>
        <p className="text-3xl font-semibold tabular-nums">{money(done)}</p>
        <Link href={`/${locale}/checkout`} className={buttonVariants({ className: 'h-12' })}>
          {t('newSale')}
        </Link>
      </main>
    );
  }

  const cart = parseCart(cartParam);
  const cartProducts = await getProductsByIds(orgId, cart.map((l) => l.productId));
  const byId = new Map(cartProducts.map((p) => [p.id, p]));

  const lines = cart
    .map((l) => {
      const product = byId.get(l.productId);
      if (!product?.sellPrice) return null;
      const lineTotal = new Decimal(product.sellPrice).times(l.quantity);
      return { ...l, product, lineTotal: lineTotal.toDecimalPlaces(2).toString() };
    })
    .filter((l) => l !== null);

  const total = lines.reduce((acc, l) => acc.plus(l.lineTotal), new Decimal(0)).toDecimalPlaces(2).toString();

  const barcode = typeof gtin === 'string' ? gtin : undefined;
  const scanned = barcode ? await findProductByBarcode(orgId, barcode) : null;
  const [scannedStock] = scanned ? await getProductStock(orgId, scanned.id) : [];

  async function addLine(formData: FormData) {
    'use server';
    await requireOrg(locale);
    const productId = String(formData.get('productId') ?? '');
    const quantity = String(formData.get('quantity') ?? '').trim() || '1';
    const current = parseCart(String(formData.get('cart') ?? ''));
    redirect(`/${locale}/checkout?cart=${encodeURIComponent(encodeCart(addToCart(current, productId, quantity)))}`);
  }

  async function removeLine(formData: FormData) {
    'use server';
    await requireOrg(locale);
    const productId = String(formData.get('productId') ?? '');
    const current = parseCart(String(formData.get('cart') ?? ''));
    redirect(`/${locale}/checkout?cart=${encodeURIComponent(encodeCart(removeFromCart(current, productId)))}`);
  }

  async function completeSale(formData: FormData) {
    'use server';
    const { orgId, userId } = await requireOrg(locale);
    const tenderType = String(formData.get('tenderType')) as 'cash' | 'card';
    const rawCart = String(formData.get('cart') ?? '');
    const current = parseCart(rawCart);

    let total: string;
    try {
      const sale = await checkout(orgId, { lines: current, tenderType, actorId: userId });
      total = sale.total;
    } catch (e) {
      const code = e instanceof InsufficientStockError ? 'stock' : e instanceof UnpricedProductError ? 'unpriced' : 'unknown';
      redirect(`/${locale}/checkout?cart=${encodeURIComponent(rawCart)}&error=${code}`);
    }
    redirect(`/${locale}/checkout?done=${total}`);
  }

  const cartValue = encodeCart(cart);

  return (
    <main className="flex flex-1 flex-col gap-5 p-4 pb-40">
      <PageTitle>{t('title')}</PageTitle>

      {scanned ? (
        // Step two: how many. Autofocused, numeric keypad, defaults to one —
        // most grocery scans are one unit at a time.
        <form action={addLine} className="flex flex-col gap-4">
          <input type="hidden" name="productId" value={scanned.id} />
          <input type="hidden" name="cart" value={cartValue} />
          <div className="flex flex-col gap-1">
            <span className="text-lg font-medium">{scanned.name}</span>
            <span className="text-muted-foreground text-sm tabular-nums">
              {trimQuantity(scannedStock?.quantity ?? '0')}{' '}
              <span className="opacity-70">{scanned.unit}</span> {t('onHand')}
            </span>
          </div>
          <Field name="quantity" label={t('quantity')}>
            <Input
              id="quantity"
              name="quantity"
              inputMode="decimal"
              defaultValue="1"
              autoFocus
              className="h-14 text-right text-lg tabular-nums"
            />
          </Field>
          <Button type="submit" className="h-12 w-full sm:w-fit">
            {t('addToCart')}
          </Button>
        </form>
      ) : (
        // Step one: identify. Live on load so a scanner gun or a thumb can go
        // straight in without a tap.
        <form className="flex flex-col gap-3">
          <input type="hidden" name="cart" value={cartValue} />
          <BarcodeField autoFocus />
          {barcode && !scanned && (
            <div className="flex flex-col items-start gap-2">
              <p role="alert" className="text-sm">
                {t('notFound', { barcode })}
              </p>
              <Link
                href={`/${locale}/products/new`}
                className={buttonVariants({ variant: 'outline', className: 'h-11' })}
              >
                {t('addProduct')}
              </Link>
            </div>
          )}
          <Button type="submit" variant="outline" className="h-11 w-fit">
            {t('lookUp')}
          </Button>
        </form>
      )}

      {error === 'stock' && (
        <p role="alert" className="text-destructive text-sm">
          {t('insufficientStock')}
        </p>
      )}
      {error === 'unpriced' && (
        <p role="alert" className="text-destructive text-sm">
          {t('unpriced')}
        </p>
      )}
      {error === 'unknown' && (
        <p role="alert" className="text-destructive text-sm">
          {t('failed')}
        </p>
      )}

      {lines.length === 0 ? (
        <EmptyState icon={ShoppingCart} title={t('cartEmpty')} body={t('cartEmptyBody')} />
      ) : (
        <>
          <HeadlineFigure
            label={t('itemCount', { count: lines.length })}
            value={money(total)}
          />

          <DataList>
            {lines.map((l) => (
              <DataRow
                key={l.productId}
                title={l.product.name}
                subtitle={
                  <>
                    {trimQuantity(l.quantity)} {l.product.unit} × {money(l.product.sellPrice!)}
                  </>
                }
                value={money(l.lineTotal)}
                meta={
                  <form action={removeLine}>
                    <input type="hidden" name="productId" value={l.productId} />
                    <input type="hidden" name="cart" value={cartValue} />
                    <button
                      type="submit"
                      aria-label={t('remove', { name: l.product.name })}
                      className="text-muted-foreground flex size-11 items-center justify-center"
                    >
                      <Trash2 aria-hidden className="size-4" />
                    </button>
                  </form>
                }
              />
            ))}
          </DataList>

          {/* Tender is the completing action: picking one finishes the sale,
              there is no separate confirm step behind it. */}
          <StickyAction>
            <div className="flex w-full gap-3 sm:w-fit">
              <form action={completeSale} className="flex-1 sm:flex-none">
                <input type="hidden" name="cart" value={cartValue} />
                <input type="hidden" name="tenderType" value="cash" />
                <Button type="submit" variant="outline" className="h-12 w-full sm:w-32">
                  {t('cash')}
                </Button>
              </form>
              <form action={completeSale} className="flex-1 sm:flex-none">
                <input type="hidden" name="cart" value={cartValue} />
                <input type="hidden" name="tenderType" value="card" />
                <Button type="submit" className="h-12 w-full sm:w-32">
                  {t('card')}
                </Button>
              </form>
            </div>
          </StickyAction>
        </>
      )}
    </main>
  );
}
