import { ChevronRight } from 'lucide-react';
import Link from 'next/link';

import { Skeleton } from '@/components/ui/skeleton';

/**
 * The list pattern every stock screen uses.
 *
 * One bordered container with hairline dividers, not a card per row. A card
 * costs roughly 24px of shadow and gutter and buys nothing: 56px rows put
 * eleven products on a 375×812 screen, floating cards manage five.
 */
export function DataList({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <ul className="divide-border divide-y">{children}</ul>
    </div>
  );
}

/**
 * Sticky group header. Keeps a 40-row list navigable without a scrollbar by
 * never letting the reader lose which bucket they are in.
 *
 * top-12 clears the sticky app header above it.
 */
export function DataGroupHeader({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <li className="bg-muted text-muted-foreground sticky top-12 z-10 flex h-8 items-center justify-between px-4 text-xs font-medium tracking-wider uppercase">
      <span className="truncate">{children}</span>
      {right && <span className="shrink-0 tabular-nums">{right}</span>}
    </li>
  );
}

/**
 * A row: identity left, number right.
 *
 * The left column truncates — German product names are long and the barcode
 * underneath disambiguates when the name clips. **The right column never
 * truncates**: a clipped quantity is a wrong quantity.
 *
 * `tall` gives the 64px variant the expiry dashboard needs for its chip.
 */
export function DataRow({
  href,
  title,
  subtitle,
  value,
  meta,
  valueClassName = '',
  tall = false,
  tinted = false,
}: {
  href?: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  value?: React.ReactNode;
  meta?: React.ReactNode;
  valueClassName?: string;
  tall?: boolean;
  /** For over-delivery and below-minimum rows — money at risk, stated in place. */
  tinted?: boolean;
}) {
  const body = (
    <>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-base font-medium">{title}</span>
        {subtitle && <span className="text-muted-foreground truncate text-sm">{subtitle}</span>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <div className="flex flex-col items-end gap-0.5">
          {value !== undefined && (
            <span className={`text-base font-semibold ${valueClassName}`}>{value}</span>
          )}
          {meta && <span className="text-muted-foreground text-sm">{meta}</span>}
        </div>
        {href && <ChevronRight aria-hidden className="text-muted-foreground size-4" />}
      </div>
    </>
  );

  const className = [
    'grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3',
    tall ? 'min-h-16' : 'min-h-14',
    tinted ? 'bg-warning-subtle' : '',
  ].join(' ');

  return <li>{href ? <Link href={href} className={className}>{body}</Link> : <div className={className}>{body}</div>}</li>;
}

/**
 * Skeleton rows that mirror the real ones exactly — same height, same two
 * columns, varied widths so it reads as text rather than a loading pattern.
 * Nothing shifts when the data lands, and that shift is what makes a fast app
 * feel slow.
 */
export function DataListSkeleton({ rows = 6, tall = false }: { rows?: number; tall?: boolean }) {
  const widths = ['w-40', 'w-56', 'w-32', 'w-48', 'w-36', 'w-52'];
  return (
    <div className="overflow-hidden rounded-lg border">
      <ul className="divide-border divide-y">
        {Array.from({ length: rows }, (_, i) => (
          <li
            key={i}
            className={`grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 ${tall ? 'min-h-16' : 'min-h-14'}`}
          >
            <div className="flex flex-col gap-1.5">
              <Skeleton className={`h-4 ${widths[i % widths.length]}`} />
              <Skeleton className="h-3 w-24" />
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <Skeleton className="h-4 w-14" />
              <Skeleton className="h-3 w-10" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The one display figure a screen is allowed. Number before label — the eye
 * lands on the digit, not on the word in front of it.
 */
export function HeadlineFigure({
  label,
  value,
  caption,
  className = '',
}: {
  label: string;
  value: React.ReactNode;
  caption?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="flex flex-col gap-1 px-4 py-8">
      <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">{label}</p>
      <p className={`text-5xl leading-none font-semibold tracking-tight ${className}`}>{value}</p>
      {caption && <p className="text-muted-foreground text-sm">{caption}</p>}
    </div>
  );
}

/** Screen title, in flow. The sticky header carries its own 14px copy. */
export function PageTitle({ children, caption }: { children: React.ReactNode; caption?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">{children}</h1>
      {caption && <p className="text-muted-foreground text-sm">{caption}</p>}
    </div>
  );
}
