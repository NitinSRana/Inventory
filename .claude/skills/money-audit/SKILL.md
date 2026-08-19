---
name: money-audit
description: Check every money and VAT calculation for the class of bug that types and linters cannot catch - correct-looking arithmetic with wrong domain semantics. Run before any change touching prices, VAT, margins or totals.
---

# Money and VAT audit

The VAT bug that reached the first demo was not a type error, a lint error, or a
test failure. `sellPrice × (1 + rate)` is valid TypeScript, passes every check,
and reads as obviously correct. It was simply the wrong *meaning* — and it
charged customers 20% too much.

Nothing in the toolchain catches that class of bug. Only this kind of reading
does.

## 1. Which side of VAT is each number on?

For every money column and every calculation, state it out loud:

| Field | Meaning | Never |
|---|---|---|
| `products.sell_price` | **Gross.** The shelf price, VAT included. What the customer pays. | Add VAT to it |
| `products.cost_price` | **Net.** Ex-VAT, as it appears on a supplier invoice. | Assume it includes VAT |
| `sale_lines.line_total` | **Gross.** | |
| `sales.subtotal` | **Net**, summed across lines. | |
| `sales.vat_total` | The remainder: gross − net. | Recompute as net × rate |

Flag anything that mixes the two. A margin computed as `sell_price − cost_price`
is comparing a gross number with a net one and is wrong by the VAT rate.

## 2. Rounding

- VAT must be taken as a **remainder** (`gross − net`), never computed
  independently, or `net + vat` will not reconstruct `gross` on prices that
  don't divide cleanly.
- Money is `numeric(12,4)` in the database, displayed at 2dp. Rounding happens
  once, at display, never mid-calculation.
- Never `parseFloat` a money string. `decimal.js` or SQL, always. Float
  arithmetic on money is a bug even when the test passes.

## 3. Multiplication order

`price × quantity` then extract VAT — not extract VAT then multiply. The two
differ by a penny on some inputs, and only the first matches what a customer
sees on a receipt.

## 4. Write the test as a shopper, not a developer

The test that would have caught the original bug is not a unit test of a
formula. It is:

> A basket of a £1.20 zero-rated milk and a £1.20 standard-rated chocolate bar
> totals **£3.60** — exactly the sum of the shelf prices.

For any money change, write the assertion in terms of what a person at the till
hands over. If you cannot state the expected value as a shopper would, the
behaviour is not specified well enough to implement.

## 5. Report

List each finding with file, line, which side of VAT the number is on, and
whether it is consistent with the table above. If everything is consistent, say
so plainly — do not manufacture findings.

Then run `pnpm test:integration`, which is where the checkout arithmetic is
actually exercised.
