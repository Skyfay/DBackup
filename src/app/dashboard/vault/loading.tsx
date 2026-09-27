import { Skeleton } from "@/components/ui/skeleton";

/** The Vault while it loads: its tabs, the numbers and the list. */
export default function VaultLoading() {
    return (
        <div className="space-y-4 md:space-y-6" aria-busy="true">
            <span className="sr-only">Loading the Vault</span>
            <div className="flex items-center gap-2">
                <Skeleton className="h-9 w-56" />
                <Skeleton className="ml-auto h-9 w-32" />
            </div>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border md:grid-cols-5">
                {Array.from({ length: 5 }, (_, index) => (
                    <div key={index} className="space-y-2 bg-card px-4 py-3">
                        <Skeleton className="h-3 w-16" />
                        <Skeleton className="h-6 w-10" />
                        <Skeleton className="h-3 w-24" />
                    </div>
                ))}
            </div>
            <div className="space-y-3 rounded-xl border bg-card p-4 shadow-sm">
                <div className="flex gap-2">
                    <Skeleton className="h-8 w-60" />
                    <Skeleton className="h-8 w-24" />
                </div>
                {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-11 w-full" />)}
            </div>
        </div>
    );
}
