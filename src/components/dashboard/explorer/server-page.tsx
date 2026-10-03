"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, TriangleAlert } from "lucide-react";
import { kindNames } from "@/components/adapter/connection-columns";
import { Banner } from "@/components/dashboard/storage/explorer/backup-details";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { DatabaseOverview, ServerDetails } from "@/services/databases/database-explorer-types";
import { useDatabaseData } from "./database-data";
import { DatabasesEmpty } from "./database-list-parts";
import { ServerDatabases } from "./server-databases";
import { ServerPageHead, ServerStrip } from "./server-page-head";
import { ServerVersions } from "./server-versions";

function ServerPageSkeleton() {
    return (
        <div className="space-y-4 md:space-y-6" aria-busy="true">
            <span className="sr-only">Loading the server</span>
            <div className="flex items-center gap-4">
                <Skeleton className="size-8 rounded-md" />
                <Skeleton className="size-11 rounded-lg" />
                <div className="space-y-2">
                    <Skeleton className="h-5 w-40" />
                    <Skeleton className="h-3 w-64" />
                </div>
            </div>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border md:grid-cols-5">
                {Array.from({ length: 5 }, (_, index) => (
                    <div key={index} className="space-y-2 bg-card px-4 py-3">
                        <Skeleton className="h-3 w-16" />
                        <Skeleton className="h-5 w-20" />
                    </div>
                ))}
            </div>
            <div className="grid gap-4 md:gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
                <Skeleton className="h-80 rounded-xl" />
                <Skeleton className="h-80 rounded-xl" />
            </div>
        </div>
    );
}

/**
 * A database server as a page of its own, opened from the Servers tab of the Database Explorer:
 * where it runs, its numbers, every version it ran with the backups of each, and its databases.
 * A server too old for the newest backups of its engine says so on top.
 */
export function ServerPage({ canOpenBackups }: { canOpenBackups: boolean }) {
    const searchParams = useSearchParams();
    const serverId = searchParams.get("server");
    const overview = useDatabaseData<DatabaseOverview>("/api/databases");
    const details = useDatabaseData<ServerDetails>(serverId ? `/api/databases/servers/${encodeURIComponent(serverId)}` : null, "The server could not be loaded.");
    const data = overview.data;
    const server = data?.servers.find((entry) => entry.id === serverId) ?? null;
    const jobsById = useMemo(() => new Map((data?.jobs ?? []).map((job) => [job.id, job])), [data]);

    if (overview.loading) return <ServerPageSkeleton />;
    if (!data) {
        return (
            <DatabasesEmpty title="The server could not be loaded">
                {overview.error ?? "Something went wrong."}{" "}
                <Button variant="link" className="h-auto p-0" onClick={overview.reload}>Try again</Button>
            </DatabasesEmpty>
        );
    }
    if (!server) {
        return (
            <DatabasesEmpty title="This server is not listed">
                Its connection may have been removed.
                <div>
                    <Button variant="outline" className="mt-4" asChild>
                        <Link href="/dashboard/explorer?tab=servers">
                            <ArrowLeft />
                            Back to the servers
                        </Link>
                    </Button>
                </div>
            </DatabasesEmpty>
        );
    }

    const databases = data.databases.filter((database) => database.serverId === server.id);
    const jobIds = data.jobs.filter((job) => job.enabled && job.serverId === server.id).map((job) => job.id);
    const behind = details.data?.behind ?? null;
    const kind = kindNames.get(server.adapterId) ?? server.adapterId;

    return (
        <div className="space-y-4 md:space-y-6">
            <ServerPageHead overview={data} server={server} details={details.data} jobIds={jobIds} canOpenBackups={canOpenBackups} />
            {behind && (
                <Banner tone="warning" icon={TriangleAlert} title={`Behind ${behind.serverName}`}>
                    Its backups of {kind} {behind.version} do not restore onto {server.name}. With {behind.version} or newer they would.
                </Banner>
            )}
            <ServerStrip server={server} details={details.data} databases={databases} coverage={data.coverage} />
            <div className="grid items-start gap-4 md:gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
                <ServerVersions key={server.id} serverId={server.id} />
                <ServerDatabases server={server} databases={databases} jobsById={jobsById} coverage={data.coverage} />
            </div>
        </div>
    );
}
