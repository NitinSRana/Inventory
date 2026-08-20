import { DataListSkeleton } from '@/components/data-list';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Mirrors the real page: title with a row-count caption, the period pills
 * (shown for time-bounded reports — harmless to render for the point-in-time
 * ones too, since it disappears the instant real data lands), then rows.
 */
export default function ReportLoading() {
  return (
    <main className="flex flex-1 flex-col gap-4 p-4">
      <div className="flex flex-col gap-1">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-11 w-20" />
        <Skeleton className="h-11 w-20" />
        <Skeleton className="h-11 w-20" />
      </div>
      <DataListSkeleton rows={8} />
    </main>
  );
}
