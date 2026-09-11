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

    /*
     * A quote opens a quoted field only as the field's FIRST character. RFC
     * 4180 says so, and this catalogue is the reason it matters: it is full of
     * inch marks — `10" BAMBOO STEAMER`, `RICE VERMICELLI 4" 15kg` — which a
     * hand-made export writes bare rather than doubling.
     *
     * Treating those as an opening quote did not merely drop the character. It
     * put the parser into quoted mode for the rest of the file, so every
     * delimiter and newline after it became literal text and the entire
     * remainder collapsed into one field. One inch mark, one product, whole
     * file gone.
     */
    if (c === '"' && field === '') inQuotes = true;
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

/**
 * Repairs the two quoting defects this shop's export produces.
 *
 * This catalogue's export writes some rows encoded once and others encoded
 * twice, in the same file:
 *
 *   "RICE VERMICELLI 4"" 15kg"                      -> once, correct
 *   """10"""""""" BAMBOO STEAMER (25.4CM) 30PCS"""  -> twice
 *
 * Parsing the second one correctly yields `"10"""" BAMBOO STEAMER..."`, which
 * is a faithful decode of a value that was already wrong when it arrived. Ten
 * product names in this shop looked like that.
 *
 * Two rules, applied until the value stops changing: drop a matching pair of
 * outer quotes, then halve any EVEN run of quotes. An odd run is left alone —
 * that is a real inch mark, which is exactly what these names contain. A value
 * from a correctly-encoded file never matches either rule, so this is a no-op
 * the moment the export is fixed upstream.
 *
 * The second defect is a name that was cut off mid-field, which leaves the
 * opening quote with nothing to close it:
 *
 *   "LL MOCHI - ASSORTED TROPICAL FRUIT (PINEAPPLE
 *
 * That quote is punctuation from a field that no longer exists, and it is
 * dropped. The missing words are NOT invented — the unbalanced bracket stays
 * exactly where it is, so the row still looks wrong to whoever reads it, which
 * is the only honest outcome when the text is gone from every source file.
 */
export function repairExportQuoting(value: string): string {
  let out = value;
  for (let i = 0; i < 10; i++) {
    let next = out;
    if (next.length > 1 && next.startsWith('"') && next.endsWith('"')) next = next.slice(1, -1);
    next = next.replace(/"+/g, (run) => (run.length % 2 === 0 ? '"'.repeat(run.length / 2) : run));
    if (next === out) break;
    out = next;
  }
  // An opening quote with no closing one anywhere: the field was truncated.
  if (out.startsWith('"') && !out.slice(1).includes('"')) out = out.slice(1);
  return out;
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

/**
 * Maps a header row to field names, against whichever alias table applies.
 *
 * Unknown columns are still not fatal — a wholesaler export carries a dozen
 * columns this product has no field for, and refusing the file over them would
 * be useless. They are reported instead: a column silently dropped because
 * "Retail Price" was spelled in a way no alias covers is the failure someone
 * only discovers weeks later, at the till, on a product priced null.
 */
export function mapColumns(
  header: string[],
  columns: Record<string, string[]>,
): { index: Record<string, number>; unknown: string[] } {
  const index: Record<string, number> = {};
  const unknown: string[] = [];
  header.forEach((raw, i) => {
    const h = normalise(raw);
    // A trailing delimiter leaves an empty header cell in most exports. That is
    // a formatting artefact, not a column the shop meant to send.
    if (h === '') return;
    let matched = false;
    for (const [field, aliases] of Object.entries(columns)) {
      if (aliases.includes(h)) {
        matched = true;
        if (!(field in index)) index[field] = i;
      }
    }
    if (!matched) unknown.push(raw.trim());
  });
  return { index, unknown };
}

/** The catalogue file's columns. */
export const mapHeaders = (header: string[]) => mapColumns(header, COLUMNS);

/**
 * The opening-stock file's columns — a different question about the same shop,
 * so a different table. It names a product that already exists and says how
 * much of it is on the shelf; nothing here creates or edits a product.
 */
export const OPENING_STOCK_COLUMNS: Record<string, string[]> = {
  gtin: COLUMNS.gtin,
  sku: COLUMNS.sku,
  quantity: ['quantity', 'qty', 'count', 'counted', 'stock', 'onhand', 'menge', 'bestand', 'anzahl'],
  expiryDate: [
    'expiry',
    'expirydate',
    'expires',
    'bestbefore',
    'bestbeforedate',
    'useby',
    'usebydate',
    'mhd',
    'haltbarkeitsdatum',
    'ablaufdatum',
  ],
  lotNumber: ['lot', 'lotnumber', 'batch', 'batchnumber', 'charge', 'chargennummer'],
  unitCost: ['cost', 'unitcost', 'costprice', 'buyprice', 'ek', 'einkaufspreis'],
};
