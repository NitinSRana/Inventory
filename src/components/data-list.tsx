import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

/**
 * The list pattern for every screen that shows rows of stock data.
 *
 * One bordered container with divided rows, not a stack of separate cards.
 * ui.md calls this a data tool rather than a marketing site: a shop worker is
 * scanning twenty products for one number, and gaps between floating cards cost
 * vertical space and slow that scan down. Dividers give the same grouping in
 * roughly half the height.
 */
export function DataList({ children }: { children: React.ReactNode }) {
  return <ul className="divide-y overflow-hidden rounded-lg border">{children}</ul>;
}

/**
 * A row: label on the left, figures on the right.
 *
 * `href` turns the whole row into a target rather than just the title — the
 * difference between a comfortable tap with gloves on and a fiddly one.
 */
export function DataRow({
  href,
  title,
  subtitle,
  value,
  meta,
  valueClassName = '',
}: {
  href?: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  value?: React.ReactNode;
  meta?: React.ReactNode;
  valueClassName?: string;
}) {
  const body = (
    <>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-medium">{title}</span>
        {subtitle && <span className="text-muted-foreground truncate text-xs">{subtitle}</span>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <div className="flex flex-col items-end gap-0.5">
          {/* Figures are tabular so a column of them lines up when scanned. */}
          {value !== undefined && (
            <span className={`text-sm font-medium tabular-nums ${valueClassName}`}>{value}</span>
          )}
          {meta && <span className="text-muted-foreground text-xs tabular-nums">{meta}</span>}
        </div>
        {href && <ChevronRight aria-hidden className="text-muted-foreground size-4" />}
      </div>
    </>
  );

  // min-h-14: comfortably past the 44px minimum, with room for two lines.
  const className = 'flex min-h-14 items-center justify-between gap-3 px-3 py-2';
  return <li>{href ? <Link href={href} className={className}>{body}</Link> : <div className={className}>{body}</div>}</li>;
}

/**
 * The number a screen exists to communicate, stated before its label.
 * "€20.68 at risk", never "At risk: €20.68".
 */
export function HeadlineFigure({
  value,
  label,
  sub,
  className = '',
}: {
  value: React.ReactNode;
  label: string;
  sub?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className={`text-3xl leading-none font-semibold tabular-nums ${className}`}>
        {value} <span className="text-muted-foreground text-base font-normal">{label}</span>
      </p>
      {sub && <p className="text-muted-foreground text-sm tabular-nums">{sub}</p>}
    </div>
  );
}

/** Every screen states what it is, at one size, in one weight. */
export function PageTitle({ children, count }: { children: React.ReactNode; count?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h1 className="text-xl font-semibold">{children}</h1>
      {count !== undefined && (
        <span className="text-muted-foreground shrink-0 text-sm tabular-nums">{count}</span>
      )}
    </div>
  );
}
