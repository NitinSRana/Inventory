import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import Decimal from 'decimal.js';
import { ShoppingCart, Trash2 } from 'lucide-react';

import { BarcodeField } from '@/components/barcode-field';
import { DataList, DataRow, PageTitle } from '@/components/data-list';
import { EmptyState } from '@/components/empty-state';
import { Field } from '@/components/form';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { organizations } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { addToCart, encodeCart, parseCart, removeFromCart } from '@/lib/cart';
import { trimQuantity } from '@/lib/quantity';
import { requireOrg } from '@/server/auth/session';
import {
  findProductByBarcode,
  getProduct,
  getProductsByIds,
  listProducts,
} from '@/server/catalog/products';
import { UnpricedProductError, checkout, getSale } from '@/server/pos/checkout';
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

  const { gtin, cart: cartParam, error, done, pick } = await searchParams;
  const picked = typeof pick === 'string' ? pick : undefined;
  const t = await getTranslations('checkout');
  const format = await getFormatter();
  const { orgId } = await requireOrg(locale);

  const [org] = await withTenant(orgId, (tx) => tx.select().from(organizations));
  const money = (v: string) => format.number(Number(v), { style: 'currency', currency: org.currencyCode });

  if (typeof done === 'string') {
    const receipt = await getSale(orgId, done);
    // The id came straight back from checkout() a moment ago, so its absence
    // here means something is genuinely wrong — say so rather than pretend the
    // bare confirmation the old version showed was ever the goal.
    if (!receipt) {
      return (
        <main className="flex flex-1 flex-col items-start gap-4 p-4">
          <PageTitle>{t('saleNotFound')}</PageTitle>
          <p className="text-muted-foreground text-sm">{t('saleNotFoundBody')}</p>
          <Link href={`/${locale}/checkout`} className={buttonVariants({ className: 'h-12' })}>
            {t('newSale')}
          </Link>
        </main>
      );
    }

    const tVat = await getTranslations('vat');
    const { sale, lines, vatBreakdown } = receipt;
    const netTotal = new Decimal(sale.subtotal);

    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-4">
        <div className="flex flex-col items-start gap-1">
          <PageTitle>{t('saleComplete')}</PageTitle>
          <p className="text-muted-foreground text-sm">
            {t('receiptMeta', {
              number: sale.saleNumber,
              tender: t(`tenderTypes.${sale.tenderType}`),
              time: format.dateTime(new Date(sale.createdAt), { dateStyle: 'medium', timeStyle: 'short' }),
            })}
          </p>
        </div>

        <DataList>
          {lines.map((l) => (
            <DataRow
              key={l.productId}
              title={l.name}
              subtitle={
                <>
                  {trimQuantity(l.quantity)} {l.unit} × {money(l.unitPrice)}
                </>
              }
              value={money(l.lineTotal)}
            />
          ))}
        </DataList>

        {/* The breakdown a return actually needs: what came back has to be
            refunded at the rate it was charged, and one summed VAT line cannot
            say what that was. */}
        <div className="flex flex-col gap-1 border-t pt-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{t('subtotal')}</span>
            <span className="tabular-nums">{money(netTotal.toFixed(2))}</span>
          </div>
          {vatBreakdown.map((b) => (
            <div key={b.band} className="flex justify-between text-sm">
              <span className="text-muted-foreground">{tVat(`bands.${b.band}`)}</span>
              <span className="tabular-nums">{money(b.vat)}</span>
            </div>
          ))}
          <div className="flex justify-between border-t pt-2 text-lg font-semibold">
            <span>{t('total')}</span>
            <span className="tabular-nums">{money(sale.total)}</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link href={`/${locale}/checkout`} className={buttonVariants({ className: 'h-12 w-fit' })}>
            {t('newSale')}
          </Link>
          <Link
            href={`/${locale}/sales/${sale.id}`}
            className={buttonVariants({ variant: 'outline', className: 'h-12 w-fit' })}
          >
            {t('viewInSales')}
          </Link>
        </div>
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

  const query = typeof gtin === 'string' ? gtin.trim() : undefined;

  /**
   * One field resolves both ways. A scanner gun and a barcode typed by hand
   * land on a product directly; anything else is treated as a name, because a
   * product sold loose has no barcode to type. `pick` is the row chosen from
   * those results, which is how a barcodeless product gets identified at all.
   */
  const scanned = picked
    ? await getProduct(orgId, picked)
    : query
      ? await findProductByBarcode(orgId, query)
      : null;

  // Only search when the input was not a usable barcode, so the common case
  // costs one query and a scan never waits on a name lookup.
  const matches =
    !scanned && query ? await listProducts(orgId, { search: query, limit: 8 }) : null;

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

    let saleId: string;
    try {
      const sale = await checkout(orgId, { lines: current, tenderType, actorId: userId });
      saleId = sale.id;
    } catch (e) {
      const code = e instanceof InsufficientStockError ? 'stock' : e instanceof UnpricedProductError ? 'unpriced' : 'unknown';
      redirect(`/${locale}/checkout?cart=${encodeURIComponent(rawCart)}&error=${code}`);
    }
    // The id, not the total: a bare figure cannot show what was actually sold,
    // and that is the thing a completed sale most needs to prove.
    redirect(`/${locale}/checkout?done=${saleId}`);
  }

  const cartValue = encodeCart(cart);

  return (
    // Two columns once there is width for them: scanning and the basket on the
    // left, the money on the right where it stays put. A till is read for hours
    // at a desk, and a total that scrolls away behind twenty scanned items is
    // the one number the person operating it always needs.
    //
    // pb-56 on a phone, not pb-40: the pinned total is 130px tall sitting 80px
    // up, so it covers 210px and the last line of the basket hid behind it.
    <main className="flex flex-1 flex-col gap-5 p-4 pb-56 md:pb-4 lg:flex-row lg:items-start lg:gap-6">
      <div className="flex min-w-0 flex-col gap-5 lg:flex-1">
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
            {/* Loose goods get no default. One is the right guess for a tin and
                a meaningless one for 400g of cheese — and a pre-filled 1 that
                nobody notices sells a kilo. */}
            <Field
              name="quantity"
              label={scanned.isWeighed ? t('weight', { unit: scanned.unit }) : t('quantity')}
            >
              <Input
                id="quantity"
                name="quantity"
                inputMode="decimal"
                defaultValue={scanned.isWeighed ? '' : '1'}
                required={scanned.isWeighed}
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
            <p className="text-muted-foreground text-sm">{t('orSearchHint')}</p>

            {/* Typed something that is not a barcode? Then it was a name.
                Loose goods — the deli counter, the cheese, the fruit — have no
                barcode to scan at all, and until now the till simply could not
                ring them up. One field either way: a mode switch is one more
                thing to get wrong with a queue waiting. */}
            {matches !== null && matches.length > 0 && (
              <DataList>
                {matches.map((m) => (
                  <DataRow
                    key={m.id}
                    href={`/${locale}/checkout?gtin=${encodeURIComponent(m.gtin ?? '')}&pick=${m.id}&cart=${encodeURIComponent(cartValue)}`}
                    title={m.name}
                    subtitle={m.isWeighed ? t('soldByWeight', { unit: m.unit }) : (m.gtin ?? t('noBarcode'))}
                    value={m.sellPrice ? money(m.sellPrice) : t('noPrice')}
                  />
                ))}
              </DataList>
            )}

            {matches !== null && matches.length === 0 && (
              <div className="flex flex-col items-start gap-2">
                <p role="alert" className="text-sm">
                  {t('notFound', { barcode: String(query) })}
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
        )}
      </div>

      {/* The money. Pinned above the tab bar on a phone, a sticky column on a
          desktop till — either way the total sits directly above the buttons
          that take it, because that is the pair the operator actually reads.
          Tender is the completing action: picking one finishes the sale, there
          is no separate confirm step behind it. */}
      {lines.length > 0 && (
        <aside className="bg-background fixed inset-x-4 bottom-20 z-30 flex flex-col gap-3 rounded-lg border p-3 md:static md:inset-x-auto md:bottom-auto md:z-auto md:border-0 md:p-0 lg:sticky lg:top-18 lg:w-80 lg:shrink-0 lg:self-start lg:rounded-lg lg:border lg:p-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-muted-foreground text-sm">
              {t('itemCount', { count: lines.length })}
            </span>
            <span className="text-2xl font-semibold tabular-nums lg:text-3xl">{money(total)}</span>
          </div>

          <div className="flex gap-3">
            <form action={completeSale} className="flex-1">
              <input type="hidden" name="cart" value={cartValue} />
              <input type="hidden" name="tenderType" value="cash" />
              <Button type="submit" variant="outline" className="h-12 w-full">
                {t('cash')}
              </Button>
            </form>
            <form action={completeSale} className="flex-1">
              <input type="hidden" name="cart" value={cartValue} />
              <input type="hidden" name="tenderType" value="card" />
              <Button type="submit" className="h-12 w-full">
                {t('card')}
              </Button>
            </form>
          </div>
        </aside>
      )}
    </main>
  );
}
