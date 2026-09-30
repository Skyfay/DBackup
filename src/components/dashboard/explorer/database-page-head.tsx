"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, ArrowLeft, ArrowRight, CalendarClock, Database, Hash, Layers, RefreshCw, Server, Table2, Tag } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { kindNames } from "@/components/adapter/connection-columns";
import { count } from "@/components/dashboard/storage/explorer/explorer-format";
import { ExplorerStrip, type StripCell } from "@/components/dashboard/storage/explorer/explorer-strip";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { Button } from "@/components/ui/button";
import { PickList, PickTrigger, type PickEntry, type PickGroup } from "@/components/ui/pick-list";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DateDisplay } from "@/components/utils/date-display";
import { formatBytes } from "@/lib/utils";
import type { DatabaseOverview, ExplorerDatabase, ExplorerDbJob, ExplorerServer } from "@/services/databases/database-explorer-types";
import { engineOf } from "./database-columns";
import { backupsHref } from "./database-data";
import { compactCount, databaseHref } from "./database-model";

function entryOf(database: ExplorerDatabase, server: ExplorerServer): PickEntry {
    const instance = database.kind === "instance";
    const facts = instance
        ? [engineOf(server), `${compactCount(database.keyCount ?? 0)} keys`]
        : [database.sizeInBytes !== null ? formatBytes(database.sizeInBytes) : null, database.tableCount !== null ? count(database.tableCount, "table") : null];
    return {
        id: database.key,
        name: database.name,
        // Databases of one name live on several servers.
        value: instance ? `${server.name} ${kindNames.get(server.adapterId) ?? server.adapterId}` : `${database.name} ${server.name}`,
        meta: facts.filter(Boolean).join(" · ") || engineOf(server),
        icon: <AdapterIcon adapterId={server.adapterId} className="size-4" />,
    };
}

/** Opens another database of any server, grouped by server like the timeline. */
function DatabaseSwitcher({ overview, current, server }: { overview: DatabaseOverview; current: ExplorerDatabase; server: ExplorerServer }) {
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const groups: PickGroup[] = overview.servers.map((entry) => ({
        heading: entry.name,
        entries: overview.databases.filter((database) => database.serverId === entry.id).map((database) => entryOf(database, entry)),
    }));

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <PickTrigger
                    icon={Database}
                    size="sm"
                    leading={<AdapterIcon adapterId={server.adapterId} className="size-4 shrink-0" />}
                    aria-expanded={open}
                    aria-label="Open another database"
                    className="w-full sm:w-72 sm:flex-none"
                >
                    <span className="truncate">
                        {current.name}
                        <span className="text-muted-foreground"> · {current.kind === "instance" ? kindNames.get(server.adapterId) ?? server.adapterId : server.name}</span>
                    </span>
                </PickTrigger>
            </PopoverTrigger>
            <PopoverContent tone="pick" align="end" className="w-80 overflow-hidden bg-raised p-0">
                <PickList
                    icon={Database}
                    title="Open another database"
                    note={`${count(overview.databases.length, "database")} on ${count(overview.servers.length, "server")}`}
                    groups={groups}
                    value={current.key}
                    emptyText="No database matches."
                    onPick={(key) => {
                        setOpen(false);
                        const picked = overview.databases.find((database) => database.key === key);
                        if (picked && picked.key !== current.key) router.push(databaseHref(picked));
                    }}
                    searchPlaceholder="Search by database or server"
                />
            </PopoverContent>
        </Popover>
    );
}

interface DatabasePageHeadProps {
    overview: DatabaseOverview;
    database: ExplorerDatabase;
    server: ExplorerServer;
    jobs: ExplorerDbJob[];
    canOpenBackups: boolean;
}

/** Back to the list, what is open with its server, a switch to another one, and its backups and jobs. */
export function DatabasePageHead({ overview, database, server, jobs, canOpenBackups }: DatabasePageHeadProps) {
    const facts = database.kind === "instance" ? `${engineOf(server)} · backed up as a whole, every database at once` : `A database of ${server.name} · ${engineOf(server)}`;
    return (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <Button variant="outline" size="icon" className="size-8 shrink-0" asChild>
                <Link href="/dashboard/explorer" aria-label="Back to the Database Explorer">
                    <ArrowLeft />
                </Link>
            </Button>
            <span className="flex size-11 shrink-0 items-center justify-center rounded-lg border bg-muted" aria-hidden="true">
                <AdapterIcon adapterId={server.adapterId} className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
                <h2 className="truncate text-lg font-semibold tracking-tight">{database.name}</h2>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{facts}</p>
            </div>
            <div className="flex w-full min-w-0 flex-wrap items-center gap-2 lg:w-auto">
                <DatabaseSwitcher overview={overview} current={database} server={server} />
                {canOpenBackups && overview.coverage && jobs.length > 0 && (
                    <Button variant="outline" size="sm" asChild>
                        <Link href={backupsHref(jobs.map((job) => job.id))}>
                            <ArrowRight />
                            Open backups
                        </Link>
                    </Button>
                )}
                {overview.coverage && (
                    <Button variant="outline" size="sm" asChild>
                        <Link href={jobs.length > 0 ? `/dashboard/jobs?job=${encodeURIComponent(jobs[0].id)}` : "/dashboard/jobs"}>
                            <CalendarClock />
                            {jobs.length === 0 ? "Open jobs" : jobs.length === 1 ? "Open job" : `Open ${jobs[0].name}`}
                        </Link>
                    </Button>
                )}
            </div>
        </div>
    );
}

/** The numbers of a database, or of an instance with its databases and keys. */
export function DatabaseStrip({ database, server, jobs, coverage, jobsById }: {
    database: ExplorerDatabase;
    server: ExplorerServer;
    jobs: ExplorerDbJob[];
    coverage: boolean;
    jobsById: Map<string, ExplorerDbJob>;
}) {
    const last = database.lastBackup;
    const [size, unit] = database.sizeInBytes === null ? ["-", undefined] : formatBytes(database.sizeInBytes, 1).split(" ");
    const total = database.logical.length + database.emptyLogical;
    const holds: StripCell[] = database.kind === "instance"
        ? [
            { label: "Databases", icon: Database, value: total.toLocaleString(), extra: `${database.logical.length.toLocaleString()} hold keys` },
            { label: "Keys", icon: Hash, value: (database.keyCount ?? 0).toLocaleString(), extra: server.readAt ? <>counted <RelativeTime date={server.readAt} /></> : "not counted yet" },
        ]
        : [
            { label: "Tables", icon: Table2, value: database.tableCount === null ? "-" : database.tableCount.toLocaleString(), extra: database.tableCount === null ? "not told by the server" : "as the server lists them" },
            { label: "Size", icon: Layers, value: size, unit, extra: database.sizeInBytes === null ? "not told by the server" : `on ${server.name}` },
        ];

    return (
        <ExplorerStrip
            cells={[
                ...holds,
                coverage
                    ? {
                        label: "Backed up by",
                        icon: CalendarClock,
                        value: jobs.length === 0 ? "No job" : jobs.length.toLocaleString(),
                        unit: jobs.length > 0 ? (jobs.length === 1 ? "job" : "jobs") : undefined,
                        tone: jobs.length === 0 ? "warning" : undefined,
                        extra: jobs.length === 0 ? "nothing backs it up" : jobs.map((job) => job.name).join(", "),
                    }
                    : { label: "Server", icon: Server, value: server.name, extra: engineOf(server) },
                coverage
                    ? {
                        label: "Last backup",
                        icon: Archive,
                        value: last ? <RelativeTime date={last.at} /> : "-",
                        extra: last ? `${jobsById.get(last.jobId)?.name ?? "A deleted job"}${last.size !== null ? `, ${formatBytes(last.size)}` : ""}` : jobs.length > 0 ? "no run yet" : "never",
                    }
                    : { label: "Read", icon: RefreshCw, value: server.readAt ? <RelativeTime date={server.readAt} /> : "-", extra: "from the server" },
                {
                    label: "Version",
                    icon: Tag,
                    value: server.version ?? "-",
                    extra: server.previousVersion && server.versionSince
                        ? <>{server.previousVersion} before, since <DateDisplay date={server.versionSince} format="P" /></>
                        : "no change seen",
                },
            ]}
        />
    );
}
