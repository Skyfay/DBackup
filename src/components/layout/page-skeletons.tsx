import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** The numbers of a list or a record while they load, five tiles like `ExplorerStrip`. */
function StripSkeleton() {
    return (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border md:grid-cols-5">
            {Array.from({ length: 5 }, (_, index) => (
                <div key={index} className="space-y-2 bg-card px-4 py-3">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-6 w-10" />
                    <Skeleton className="h-3 w-24" />
                </div>
            ))}
        </div>
    );
}

/**
 * A page of lists while it loads, the shape of every list page: the tabs with the New button,
 * the numbers and the card of the list. `label` is what a screen reader hears meanwhile.
 */
export function ListPageSkeleton({ label, tabsClassName = "md:w-80", rows = 6, rowClassName = "h-11" }: { label: string; tabsClassName?: string; rows?: number; rowClassName?: string }) {
    return (
        <div className="space-y-4 md:space-y-6" aria-busy="true">
            <span className="sr-only">{label}</span>
            <div className="flex items-center gap-2">
                <Skeleton className={cn("h-9 w-full", tabsClassName)} />
                <Skeleton className="ml-auto h-9 w-9 shrink-0 sm:w-32" />
            </div>
            <StripSkeleton />
            <div className="space-y-3 rounded-xl border bg-card p-4 shadow-sm">
                <div className="flex gap-2">
                    <Skeleton className="h-8 w-60" />
                    <Skeleton className="h-8 w-24" />
                </div>
                {Array.from({ length: rows }, (_, index) => <Skeleton key={index} className={cn("w-full", rowClassName)} />)}
            </div>
        </div>
    );
}

/** The page of one record while it loads, like a run or a database: its head, its numbers and its panes. */
export function RecordPageSkeleton({ label }: { label: string }) {
    return (
        <div className="space-y-4 md:space-y-6" aria-busy="true">
            <span className="sr-only">{label}</span>
            <div className="flex items-center gap-3">
                <Skeleton className="h-8 w-24" />
                <Skeleton className="size-10 shrink-0 rounded-lg" />
                <div className="min-w-0 space-y-2">
                    <Skeleton className="h-5 w-48" />
                    <Skeleton className="h-3 w-64 max-w-full" />
                </div>
            </div>
            <StripSkeleton />
            <div className="grid gap-4 md:gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                <Skeleton className="h-80 rounded-xl" />
                <Skeleton className="h-80 rounded-xl" />
            </div>
        </div>
    );
}
