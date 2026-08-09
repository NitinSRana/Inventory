/**
 * Barcode validation for EAN-13 and EAN-8.
 *
 * Worth checking in application code rather than leaning on the database: a
 * mistyped barcode is a valid string but points at nothing, and the person
 * finding out is holding a phone in a cold aisle.
 */

/**
 * Returns the normalised barcode, or null if it is not a well-formed EAN-13 or
 * EAN-8. Strips spaces and hyphens, which scanners and humans both introduce.
 */
export function normalizeGtin(raw: string): string | null {
  const digits = raw.trim().replace(/[\s-]/g, '');
  if (!/^(\d{8}|\d{13})$/.test(digits)) return null;

  const body = digits.slice(0, -1);
  const checkDigit = Number(digits[digits.length - 1]);

  // Weights alternate 1/3, arranged so the rightmost body digit always weighs 3.
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    sum += Number(body[i]) * ((body.length - i) % 2 === 1 ? 3 : 1);
  }

  return (10 - (sum % 10)) % 10 === checkDigit ? digits : null;
}
