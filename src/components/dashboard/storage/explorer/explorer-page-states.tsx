"use client";

import { HardDrive } from "lucide-react";
import { JOIN_END, JOIN_MIDDLE } from "@/components/ui/page-head";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** The numbers and a list, while the Backups page loads them. `joined` fits them under the tabs of the page, see `PageHead`. */
export function ExplorerSkeleton({ joined = false }: { joined?: boolean }) {
    return (
        <div className={cn("space-y-4", joined ? "md:space-y-0" : "md:space-y-6")} aria-busy="true">
            <span className="sr-only">Loading the backups</span>
            <div className={cn("grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border md:grid-cols-5", joined && JOIN_MIDDLE)}>
                {Array.from({ length: 5 }, (_, index) => (
                    <div key={index} className="space-y-2 bg-card px-4 py-3">
                        <Skeleton className="h-3 w-16" />
                        <Skeleton className="h-5 w-20" />
                    </div>
                ))}
            </div>
            <div className={cn("space-y-3 rounded-xl border bg-card p-4 shadow-sm", joined && JOIN_END)}>
                <div className="flex gap-2">
                    <Skeleton className="h-8 w-64" />
                    <Skeleton className="h-8 w-40" />
                </div>
                {Array.from({ length: 6 }, (_, index) => (
                    <div key={index} className="flex items-center gap-4 py-1.5">
                        <Skeleton className="h-4 w-44" />
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="ml-auto h-4 w-16" />
                        <Skeleton className="h-5 w-40 rounded-md" />
                    </div>
                ))}
            </div>
        </div>
    );
}

/** What the Backups page shows when it has nothing to list or could not load it. */
export function ExplorerEmpty({ title, children, joined = false }: { title: string; children: React.ReactNode; joined?: boolean }) {
    return (
        <div className={cn("rounded-xl border border-dashed bg-card px-4 py-16 text-center shadow-sm", joined && `md:border-solid ${JOIN_END}`)}>
            <HardDrive className="mx-auto mb-4 size-10 text-muted-foreground/40" aria-hidden="true" />
            <p className="font-medium">{title}</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{children}</p>
        </div>
    );
}
