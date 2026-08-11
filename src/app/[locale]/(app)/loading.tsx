import { Skeleton } from '@/components/ui/skeleton';

/**
 * Shared fallback for every signed-in screen. Skeletons rather than a spinner:
 * a centred spinner shifts the layout when content lands, and most screens here
 * are a heading followed by a list.
 */
export default function AppLoading() {
  return (
    <main className="flex flex-1 flex-col gap-4 p-4">
      <Skeleton className="h-8 w-40" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    </main>
  );
}
