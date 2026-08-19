# UK VAT and case-scanning fixes

What changed and why, after the first UK demo. Delete this file once it's merged and understood — it's a handover note, not documentation.

## The bug that mattered

`checkout.ts` treated `sellPrice` as a **net** price and added VAT on top:

```
lineSubtotal = sellPrice × qty
vatAmount    = lineSubtotal × rate
lineTotal    = lineSubtotal + vatAmount
```

A £1.20 chocolate bar rang up at **£1.44**.

UK and EU consumer retail prices are display-inclusive by law — the shelf edge is what the customer pays. This was wrong for Germany too; it just never came up.

Now `sellPrice` is the **shelf price, VAT included**, and VAT is extracted from it:

```
lineTotal = sellPrice × qty          ← what the customer pays
lineNet   = lineTotal ÷ (1 + rate)   ← rounded to 4dp
vatAmount = lineTotal − lineNet      ← the remainder, never recomputed
```

Taking VAT as the **remainder** rather than computing it separately guarantees `net + vat === gross` exactly, so no penny can drift on a price that doesn't divide cleanly. Verified across 400 awkward price/quantity combinations at 20%: zero drift.

## Why this compounded

Three things had to be true at once for a UK shop to be billed correctly, and none of them were:

1. There was no `GB` entry in `COUNTRY_VAT_SEEDS` — ten EU countries, no UK.
2. `products.vat_band` had no field on the product form, so it could never be changed.
3. Its default was `'standard'`.

So every product a UK grocer created sat silently at 20%, and the till added that 20% on top of the shelf price. On a £1,000 basket of ordinary groceries — nearly all of which is zero-rated in the UK — the till charged £1,200 and recorded £200 of VAT that was never owed.

## Changes

| File | Change |
|---|---|
| `server/pos/checkout.ts` | VAT extracted from the shelf price, not added to it |
| `server/settings/vat-seeds.ts` | `GB` added: standard 20%, reduced 5%, zero 0% |
| `db/schema.ts` + `0010_uk_vat_defaults.sql` | `vat_band` default `'standard'` → `'zero'` |
| `components/product-form.tsx` | VAT band select, showing each band's actual rate. Cost and price now labelled ex- and inc-VAT. |
| `app/.../products/[id]/page.tsx` | Band shown beside the price |
| `server/catalog/import.ts` + `csv.ts` | `vat_band` CSV column, aliases incl. `vat`, `taxcode`; UK template |
| `components/barcode-field.tsx` | ITF added, so case barcodes actually scan |
| `server/pos/checkout.itest.ts` | Updated expectations, plus a UK mixed-VAT basket |

### The default is `'zero'` on purpose

A band wrongly left at zero under-declares VAT on a minority of lines. A band wrongly left at standard **overcharges the customer** on the majority. Overcharging a shopper is the worse failure and the one they notice, so the quiet default is the forgiving one.

The migration does **not** rewrite existing rows. A row sitting at `'standard'` may have been set deliberately, and the migration can't tell the difference. The product page now shows the band so mis-set products can be found. There's a manual `UPDATE` in the migration comment for a fresh tenant whose catalogue hasn't been touched.

### Case barcodes

`ean.ts` validated GTIN-14 and had a passing test, but the camera was configured for `EAN_13` and `EAN_8` only. Case barcodes are normally GTIN-14 printed as **ITF-14** — a different symbology — so every case scan silently failed while the unit tests stayed green. ITF, UPC-A and UPC-E are now enabled.

The format list is deliberately still short. Every extra symbology is another chance to mis-decode a blurry barcode in bad light, and a wrong barcode that happens to match another product is worse than no scan at all.

## Before you merge

I could not run your toolchain — pnpm's Windows symlinks don't resolve through the Linux sandbox mount. **The arithmetic is verified independently, but the suite has not run.** On your machine:

```bash
pnpm typecheck
pnpm test
pnpm db:migrate          # applies 0010
pnpm test:integration    # the checkout tests — these are the ones that matter
pnpm test:e2e
```

`checkout.itest.ts` expectations were rewritten by hand against the new arithmetic. If any fail, check my numbers before changing the code — the expected values are:

| Case | subtotal | vatTotal | total |
|---|---|---|---|
| DE reduced 7%, 1.29 × 2 | 2.4112 | 0.1688 | 2.5800 |
| UK mixed: 1.20×2 zero + 1.20 standard | 3.4000 | 0.2000 | 3.6000 |
| UK zero only, 1.20 × 3 | 3.6000 | 0.0000 | 3.6000 |

## Still open

- **Existing tenants' prices.** If any shop has entered prices *expecting* VAT to be added, those prices are now 20% too low on standard-rated lines. Given no paying customers yet, this is almost certainly moot — but check before it isn't.
- **Reports.** `stockOnHand` calls `grossValue()` on a **cost**-derived figure. Supplier costs genuinely are ex-VAT, so that one is correct and was left alone. Worth a second look if you ever value stock at retail.
- **Use-by vs best-before.** Still one `expiry_date` column. These are legally distinct in the UK — selling past a *use by* date is a criminal offence, past *best before* is legal and routine. One column now, painful migration later.
- **Where the price data comes from** at onboarding. Unchanged, and still the cold-start problem.
