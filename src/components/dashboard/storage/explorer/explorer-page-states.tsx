"use client";

import { HardDrive } from "lucide-react";
import { Button } from "@/components/ui/button";
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

/** The whole Backups page while its index loads: the row of the tabs, then the numbers and a list. */
export function ExplorerPageSkeleton() {
    return (
        <div className="space-y-4 md:space-y-6">
            <div className="flex flex-wrap items-center gap-2 md:gap-3">
                <Skeleton className="h-9 w-56" />
                <Skeleton className="ml-auto h-9 w-40" />
            </div>
            <ExplorerSkeleton />
        </div>
    );
}

interface BackupsPendingProps {
    /** Why the own backups could not be loaded. */
    error: string | null;
    /** Why the shared backups could not be loaded, for a tenant with nothing of its own. */
    sharedError: string | null;
    onRetryShared: () => void;
    /** Everything loaded and there is no backup at all. */
    empty: boolean;
}

/** The Backups tab before its list shows: why the backups could not load, that there is none yet, or a skeleton. */
export function BackupsPending({ error, sharedError, onRetryShared, empty }: BackupsPendingProps) {
    if (error) return <ExplorerEmpty joined title="The backups could not be loaded">{error}</ExplorerEmpty>;
    if (sharedError) {
        return (
            <ExplorerEmpty joined title="The backups shared with you could not be loaded">
                {sharedError}{" "}
                <Button variant="link" className="h-auto p-0" onClick={onRetryShared}>Try again</Button>
            </ExplorerEmpty>
        );
    }
    if (empty) {
        return (
            <ExplorerEmpty joined title="No backups yet">
                The backups of the databases shared with you appear here once their provider backed them up, and your own once a job has written to a destination.
            </ExplorerEmpty>
        );
    }
    return <ExplorerSkeleton joined />;
}

/** Holds the place of what needs every backup while they load, or says why they did not. */
export function RunsPending({ error, onRetry, className }: { error: string | null; onRetry: () => void; className: string }) {
    if (!error) return <Skeleton className={cn("w-full", className)} />;
    return (
        <div className={cn("flex w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-4 text-center text-sm", className)}>
            <p className="font-medium">The backups could not be loaded</p>
            <p className="text-muted-foreground">
                {error}{" "}
                <Button variant="link" className="h-auto p-0" onClick={onRetry}>Try again</Button>
            </p>
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
