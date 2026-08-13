import { ChevronRight } from 'lucide-react';
import Link from 'next/link';

import { Skeleton } from '@/components/ui/skeleton';

/**
 * The type scale.
 *
 * Five steps, and every screen draws from these rather than picking a size.
 * Each one steps up once at `md`, where the reader is at a desk on a real
 * monitor rather than holding a phone at arm's length in an aisle:
 *
 * | Step     | Classes                                  | Used for                          |
 * |----------|------------------------------------------|-----------------------------------|
 * | display  | `text-5xl md:text-6xl font-semibold`     | HeadlineFigure. One per screen.   |
 * | h1       | `text-2xl md:text-3xl font-semibold`     | PageTitle. One per screen.        |
 * | h2       | `text-lg md:text-xl font-semibold`       | A real subsection with a title.   |
 * | eyebrow  | `text-xs font-medium uppercase tracking-wider` | Group labels above a list.  |
 * | body     | `text-base` / secondary `text-sm`        | Row titles / subtitles.           |
 *
 * Sizes are not the hierarchy on their own — weight and colour carry as much
 * of it. A muted `text-sm` subtitle under a `text-base` title reads as
 * secondary because of the colour, not the two pixels.
 */

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
 * top-14 matches the app header's h-14 exactly. At top-12 an 8px strip of
 * scrolling content showed through the gap between the two.
 */
export function DataGroupHeader({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <li className="bg-muted text-muted-foreground sticky top-14 z-10 flex h-8 items-center justify-between px-4 text-xs font-medium tracking-wider uppercase">
      <span className="truncate">{children}</span>
      {right && <span className="shrink-0 tabular-nums">{right}</span>}
    </li>
  );
}

/**
 * The eyebrow label above a group of things — "CATALOGUE", "SETTINGS".
 *
 * Its own component because the sidebar and the More screen were carrying
 * identical copies of the same five utilities, and a third caller was about to.
 */
export function SectionHeading({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <h2 className={`text-muted-foreground text-xs font-medium tracking-wider uppercase ${className}`}>
      {children}
    </h2>
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
  wrap = false,
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
  /**
   * Let the left column wrap instead of truncating. For rows whose subtitle is
   * a sentence that has to be read — a report's blurb — rather than an
   * identifier that only has to be recognised, like a barcode.
   */
  wrap?: boolean;
}) {
  const clip = wrap ? '' : 'truncate';
  const body = (
    <>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className={`text-base font-medium ${clip}`}>{title}</span>
        {subtitle && <span className={`text-muted-foreground text-sm ${clip}`}>{subtitle}</span>}
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
      <p className={`text-5xl leading-none font-semibold tracking-tight md:text-6xl ${className}`}>
        {value}
      </p>
      {caption && <p className="text-muted-foreground text-sm">{caption}</p>}
    </div>
  );
}

/** Screen title, in flow. The sticky header carries its own 14px copy. */
export function PageTitle({ children, caption }: { children: React.ReactNode; caption?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{children}</h1>
      {caption && <p className="text-muted-foreground text-sm">{caption}</p>}
    </div>
  );
}
