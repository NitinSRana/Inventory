import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import Decimal from 'decimal.js';
import { Banknote, CreditCard, ShoppingCart, Trash2 } from 'lucide-react';

import { BarcodeField } from '@/components/barcode-field';
import { DataList, DataRow, PageTitle } from '@/components/data-list';
import { EmptyState } from '@/components/empty-state';
import { Field } from '@/components/form';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { organizations } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { addToCart, encodeCart, parseCart, removeFromCart, takeOneFromCart } from '@/lib/cart';
import { trimQuantity } from '@/lib/quantity';
import { requireOrg } from '@/server/auth/session';
import { normalizeGtin } from '@/server/catalog/ean';
import {
  findProductByBarcode,
  getProduct,
  getProductsByIds,
  listProducts,
} from '@/server/catalog/products';
import { UnpricedProductError, checkout, getSale, previewBasket } from '@/server/pos/checkout';
import { UnconfiguredVatBandError } from '@/server/settings/valuation';
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

  /*
   * Priced exactly as the till will charge it. previewBasket runs the same FEFO
   * and markdown logic checkout() writes, so units from a marked-down batch show
   * their reduced price here — not only on the receipt, after the money has
   * changed hands. A basket that cannot be sold right now (no stock, no price,
   * no VAT rate) falls back to shelf prices, and completing the sale then says
   * exactly which of those it is.
   */
  const priced = await previewBasket(orgId, cart).catch((e: unknown) => {
    if (
      e instanceof InsufficientStockError ||
      e instanceof UnpricedProductError ||
      e instanceof UnconfiguredVatBandError
    ) {
      return null;
    }
    throw e;
  });

  const lines = priced
    ? priced.lines.flatMap((l) => {
        const product = byId.get(l.productId);
        return product
          ? [{ productId: l.productId, product, quantity: l.quantity, unitPrice: l.unitPrice, listPrice: l.listPrice, lineTotal: l.lineTotal, markedDown: l.markedDown }]
          : [];
      })
    : cart.flatMap((l) => {
        const product = byId.get(l.productId);
        if (!product?.sellPrice) return [];
        const lineTotal = new Decimal(product.sellPrice).times(l.quantity).toString();
        return [{ productId: l.productId, product, quantity: l.quantity, unitPrice: product.sellPrice, listPrice: product.sellPrice, lineTotal, markedDown: false }];
      });

  const total = lines.reduce((acc, l) => acc.plus(l.lineTotal), new Decimal(0)).toDecimalPlaces(2).toString();
  // Net and VAT exactly as the till will record them, summed from the same plan.
  // Only when the basket could be priced: the shelf-price fallback has no VAT
  // split to show, and a made-up one would be worse than none.
  const split = priced
    ? {
        net: priced.lines.reduce((acc, l) => acc.plus(l.net), new Decimal(0)).toFixed(2),
        vat: priced.lines.reduce((acc, l) => acc.plus(l.vatAmount), new Decimal(0)).toFixed(2),
      }
    : null;

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

  // Only a real barcode is worth carrying into the product form; a name that
  // matched nothing is not one.
  const scannedCode = query && normalizeGtin(query) ? query : '';

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

  /** The basket stepper: one unit on or off, for anything not sold by weight. */
  async function stepLine(formData: FormData) {
    'use server';
    await requireOrg(locale);
    const productId = String(formData.get('productId') ?? '');
    const current = parseCart(String(formData.get('cart') ?? ''));
    const next =
      formData.get('step') === 'up' ? addToCart(current, productId, '1') : takeOneFromCart(current, productId);
    redirect(`/${locale}/checkout?cart=${encodeURIComponent(encodeCart(next))}`);
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
      const code =
        e instanceof InsufficientStockError
          ? 'stock'
          : e instanceof UnpricedProductError
            ? 'unpriced'
            : e instanceof UnconfiguredVatBandError
              ? 'noVatRate'
              : 'unknown';
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
    //
    // On a phone the total and tender buttons follow the basket in flow, as the
    // Figma checkout frame (23:124) lays them out.
    <main className="flex flex-1 flex-col gap-5 p-4 lg:flex-row lg:items-start lg:gap-6">
      <div className="flex min-w-0 flex-col gap-5 lg:flex-1">
        {/* The phone header already names the store; the title stays for screen readers. */}
        <div className="max-md:sr-only">
          <PageTitle>{t('title')}</PageTitle>
        </div>

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
                {/* Same as Receive: hand the form what was just scanned. This
                    one field takes a barcode *or* a name, so prefill only when
                    it really is a barcode — "choco" typed into the product's
                    barcode field would be worse than an empty one. */}
                <Link
                  href={`/${locale}/products/new${scannedCode ? `?gtin=${encodeURIComponent(scannedCode)}` : ''}`}
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
        {/* A refusal someone can act on: the fix is one screen away, and the
            basket is still here when they come back. */}
        {error === 'noVatRate' && (
          <p role="alert" className="text-destructive flex flex-col items-start gap-2 text-sm">
            {t('noVatRate')}
            <Link
              href={`/${locale}/settings/vat`}
              className={buttonVariants({ variant: 'outline', className: 'h-11' })}
            >
              {t('setVatRates')}
            </Link>
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
          <div className="bg-card overflow-hidden rounded-lg border">
            <p className="border-b px-4 py-3 text-sm font-semibold">
              {t('basketTitle', { count: cart.length })}
            </p>
            <ul className="divide-border divide-y">
              {lines.map((l, i) => {
                // A product can take two lines: units from a marked-down batch at
                // one price, the rest at shelf price. The controls sit on its
                // first line only; they act on the product, not on a price.
                const first = lines.findIndex((x) => x.productId === l.productId) === i;
                const inCart = cart.find((c) => c.productId === l.productId)?.quantity ?? l.quantity;
                return (
                  <li
                    key={`${l.productId}-${l.unitPrice}`}
                    className="flex min-h-16 items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="truncate text-base font-medium">{l.product.name}</span>
                      <span className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
                        <span className="tabular-nums">
                          {trimQuantity(l.quantity)} {l.product.unit} × {money(l.unitPrice)}
                        </span>
                        {/* The shelf price struck through beside it, so the shopper
                            sees what they saved. Labelled in words, not by colour. */}
                        {l.markedDown && (
                          <>
                            <s className="opacity-70">{money(l.listPrice)}</s>
                            <Badge variant="outline">{t('reduced')}</Badge>
                          </>
                        )}
                      </span>
                    </div>

                    <div className="flex shrink-0 items-center gap-3">
                      {first &&
                        (l.product.isWeighed ? (
                          // A weight is typed, not stepped: "+1" on 0.400 kg of
                          // cheese is a kilo and a bit nobody meant.
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
                        ) : (
                          <div className="flex items-center rounded-md border">
                            <form action={stepLine}>
                              <input type="hidden" name="productId" value={l.productId} />
                              <input type="hidden" name="cart" value={cartValue} />
                              <input type="hidden" name="step" value="down" />
                              <button
                                type="submit"
                                aria-label={t('takeOne', { name: l.product.name })}
                                className="bg-muted/50 flex size-11 items-center justify-center font-bold"
                              >
                                −
                              </button>
                            </form>
                            <span className="min-w-8 text-center text-sm font-semibold tabular-nums">
                              {trimQuantity(inCart)}
                            </span>
                            <form action={stepLine}>
                              <input type="hidden" name="productId" value={l.productId} />
                              <input type="hidden" name="cart" value={cartValue} />
                              <input type="hidden" name="step" value="up" />
                              <button
                                type="submit"
                                aria-label={t('addOne', { name: l.product.name })}
                                className="bg-muted/50 flex size-11 items-center justify-center font-bold"
                              >
                                +
                              </button>
                            </form>
                          </div>
                        ))}
                      <span className="text-base font-semibold tabular-nums">{money(l.lineTotal)}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {/* The money. Pinned above the tab bar on a phone, a sticky column on a
          desktop till — either way the total sits directly above the buttons
          that take it, because that is the pair the operator actually reads.
          Tender is the completing action: picking one finishes the sale, there
          is no separate confirm step behind it. */}
      {lines.length > 0 && (
        <aside className="flex flex-col gap-3 lg:sticky lg:top-18 lg:w-80 lg:shrink-0 lg:self-start">
          <div className="bg-card flex flex-col gap-2 rounded-lg border p-4">
            {split && (
              <>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t('subtotal')}</span>
                  <span className="font-semibold tabular-nums">{money(split.net)}</span>
                </div>
                <div className="text-muted-foreground flex justify-between text-sm">
                  <span>{t('vat')}</span>
                  <span className="tabular-nums">{money(split.vat)}</span>
                </div>
              </>
            )}
            {/* The frame paints this blue. Blue here means "you can go there",
                and a total is a fact, so it is the darkest text instead. */}
            <div className={`flex items-baseline justify-between gap-3 ${split ? 'border-t pt-2' : ''}`}>
              <span className="text-base font-semibold">{t('totalToPay')}</span>
              <span className="text-2xl font-bold tabular-nums">{money(total)}</span>
            </div>
          </div>

          <div className="flex gap-3">
            <form action={completeSale} className="flex-1">
              <input type="hidden" name="cart" value={cartValue} />
              <input type="hidden" name="tenderType" value="cash" />
              <Button type="submit" variant="outline" className="h-12 w-full">
                <Banknote aria-hidden />
                {t('cash')}
              </Button>
            </form>
            <form action={completeSale} className="flex-1">
              <input type="hidden" name="cart" value={cartValue} />
              <input type="hidden" name="tenderType" value="card" />
              <Button type="submit" className="h-12 w-full">
                <CreditCard aria-hidden />
                {t('card')}
              </Button>
            </form>
          </div>
        </aside>
      )}
    </main>
  );
}
