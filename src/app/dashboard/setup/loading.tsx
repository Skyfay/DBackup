import { Skeleton } from "@/components/ui/skeleton";

/** Quick Setup while it loads: its parts stacked on the left, what they add up to beside them. */
export default function SetupLoading() {
    return (
        <div className="grid gap-4 md:gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]" aria-busy="true">
            <span className="sr-only">Loading the quick setup</span>
            <div className="space-y-3">
                <Skeleton className="h-48 rounded-xl" />
                {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-14 rounded-xl" />)}
            </div>
            <Skeleton className="hidden h-96 rounded-xl xl:block" />
        </div>
    );
}
