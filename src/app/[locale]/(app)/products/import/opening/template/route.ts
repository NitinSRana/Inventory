import { OPENING_STOCK_TEMPLATE_CSV } from '@/server/stock/opening-stock';

/** Barcodes match the catalogue template's, so the two files line up. */
export async function GET() {
  return new Response(OPENING_STOCK_TEMPLATE_CSV, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="opening-stock-template.csv"',
    },
  });
}
