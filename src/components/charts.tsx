import Decimal from 'decimal.js';

/**
 * Charts, server-rendered, with no charting library and no client JavaScript.
 *
 * A charting package would be the largest dependency in this project and the
 * only reason to ship JavaScript to a screen that shows numbers. A ranked bar
 * is a div with a width; a 30-day trend is one SVG path's worth of rectangles.
 *
 * Both carry their figures as text as well as length, which is the same rule
 * the rest of the app follows: a reader who cannot compare two bar heights —
 * on a phone, at an angle, at arm's length — still gets the number.
 */

/** Ratios only. The result sets a width or a height, never a figure on screen. */
function ratio(value: string, max: string): number {
  const m = new Decimal(max);
  if (m.lessThanOrEqualTo(0)) return 0;
  return new Decimal(value).dividedBy(m).toNumber();
}

/**
 * Horizontal bars, biggest first. HTML rather than SVG: a bar is a box with a
 * width, and text in a box wraps, truncates and scales without any of the work
 * the same thing costs inside an SVG.
 */
export function RankedBars({
  items,
  format,
  emptyLabel,
}: {
  items: { label: string; value: string }[];
  format: (value: string) => string;
  emptyLabel: string;
}) {
  if (items.length === 0) {
    return <p className="text-muted-foreground text-sm">{emptyLabel}</p>;
  }

  const max = items.reduce((m, i) => (new Decimal(i.value).greaterThan(m) ? i.value : m), '0');

  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => (
        <li key={item.label} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate">{item.label}</span>
            <span className="shrink-0 font-medium tabular-nums">{format(item.value)}</span>
          </div>
          {/* aria-hidden: the row above already states the label and the figure,
              so the bar is decoration for the eye and noise for a reader. */}
          <div aria-hidden className="bg-muted h-2 overflow-hidden rounded-full">
            <div
              className="bg-foreground/70 h-full rounded-full"
              style={{ width: `${Math.max(ratio(item.value, max) * 100, 1)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * A day-by-day trend as bars.
 *
 * Bars rather than a line: the series is a count per day, not a continuous
 * measurement, and a line between two days implies values in between that were
 * never observed. Zero-days are part of the data — a closed Sunday is a fact —
 * so they render as an empty column rather than being skipped.
 */
export function TrendBars({
  points,
  format,
  label,
}: {
  points: { day: string; value: string }[];
  format: (value: string) => string;
  /** Describes the whole chart for anyone who cannot see it. */
  label: string;
}) {
  const total = points.reduce((sum, p) => sum.plus(p.value), new Decimal(0));
  const max = points.reduce((m, p) => (new Decimal(p.value).greaterThan(m) ? p.value : m), '0');
  const peak = points.find((p) => p.value === max);

  const width = 300;
  const height = 64;
  const gap = 1;
  const barWidth = points.length > 0 ? width / points.length : width;

  return (
    <figure className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        // Fixed box, fluid width: no measuring, no resize listener, no JS.
        className="text-foreground/70 h-16 w-full"
        role="img"
        aria-label={label}
      >
        {points.map((p, i) => {
          const h = new Decimal(max).lessThanOrEqualTo(0) ? 0 : ratio(p.value, max) * height;
          return (
            <rect
              key={p.day}
              x={i * barWidth}
              // A zero day still shows a 1px foot, so an empty column reads as
              // "nothing happened" rather than as a gap in the chart itself.
              y={height - Math.max(h, 1)}
              width={Math.max(barWidth - gap, 1)}
              height={Math.max(h, 1)}
              fill="currentColor"
              rx={1}
            />
          );
        })}
      </svg>
      <figcaption className="text-muted-foreground flex flex-wrap justify-between gap-x-4 text-xs tabular-nums">
        <span>{points[0]?.day}</span>
        {peak && new Decimal(peak.value).greaterThan(0) && (
          <span>
            {peak.day} · {format(peak.value)}
          </span>
        )}
        <span>{points[points.length - 1]?.day}</span>
      </figcaption>
      <p className="sr-only">{format(total.toFixed(2))}</p>
    </figure>
  );
}
