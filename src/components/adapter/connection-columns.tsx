"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { DateDisplay } from "@/components/utils/date-display";
import { ADAPTER_DEFINITIONS } from "@/lib/adapters/definitions";
import { formatBytes } from "@/lib/utils";
import type { AdapterConfig } from "./types";
import { connectionAddress, connectionSshHost, connectionVersion } from "./connection-summary";
import {
    CredentialCell,
    HealthBars,
    LastRunCell,
    Muted,
    NameCell,
    StatusCell,
    UsedByCell,
    type ConnectionHealth,
} from "./connection-cells";

/** The four lists on the Connections page. Each keeps its own column layout. */
export type ConnectionKind = "database" | "source" | "destination" | "notification";

interface ColumnOptions {
    kind: ConnectionKind;
    /** Opens the health check history from the status. */
    canViewHealth: boolean;
    renderActions: (config: AdapterConfig) => React.ReactNode;
    /** Opens the details panel of a connection. */
    onOpen?: (config: AdapterConfig) => void;
}

export const kindNames = new Map(ADAPTER_DEFINITIONS.map((definition) => [definition.id, definition.name]));

export function healthOf(config: AdapterConfig): ConnectionHealth {
    if (!config.lastHealthCheck) return "PENDING";
    const status = config.lastStatus ?? "ONLINE";
    return status === "DEGRADED" || status === "OFFLINE" ? status : "ONLINE";
}

export function statusDetail(config: AdapterConfig, health: ConnectionHealth): string | null {
    if (health === "DEGRADED") {
        const failed = config.consecutiveFailures ?? 1;
        return `${failed} failed`;
    }
    const latency = config.overview?.latencyMs;
    return health === "ONLINE" && latency != null ? `${latency} ms` : null;
}

/**
 * The columns of one connection list. Name and actions stay put, everything in between
 * can be moved and switched off in the Columns menu, and some start switched off.
 */
export function connectionColumns({ kind, canViewHealth, renderActions, onOpen }: ColumnOptions): ColumnDef<AdapterConfig>[] {
    const name: ColumnDef<AdapterConfig> = {
        accessorKey: "name",
        header: "Name",
        meta: { pin: "start" },
        cell: ({ row, table }) => (
            <NameCell
                adapterId={row.original.adapterId}
                name={row.original.name}
                kind={kindNames.get(row.original.adapterId) ?? row.original.adapterId}
                compact={table.options.meta?.density === "compact"}
                onOpen={onOpen ? () => onOpen(row.original) : undefined}
            />
        ),
    };
    // Only here for the Type filter. The type is already shown under the name.
    const type: ColumnDef<AdapterConfig> = {
        accessorKey: "adapterId",
        header: "Type",
        meta: { filterOnly: true },
        filterFn: (row, id, value: string[]) => value.includes(row.getValue(id)),
    };
    const status: ColumnDef<AdapterConfig> = {
        id: "status",
        header: "Status",
        cell: ({ row }) => {
            const health = healthOf(row.original);
            return (
                <StatusCell
                    status={health}
                    configId={row.original.id}
                    lastCheckedAt={row.original.lastHealthCheck}
                    detail={statusDetail(row.original, health)}
                    error={row.original.lastError}
                    interactive={canViewHealth}
                />
            );
        },
    };
    const address: ColumnDef<AdapterConfig> = {
        id: "address",
        header: kind === "database" ? "Host" : kind === "notification" ? "Sends to" : "Location",
        cell: ({ row }) => {
            const value = connectionAddress(row.original.adapterId, row.original.config);
            if (value === undefined) return <span className="text-sm text-destructive">Invalid config</span>;
            return value ? <span className="block max-w-72 truncate text-sm">{value}</span> : <Muted>-</Muted>;
        },
    };
    const version: ColumnDef<AdapterConfig> = {
        id: "version",
        header: "Version",
        cell: ({ row }) => {
            const value = connectionVersion(row.original.metadata);
            return value ? <span className="text-sm tabular-nums">{value}</span> : <Muted>-</Muted>;
        },
    };
    const usedBy: ColumnDef<AdapterConfig> = {
        id: "usedBy",
        header: "Used by",
        cell: ({ row }) => <UsedByCell usedBy={row.original.overview?.usedBy} />,
    };
    const lastBackup: ColumnDef<AdapterConfig> = {
        id: "lastBackup",
        header: "Last backup",
        cell: ({ row }) => <LastRunCell run={row.original.overview ? row.original.overview.lastBackup : undefined} never="Never" />,
    };
    const health = (defaultHidden: boolean): ColumnDef<AdapterConfig> => ({
        id: "health",
        header: "Health, 24h",
        meta: { defaultHidden },
        cell: ({ row }) => {
            const overview = row.original.overview;
            return overview ? <HealthBars buckets={overview.health} passed={overview.checksPassed} /> : <Muted>-</Muted>;
        },
    });
    const credential: ColumnDef<AdapterConfig> = {
        id: "credential",
        header: "Credential",
        meta: { defaultHidden: true },
        cell: ({ row }) => <CredentialCell name={row.original.overview?.credentialName} />,
    };
    const ssh: ColumnDef<AdapterConfig> = {
        id: "ssh",
        header: "SSH tunnel",
        meta: { defaultHidden: true },
        cell: ({ row }) => {
            const host = connectionSshHost(row.original.config);
            return host ? <span className="text-sm">{host}</span> : <Muted>-</Muted>;
        },
    };
    const stored: ColumnDef<AdapterConfig> = {
        id: "stored",
        header: "Stored",
        cell: ({ row }) => {
            const value = row.original.overview?.stored;
            if (!value) return <Muted>-</Muted>;
            return (
                <span className="text-sm tabular-nums">
                    {formatBytes(value.size, 1)}
                    <span className="ml-1.5 text-xs text-muted-foreground">
                        {value.count.toLocaleString()} backup{value.count === 1 ? "" : "s"}
                    </span>
                </span>
            );
        },
    };
    const retention: ColumnDef<AdapterConfig> = {
        id: "retention",
        header: "Default retention",
        meta: { defaultHidden: true },
        cell: ({ row }) => {
            const value = row.original.overview?.retentionName;
            return value ? <span className="text-sm">{value}</span> : <Muted>-</Muted>;
        },
    };
    const lastSent: ColumnDef<AdapterConfig> = {
        id: "lastSent",
        header: "Last sent",
        cell: ({ row }) => <LastRunCell run={row.original.overview ? row.original.overview.lastSent : undefined} never="Never" />,
    };
    const added: ColumnDef<AdapterConfig> = {
        accessorKey: "createdAt",
        header: "Added",
        meta: { defaultHidden: true },
        cell: ({ row }) => <span className="text-sm"><DateDisplay date={row.original.createdAt} format="P" /></span>,
    };
    const actions: ColumnDef<AdapterConfig> = {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        meta: { pin: "end", label: "Actions" },
        enableHiding: false,
        cell: ({ row }) => <div className="flex justify-end">{renderActions(row.original)}</div>,
    };

    switch (kind) {
        case "database":
            return [name, type, status, address, version, usedBy, lastBackup, health(false), credential, ssh, added, actions];
        case "source":
            return [name, type, status, address, usedBy, lastBackup, health(true), credential, added, actions];
        case "destination":
            return [name, type, status, address, stored, usedBy, lastBackup, health(true), retention, credential, added, actions];
        case "notification":
            return [name, type, address, usedBy, lastSent, added, actions];
    }
}
