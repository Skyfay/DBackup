"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, Archive, ArrowLeft, ArrowRight, ArrowUpRight, Database, Hash, Layers, Server, Tag } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { kindNames } from "@/components/adapter/connection-columns";
import { count } from "@/components/dashboard/storage/explorer/explorer-format";
import { ExplorerStrip, type StripCell } from "@/components/dashboard/storage/explorer/explorer-strip";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { Button } from "@/components/ui/button";
import { PickList, PickTrigger, type PickGroup } from "@/components/ui/pick-list";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DateDisplay } from "@/components/utils/date-display";
import { formatBytes } from "@/lib/utils";
import type { DatabaseOverview, ExplorerDatabase, ExplorerServer, ServerDetails } from "@/services/databases/database-explorer-types";
import { engineOf } from "./database-columns";
import { backupsHref } from "./database-data";
import { compactCount } from "./database-model";
import { serverHref } from "./server-model";

const STATUS: Record<ExplorerServer["status"], string> = { ONLINE: "online", DEGRADED: "missed its last check", OFFLINE: "offline" };

/** Opens another server, grouped by engine. */
function ServerSwitcher({ overview, current }: { overview: DatabaseOverview; current: ExplorerServer }) {
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const engines = [...new Set(overview.servers.map((server) => server.adapterId))];
    const groups: PickGroup[] = engines.map((adapterId) => ({
        heading: kindNames.get(adapterId) ?? adapterId,
        entries: overview.servers.filter((server) => server.adapterId === adapterId).map((server) => ({
            id: server.id,
            name: server.name,
            value: `${server.name} ${kindNames.get(server.adapterId) ?? server.adapterId}`,
            meta: engineOf(server),
            icon: <AdapterIcon adapterId={server.adapterId} className="size-4" />,
        })),
    }));

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <PickTrigger
                    icon={Server}
                    size="sm"
                    leading={<AdapterIcon adapterId={current.adapterId} className="size-4 shrink-0" />}
                    aria-expanded={open}
                    aria-label="Open another server"
                    className="w-full sm:w-72 sm:flex-none"
                >
                    <span className="truncate">
                        {current.name}
                        <span className="text-muted-foreground"> · {kindNames.get(current.adapterId) ?? current.adapterId}</span>
                    </span>
                </PickTrigger>
            </PopoverTrigger>
            <PopoverContent tone="pick" align="end" className="w-80 overflow-hidden bg-raised p-0">
                <PickList
                    icon={Server}
                    title="Open another server"
                    note={`${count(overview.servers.length, "server")} on ${count(engines.length, "engine")}`}
                    groups={groups}
                    value={current.id}
                    emptyText="No server matches."
                    onPick={(id) => {
                        setOpen(false);
                        if (id !== current.id) router.push(serverHref(id));
                    }}
                    searchPlaceholder="Search by server or engine"
                />
            </PopoverContent>
        </Popover>
    );
}

interface ServerPageHeadProps {
    overview: DatabaseOverview;
    server: ExplorerServer;
    details: ServerDetails | null;
    /** The enabled jobs of the server. */
    jobIds: string[];
    canOpenBackups: boolean;
}

/** Back to the list, the server with where it runs, a switch to another one, and its backups and connection. */
export function ServerPageHead({ overview, server, details, jobIds, canOpenBackups }: ServerPageHeadProps) {
    const address = details?.address ? ` on ${details.address}` : "";
    const latency = server.status === "ONLINE" && details?.latencyMs != null ? `, ${details.latencyMs} ms` : "";
    return (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <Button variant="outline" size="icon" className="size-8 shrink-0" asChild>
                <Link href="/dashboard/explorer?tab=servers" aria-label="Back to the servers">
                    <ArrowLeft />
                </Link>
            </Button>
            <span className="flex size-11 shrink-0 items-center justify-center rounded-lg border bg-muted" aria-hidden="true">
                <AdapterIcon adapterId={server.adapterId} className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
                <h2 className="truncate text-lg font-semibold tracking-tight">{server.name}</h2>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{engineOf(server)}{address} · {STATUS[server.status]}{latency}</p>
            </div>
            <div className="flex w-full min-w-0 flex-wrap items-center gap-2 lg:w-auto">
                <ServerSwitcher overview={overview} current={server} />
                {canOpenBackups && overview.coverage && jobIds.length > 0 && (
                    <Button variant="outline" size="sm" asChild>
                        <Link href={backupsHref(jobIds)}>
                            <ArrowRight />
                            Open backups
                        </Link>
                    </Button>
                )}
                <Button variant="outline" size="sm" asChild>
                    <Link href="/dashboard/connections">
                        <ArrowUpRight />
                        Open connection
                    </Link>
                </Button>
            </div>
        </div>
    );
}

/** The numbers of a server: its version, its databases, their size, its kept backups and how often it answered. */
export function ServerStrip({ server, details, databases, coverage }: {
    server: ExplorerServer;
    details: ServerDetails | null;
    databases: ExplorerDatabase[];
    coverage: boolean;
}) {
    const instance = databases.find((database) => database.kind === "instance") ?? null;
    const sized = databases.filter((database) => database.sizeInBytes !== null);
    const size = sized.reduce((sum, database) => sum + (database.sizeInBytes ?? 0), 0);
    const [value, unit] = sized.length > 0 ? formatBytes(size, 1).split(" ") : ["-", undefined];
    const covered = databases.filter((database) => database.jobIds.length > 0).length;
    const holds: StripCell = instance
        ? { label: "Keys", icon: Hash, value: compactCount(instance.keyCount ?? 0), extra: `in ${instance.logical.length} of ${instance.logical.length + instance.emptyLogical} databases` }
        : { label: "Databases", icon: Database, value: databases.length.toLocaleString(), extra: coverage ? `${covered.toLocaleString()} in a job` : "as the server lists them" };

    return (
        <ExplorerStrip
            cells={[
                {
                    label: "Version",
                    icon: Tag,
                    value: server.version ?? "-",
                    extra: server.versionSince
                        ? <>since <DateDisplay date={server.versionSince} format="P" />{server.previousVersion ? `, ${server.previousVersion} before` : ""}</>
                        : "no change seen",
                },
                holds,
                { label: "Stored", icon: Layers, value, unit, extra: sized.length === 0 ? "not told to this login" : `in ${count(sized.length, "database")}` },
                details?.keptBackups != null
                    ? {
                        label: "Backups",
                        icon: Archive,
                        value: details.keptBackups.toLocaleString(),
                        unit: "kept",
                        extra: details.lastBackupAt ? <>the last <RelativeTime date={details.lastBackupAt} /></> : "no job backs it up",
                    }
                    : { label: "Backups", icon: Archive, value: "-", extra: details ? "needs the permission to see backups" : " " },
                {
                    label: "Online",
                    icon: Activity,
                    value: details?.uptime != null ? details.uptime.toLocaleString() : "-",
                    unit: details?.uptime != null ? "%" : undefined,
                    tone: details?.uptime != null && details.uptime < 99 ? "warning" : undefined,
                    extra: details?.uptime != null ? `in 30 days${details.latencyMs != null ? `, ${details.latencyMs} ms now` : ""}` : "no checks yet",
                },
            ]}
        />
    );
}
