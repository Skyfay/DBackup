import { Skeleton } from "@/components/ui/skeleton";

/** The restore page while it loads: the backup on top, its steps, its rows and the bar at its foot. */
export default function RestoreLoading() {
    return (
        <div className="space-y-4 md:space-y-6" aria-busy="true">
            <span className="sr-only">Loading the restore</span>
            <div className="flex items-center gap-3">
                <Skeleton className="h-8 w-24" />
                <Skeleton className="size-10 shrink-0 rounded-lg" />
                <div className="min-w-0 space-y-2">
                    <Skeleton className="h-5 w-56" />
                    <Skeleton className="h-3 w-72 max-w-full" />
                </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
                <Skeleton className="h-16 rounded-xl" />
                <Skeleton className="h-16 rounded-xl" />
            </div>
            <div className="space-y-3 rounded-xl border bg-card p-4 shadow-sm">
                <Skeleton className="h-8 w-60" />
                {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-12 w-full" />)}
            </div>
            <Skeleton className="h-16 rounded-xl" />
        </div>
    );
}
