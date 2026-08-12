import Decimal from 'decimal.js';

/**
 * The checkout cart, encoded as a URL search param.
 *
 * URL state, not useState: a scan submits a real form and the page reloads —
 * matching every other scan flow in this app — so client state would not
 * survive it anyway. A query string does, and it survives a refresh or a
 * locked phone too, which a till on someone's own device needs more than most
 * screens here. Only ids and quantities travel in it; price is never trusted
 * from a URL and is re-read from the product on every render.
 */

export type CartLine = { productId: string; quantity: string };

export function parseCart(param: string | string[] | undefined): CartLine[] {
  if (typeof param !== 'string' || !param) return [];
  return param
    .split(',')
    .map((entry) => {
      const [productId, quantity] = entry.split(':');
      return { productId, quantity };
    })
    .filter((l) => {
      if (!l.productId || !l.quantity) return false;
      try {
        // isPositive() means "not negative" in decimal.js and would let a
        // zero-quantity garbage entry through; greaterThan(0) is the actual
        // check, and this also catches a non-numeric value in a hand-edited
        // or truncated URL rather than throwing out of parseCart entirely.
        return new Decimal(l.quantity).greaterThan(0);
      } catch {
        return false;
      }
    });
}

export function encodeCart(lines: CartLine[]): string {
  return lines.map((l) => `${l.productId}:${l.quantity}`).join(',');
}

/** Adding a product already in the cart increments its line instead of duplicating it. */
export function addToCart(lines: CartLine[], productId: string, quantity: string): CartLine[] {
  const existing = lines.find((l) => l.productId === productId);
  if (!existing) return [...lines, { productId, quantity }];
  return lines.map((l) =>
    l.productId === productId
      ? { productId, quantity: new Decimal(l.quantity).plus(quantity).toString() }
      : l,
  );
}

export function removeFromCart(lines: CartLine[], productId: string): CartLine[] {
  return lines.filter((l) => l.productId !== productId);
}
