import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const panel = "rounded-xl border bg-card shadow-sm";

/**
 * Shown the moment the Overview is opened, while the server renders it. Shaped like the page, so
 * the content drops into place instead of pushing things around. The route group keeps this from
 * showing up for the other dashboard pages.
 */
export default function OverviewLoading() {
    return (
        <div className="space-y-4 md:space-y-6" aria-busy="true">
            <span className="sr-only">Loading overview</span>

            <div className={cn(panel, "flex items-center gap-3 p-4")}>
                <Skeleton className="size-9 shrink-0 rounded-lg" />
                <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-3 w-72 max-w-full" />
                </div>
            </div>

            <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
                {Array.from({ length: 4 }, (_, i) => (
                    <div key={i} className={cn(panel, "space-y-3 p-4 md:p-5")}>
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-8 w-20" />
                        <Skeleton className="h-3 w-28" />
                        <Skeleton className="h-10 w-full" />
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border shadow-sm md:grid-cols-4 xl:grid-cols-8">
                {Array.from({ length: 8 }, (_, i) => (
                    <div key={i} className="space-y-2 bg-card px-4 py-3">
                        <Skeleton className="h-3 w-20" />
                        <Skeleton className="h-6 w-10" />
                    </div>
                ))}
            </div>

            <div className={cn(panel, "space-y-3 p-4 md:p-5")}>
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-24 w-full" />
            </div>

            <div className="grid gap-4 md:gap-6 xl:grid-cols-3">
                <div className={cn(panel, "space-y-4 p-4 md:p-5 xl:col-span-2")}>
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-44 w-full md:h-52" />
                    <div className="space-y-3 border-t pt-4">
                        {Array.from({ length: 6 }, (_, i) => (
                            <Skeleton key={i} className="h-10 w-full" />
                        ))}
                    </div>
                </div>
                <div className="grid content-start gap-4 md:grid-cols-2 md:gap-6 xl:grid-cols-1">
                    <div className={cn(panel, "space-y-4 p-4 md:p-5")}>
                        <Skeleton className="h-4 w-40" />
                        {Array.from({ length: 4 }, (_, i) => (
                            <Skeleton key={i} className="h-9 w-full" />
                        ))}
                    </div>
                    <div className={cn(panel, "space-y-4 p-4 md:p-5")}>
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-36 w-full" />
                    </div>
                </div>
            </div>
        </div>
    );
}
