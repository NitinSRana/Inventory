import { getTranslations } from 'next-intl/server';
import { NextResponse, type NextRequest } from 'next/server';

import { getSessionState } from '@/server/auth/session';
import { REPORT_SLUGS, buildReport, toCsv, type ReportSlug } from '@/server/reports';

/**
 * CSV download for a report.
 *
 * A route handler rather than a server action: this returns a file, and the
 * session check has to happen here too — an export endpoint that trusted the
 * page having already checked would be the easiest way to leak a tenant's
 * entire stock list.
 */
export async function GET(request: NextRequest, ctx: RouteContext<'/[locale]/reports/[slug]/export'>) {
  const { locale, slug } = await ctx.params;

  if (!REPORT_SLUGS.includes(slug as ReportSlug)) {
    return new NextResponse('Not found', { status: 404 });
  }

  const session = await getSessionState();
  if (session.status !== 'ready') {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const days = Number(new URL(request.url).searchParams.get('days')) || 30;
  const report = await buildReport(session.orgId, slug as ReportSlug, days);

  const t = await getTranslations({ locale, namespace: 'reports' });
  const headers = report.columns.map((c) => t(`columns.${c.label}`));

  // BOM so Excel opens UTF-8 correctly — without it "Hartkäse" arrives mangled.
  return new NextResponse(`﻿${toCsv(report, headers)}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${slug}-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
