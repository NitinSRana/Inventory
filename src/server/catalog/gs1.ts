import { normalizeGtin } from './ean.ts';

/**
 * GS1 Application Identifier parsing for a supplier's case/box label —
 * printed as a QR or GS1 DataMatrix, carrying more than a bare GTIN
 * (quantity, batch/lot, expiry, net weight). This is the real, documented
 * GS1 encoding, not a guess at a specific supplier's format.
 *
 * Deliberately does NOT parse or infer a price: GS1's logistics AIs have no
 * standard price field, and the "company internal" range (91-99) means
 * whatever the issuing company decided it means. Guessing there would be a
 * wrong-cost bug with real money on the line, not a UI nicety — so anything
 * outside the identifiers below is surfaced raw in `extra`, unread.
 */

/** ASCII Group Separator — terminates a variable-length AI's value when it
 *  isn't the last element in the string. */
const GS = '\x1D';

export type Gs1Extra = { ai: string; value: string };

export type Gs1Label = {
  gtin: string | null;
  lotNumber: string | null;
  /** ISO yyyy-mm-dd, or null if AI (17) wasn't present or wasn't a real date. */
  expiryDate: string | null;
  quantity: string | null;
  netWeightKg: string | null;
  extra: Gs1Extra[];
};

/**
 * GS1 AI (17) is YYMMDD. Century is inferred per the GS1 general
 * specification (00-50 -> 20xx, 51-99 -> 19xx); day "00" means "last day of
 * the month", also per spec — silently taking it as day zero would produce
 * a batch that reads as already-expired.
 */
function gs1DateToIso(yymmdd: string): string | null {
  const yy = Number(yymmdd.slice(0, 2));
  const mm = Number(yymmdd.slice(2, 4));
  let dd = Number(yymmdd.slice(4, 6));
  if (mm < 1 || mm > 12) return null;
  const year = yy <= 50 ? 2000 + yy : 1900 + yy;
  if (dd === 0) dd = new Date(Date.UTC(year, mm, 0)).getUTCDate();

  const iso = `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  const d = new Date(`${iso}T00:00:00Z`);
  // Rejects calendar-invalid dates (e.g. day 31 in April) that Date would
  // otherwise silently roll into the following month.
  if (Number.isNaN(d.getTime()) || d.getUTCDate() !== dd || d.getUTCMonth() + 1 !== mm) return null;
  return iso;
}

/**
 * Returns the decoded label, or null if `raw` doesn't parse as GS1 at all —
 * the caller's existing plain-barcode path is the correct fallback either
 * way, so this never throws.
 *
 * GS1 element strings are only walkable AI-by-AI when every AI's length is
 * known: a fixed-length AI has no separator, so an AI this parser doesn't
 * recognise makes everything after it unrecoverable. Once that happens the
 * remainder is kept as one raw `extra` entry rather than guessed at.
 */
export function parseGs1(raw: string): Gs1Label | null {
  const input = raw.trim();
  if (input.length === 0) return null;

  const result: Gs1Label = {
    gtin: null,
    lotNumber: null,
    expiryDate: null,
    quantity: null,
    netWeightKg: null,
    extra: [],
  };

  let i = 0;
  let matchedAny = false;

  while (i < input.length) {
    const ai2 = input.slice(i, i + 2);
    const ai4 = input.slice(i, i + 4);

    // (310n) Net weight, kilograms — 4-char AI, 6-digit fixed value, decimal
    // point at position n.
    if (/^310\d$/.test(ai4)) {
      const digits = input.slice(i + 4, i + 10);
      if (!/^\d{6}$/.test(digits)) return matchedAny ? result : null;
      const decimalPlaces = Number(ai4[3]);
      result.netWeightKg = (Number(digits) / 10 ** decimalPlaces).toString();
      i += 4 + 6;
      matchedAny = true;
      continue;
    }

    // (01) GTIN — fixed 14 digits.
    if (ai2 === '01') {
      const digits = input.slice(i + 2, i + 16);
      if (!/^\d{14}$/.test(digits)) return matchedAny ? result : null;
      const gtin = normalizeGtin(digits);
      // A bad checksum invalidates the whole label, not just this AI — the
      // same trust boundary a mistyped plain barcode already crosses.
      if (!gtin) return null;
      result.gtin = gtin;
      i += 2 + 14;
      matchedAny = true;
      continue;
    }

    // (17) Expiration date — fixed 6 digits, YYMMDD.
    if (ai2 === '17') {
      const digits = input.slice(i + 2, i + 8);
      if (!/^\d{6}$/.test(digits)) return matchedAny ? result : null;
      result.expiryDate = gs1DateToIso(digits);
      i += 2 + 6;
      matchedAny = true;
      continue;
    }

    // (10) Batch/lot, (37) Count of trade items — both variable-length,
    // terminated by GS or end of string.
    if (ai2 === '10' || ai2 === '37') {
      const rest = input.slice(i + 2);
      const gsIndex = rest.indexOf(GS);
      const value = gsIndex === -1 ? rest : rest.slice(0, gsIndex);
      if (value.length === 0) return matchedAny ? result : null;
      // AI 37 is numeric by spec — without a GS separator ahead of it, a
      // malformed or unexpected label can hand this branch a run of
      // characters that isn't actually AI 37's value at all. Rejecting a
      // non-numeric result here, rather than propagating `NaN` as a string,
      // is the same defensiveness the fixed-length AIs already get.
      if (ai2 === '37' && !/^\d+$/.test(value)) return matchedAny ? result : null;
      if (ai2 === '10') result.lotNumber = value;
      else result.quantity = String(Number(value));
      i += 2 + value.length + (gsIndex === -1 ? 0 : 1);
      matchedAny = true;
      continue;
    }

    // (91)-(99) Company internal — always variable-length, GS-or-end
    // terminated per the GS1 general specification, but the meaning is
    // whichever company issued the label's own convention. Kept raw.
    if (/^9[1-9]$/.test(ai2)) {
      const rest = input.slice(i + 2);
      const gsIndex = rest.indexOf(GS);
      const value = gsIndex === -1 ? rest : rest.slice(0, gsIndex);
      result.extra.push({ ai: ai2, value });
      i += 2 + value.length + (gsIndex === -1 ? 0 : 1);
      matchedAny = true;
      continue;
    }

    // An AI outside the set above: its length can't be known, so nothing
    // after it can be safely located. Keep the remainder as one opaque
    // segment and stop, rather than desynchronising every field after it.
    if (matchedAny) result.extra.push({ ai: 'unrecognised', value: input.slice(i) });
    break;
  }

  return matchedAny ? result : null;
}
