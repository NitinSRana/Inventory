/**
 * CSV parsing for catalogue import.
 *
 * Hand-rolled rather than a dependency, but not naive: wholesaler exports are
 * full of quoted fields with commas in them ("Milch, fettarm"), and splitting on
 * commas would silently shear those rows in half. Follows RFC 4180 — quoted
 * fields, "" as an escaped quote, embedded newlines, CRLF or LF.
 */
/**
 * Picks the delimiter from the header line.
 *
 * It has to be one or the other, never both: German Excel writes semicolon-
 * separated files where the comma is the DECIMAL separator, so treating both as
 * delimiters shears "0,79" into two fields and imports a null price.
 */
function detectDelimiter(text: string): ',' | ';' {
  const header = text.split(/\r?\n/, 1)[0] ?? '';
  let commas = 0;
  let semicolons = 0;
  let inQuotes = false;
  for (let i = 0; i < header.length; i++) {
    const c = header[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (!inQuotes && c === ',') commas++;
    else if (!inQuotes && c === ';') semicolons++;
  }
  return semicolons > commas ? ';' : ',';
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  // Strip a UTF-8 BOM: Excel writes one, and it would poison the first header.
  if (text.charCodeAt(0) === 0xfeff) i = 1;

  const delimiter = detectDelimiter(text.slice(i));

  for (; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') inQuotes = true;
    else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\r') {
      // Swallow; the \n that follows ends the row.
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop trailing blank lines, which every spreadsheet export leaves behind.
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/** Header aliases, so a store's own column names mostly just work. */
const COLUMNS: Record<string, string[]> = {
  name: [
    'name',
    'product',
    'productname',
    'itemname',
    'item',
    'description',
    'artikel',
    'artikelname',
    'bezeichnung',
  ],
  gtin: ['gtin', 'barcode', 'ean', 'ean13', 'upc', 'unitbarcode'],
  caseGtin: ['casegtin', 'casebarcode', 'outerbarcode', 'outer', 'itf14'],
  unitsPerCase: ['unitspercase', 'packsize', 'casesize', 'perkarton'],
  sku: ['sku', 'article', 'articleno', 'artikelnummer', 'code'],
  unit: ['unit', 'uom', 'einheit'],
  costPrice: ['cost', 'costprice', 'buyprice', 'ek', 'einkaufspreis'],
  sellPrice: ['price', 'sellprice', 'retail', 'vk', 'verkaufspreis'],
  // 'vatrate' and 'taxcode' are what UK wholesaler exports tend to call it.
  vatBand: ['vatband', 'vat', 'vatrate', 'vatcode', 'taxcode', 'taxband', 'mwst'],
  minStock: ['min', 'minstock', 'minimum'],
  shelfLifeDays: ['shelflife', 'shelflifedays', 'mhd', 'haltbarkeit'],
  supplier: ['supplier', 'vendor', 'lieferant'],
};

const normalise = (h: string) => h.trim().toLowerCase().replace(/[\s_\-.]/g, '');

/** Maps a header row to field names. Unknown columns are ignored, not fatal. */
export function mapHeaders(header: string[]): Record<string, number> {
  const index: Record<string, number> = {};
  header.forEach((raw, i) => {
    const h = normalise(raw);
    for (const [field, aliases] of Object.entries(COLUMNS)) {
      if (aliases.includes(h) && !(field in index)) index[field] = i;
    }
  });
  return index;
}
