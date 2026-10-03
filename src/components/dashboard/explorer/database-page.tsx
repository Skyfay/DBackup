"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { IssueBanner } from "@/components/adapter/connection-details-sections";
import { count } from "@/components/dashboard/storage/explorer/explorer-format";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { DatabaseOverview, ExplorerDbJob } from "@/services/databases/database-explorer-types";
import { readNow, useDatabaseData } from "./database-data";
import { DatabasesEmpty } from "./database-list-parts";
import { DatabasePageHead, DatabaseStrip } from "./database-page-head";
import { PanePrompt } from "./database-pane";
import { DatabaseRows } from "./database-rows";
import { DatabaseTables } from "./database-tables";
import { InstanceDatabases } from "./instance-databases";

/** From `lg` the page is as high as the window below the header and its padding, and the panes fill the rest. */
const PAGE = "flex flex-col gap-4 md:gap-6 lg:h-[calc(100svh-6.75rem)]";
const WORKSPACE = "grid gap-4 md:gap-6 lg:min-h-96 lg:flex-1 lg:grid-cols-[20rem_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]";

function DatabasePageSkeleton() {
    return (
        <div className={PAGE} aria-busy="true">
            <span className="sr-only">Loading the database</span>
            <div className="flex items-center gap-4">
                <Skeleton className="size-8 rounded-md" />
                <Skeleton className="size-11 rounded-lg" />
                <div className="space-y-2">
                    <Skeleton className="h-5 w-40" />
                    <Skeleton className="h-3 w-64" />
                </div>
                <Skeleton className="ml-auto hidden h-8 w-72 lg:block" />
            </div>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border md:grid-cols-5">
                {Array.from({ length: 5 }, (_, index) => (
                    <div key={index} className="space-y-2 bg-card px-4 py-3">
                        <Skeleton className="h-3 w-16" />
                        <Skeleton className="h-5 w-20" />
                    </div>
                ))}
            </div>
            <div className={WORKSPACE}>
                <Skeleton className="h-64 rounded-xl lg:h-full" />
                <Skeleton className="h-64 rounded-xl lg:h-full" />
            </div>
        </div>
    );
}

function BackLink() {
    return (
        <Button variant="outline" className="mt-4" asChild>
            <Link href="/dashboard/explorer">
                <ArrowLeft />
                Back to the Database Explorer
            </Link>
        </Button>
    );
}

interface DatabasePageProps {
    canBrowse: boolean;
    canOpenBackups: boolean;
}

/**
 * A database as a page of its own, opened from the list or the timeline of the Database Explorer:
 * its numbers and its tables with the rows of the one picked, read live and filling the height of
 * the page. A Redis or Valkey server shows its numbered databases and their keys instead. The
 * backups of a day show beside the timeline, not here. What is open lives in the address.
 */
export function DatabasePage({ canBrowse, canOpenBackups }: DatabasePageProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const serverId = searchParams.get("server");
    const name = searchParams.get("database");
    const table = searchParams.get("table");
    const overview = useDatabaseData<DatabaseOverview>("/api/databases");
    const [reading, setReading] = useState(false);
    const data = overview.data;

    const server = data?.servers.find((entry) => entry.id === serverId) ?? null;
    const database = data?.databases.find((entry) => entry.serverId === serverId && (name === null ? entry.kind === "instance" : entry.kind === "database" && entry.name === name)) ?? null;
    const jobsById = useMemo(() => new Map((data?.jobs ?? []).map((job) => [job.id, job])), [data]);
    const jobs = (database?.jobIds ?? []).map((id) => jobsById.get(id)).filter((job): job is ExplorerDbJob => job !== undefined);

    const setParam = useCallback((key: "table", value: string | null) => {
        const params = new URLSearchParams(searchParams.toString());
        if (value) params.set(key, value);
        else params.delete(key);
        router.replace(`/dashboard/explorer/database?${params.toString()}`, { scroll: false });
    }, [router, searchParams]);

    const { reload } = overview;
    const read = useCallback(async () => {
        if (!serverId) return;
        setReading(true);
        try {
            await readNow([serverId]);
        } catch (error: unknown) {
            toast.error(error instanceof Error ? error.message : "The server could not be read.");
        }
        reload();
        setReading(false);
    }, [serverId, reload]);

    if (overview.loading) return <DatabasePageSkeleton />;
    if (!data) {
        return (
            <DatabasesEmpty title="The database could not be loaded">
                {overview.error ?? "Something went wrong."}{" "}
                <Button variant="link" className="h-auto p-0" onClick={overview.reload}>Try again</Button>
            </DatabasesEmpty>
        );
    }
    if (!server || !database) {
        return (
            <DatabasesEmpty title={name ? `${name} is not listed` : "This server is not listed"}>
                {server
                    ? `${server.name} did not list it when DBackup read it last. It may have been dropped or renamed.`
                    : "Its connection may have been removed."}
                <div><BackLink /></div>
            </DatabasesEmpty>
        );
    }

    const instance = database.kind === "instance";
    return (
        <div className={PAGE}>
            <DatabasePageHead overview={data} database={database} server={server} jobs={jobs} canOpenBackups={canOpenBackups} />
            {server.status !== "ONLINE" && <IssueBanner status={server.status} error={null} />}
            <DatabaseStrip database={database} server={server} jobs={jobs} coverage={data.coverage} jobsById={jobsById} />

            {!canBrowse ? (
                <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                    Reading {instance ? "keys" : "tables and rows"} needs the Browse Database Explorer permission.
                </p>
            ) : instance ? (
                <div className={WORKSPACE}>
                    <InstanceDatabases database={database} picked={table} onPick={(value) => setParam("table", value)} reading={reading || overview.reloading} onRead={() => void read()} />
                    {table !== null ? (
                        <DatabaseRows key={`${server.id}/${table}`} sourceId={server.id} adapterId={server.adapterId} database={table} table="Keys" title={`db${table}`} serverName={server.name} />
                    ) : (
                        <PanePrompt>Pick a database to read its keys. They come live from {server.name}.</PanePrompt>
                    )}
                </div>
            ) : (
                <div className={WORKSPACE}>
                    <DatabaseTables sourceId={server.id} database={database.name} serverName={server.name} picked={table} onPick={(value) => setParam("table", value)} />
                    {table !== null ? (
                        <DatabaseRows
                            key={`${server.id}/${database.name}/${table}`}
                            sourceId={server.id}
                            adapterId={server.adapterId}
                            database={database.name}
                            table={table}
                            serverName={server.name}
                        />
                    ) : (
                        <PanePrompt>Pick a table to read its rows. They come live from {server.name}, {count(50, "row")} at a time.</PanePrompt>
                    )}
                </div>
            )}
        </div>
    );
}
