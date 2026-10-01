import { Skeleton } from "@/components/ui/skeleton";

/**
 * The Settings page while it loads: the parts on the left, the open part beside them, on a phone the
 * list. The profile is built the same way and takes it too, with its own `label`.
 */
export function SettingsSkeleton({ label = "Loading the settings" }: { label?: string }) {
    return (
        <div className="flex min-w-0 overflow-clip rounded-xl border bg-card shadow-sm md:min-h-[calc(100svh-6.75rem)]" aria-busy="true">
            <span className="sr-only">{label}</span>
            <div className="hidden w-64 shrink-0 space-y-4 border-r p-3 md:block lg:w-72">
                <Skeleton className="h-9 w-full" />
                {[3, 3, 4].map((count, group) => (
                    <div key={group} className="space-y-1.5">
                        <Skeleton className="h-3 w-16" />
                        {Array.from({ length: count }, (_, index) => <Skeleton key={index} className="h-8 w-full" />)}
                    </div>
                ))}
            </div>
            <div className="min-w-0 flex-1">
                <div className="space-y-2 border-b px-4 py-5 md:px-6">
                    <Skeleton className="h-5 w-40" />
                    <Skeleton className="h-4 w-full max-w-md" />
                </div>
                <div className="max-w-3xl space-y-6 px-4 py-5 md:px-6">
                    {Array.from({ length: 4 }, (_, index) => (
                        <div key={index} className="space-y-2">
                            <Skeleton className="h-4 w-32" />
                            <Skeleton className="h-9 w-full max-w-md" />
                        </div>
                    ))}
                    <Skeleton className="h-28 w-full" />
                </div>
            </div>
        </div>
    );
}
