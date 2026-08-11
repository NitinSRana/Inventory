import { TEMPLATE_CSV } from '@/server/catalog/import';

/** The template, with a quoted-comma example so the format is self-documenting. */
export async function GET() {
  return new Response(TEMPLATE_CSV, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="catalogue-template.csv"',
    },
  });
}
