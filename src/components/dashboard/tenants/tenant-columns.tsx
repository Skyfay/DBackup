"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { ArrowRightLeft, Building2, House, Pencil, Trash2, Users } from "lucide-react";
import type { BackupActionGroup } from "@/components/dashboard/storage/explorer/backup-actions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DateDisplay } from "@/components/utils/date-display";
import { cn } from "@/lib/utils";
import type { TenantRow } from "@/services/tenant/tenant-service";
import { healthNote } from "@/components/layout/tenant-switch";
import { countOf, deleteRefusal, type TenantListRow } from "./tenant-words";

/** The tile of a tenant: its logo, else a house for the home tenant and a building for the others. */
export function TenantTile({ home = false, logo = null, className }: { home?: boolean; logo?: string | null; className?: string }) {
    const Icon = home ? House : Building2;
    if (logo) {
        return (
            <Avatar className={cn("size-8 shrink-0 rounded-lg border bg-card", className)} aria-hidden="true">
                <AvatarImage src={logo} alt="" className="object-contain" />
                <AvatarFallback className="rounded-lg bg-muted/50">
                    <Icon className="size-4 text-muted-foreground" />
                </AvatarFallback>
            </Avatar>
        );
    }
    return (
        <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/50", className)} aria-hidden="true">
            <Icon className="size-4 text-muted-foreground" />
        </span>
    );
}

/** A small mark after the name, like Home or the tenant the viewer works in. */
function Tag({ children }: { children: React.ReactNode }) {
    return <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{children}</span>;
}

/** The facts of a tenant in one line, for the head of its right click menu. */
export function tenantNote(row: TenantRow): string {
    return [row.isHome ? "Home" : null, countOf(row.members, "member"), countOf(row.jobs, "job")].filter(Boolean).join(" · ");
}

export interface TenantHandlers {
    onOpen: (row: TenantListRow) => void;
    /** Absent for a viewer who may only see the tenants, like the rest of the changes. */
    onRename?: (row: TenantListRow) => void;
    onMembers: (row: TenantListRow) => void;
    onDelete?: (row: TenantListRow) => void;
}

/**
 * What a tenant can have done to it, for the button at the end of its row and the right click.
 * Someone who may only see the tenants gets Open and the members to look at.
 */
export function tenantActions(row: TenantListRow, activeTenantId: string | null, handlers: TenantHandlers): BackupActionGroup[] {
    const { onRename, onDelete } = handlers;
    const groups: BackupActionGroup[] = [];
    if (row.id !== activeTenantId) {
        groups.push({ actions: [{ id: "open", label: "Open", icon: ArrowRightLeft, onSelect: () => handlers.onOpen(row), tone: "neutral" }] });
    }
    groups.push({
        actions: [
            { id: "members", label: "Members", icon: Users, onSelect: () => handlers.onMembers(row), tone: onRename ? "edit" : "neutral" },
            ...(onRename ? [{ id: "rename", label: "Rename", icon: Pencil, onSelect: () => onRename(row), tone: "edit" as const }] : []),
        ],
    });
    if (onDelete && !deleteRefusal(row, activeTenantId)) {
        groups.push({ actions: [{ id: "delete", label: "Delete", icon: Trash2, onSelect: () => onDelete(row), tone: "destructive" }] });
    }
    return groups;
}

function Count({ value }: { value: number }) {
    return <span className={cn("text-sm tabular-nums", value === 0 && "text-muted-foreground")}>{value}</span>;
}

/** A dot after the name while the newest backup of a job of the tenant failed or missed a copy. */
function HealthDot({ health }: { health: TenantListRow["health"] }) {
    const note = healthNote(health);
    if (!note) return null;
    return (
        <span title={note} className={cn("size-1.75 shrink-0 rounded-full", health === "failed" ? "bg-destructive" : "bg-warning")}>
            <span className="sr-only">{note}</span>
        </span>
    );
}

/** The columns of the Tenants page. */
export function tenantColumns(activeTenantId: string | null, onMembers: (row: TenantListRow) => void, renderActions: (row: TenantListRow) => React.ReactNode): ColumnDef<TenantListRow>[] {
    return [
        {
            accessorKey: "name",
            header: "Tenant",
            cell: ({ row }) => (
                <div className="flex min-w-0 items-center gap-3">
                    <TenantTile home={row.original.isHome} logo={row.original.logo} />
                    <div className="min-w-0 max-w-md">
                        <div className="flex min-w-0 items-center gap-2">
                            {/* The keyboard way into the members, like a click on the row. */}
                            <button type="button" onClick={() => onMembers(row.original)} className="truncate rounded-sm text-left text-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50">
                                {row.original.name}
                            </button>
                            <HealthDot health={row.original.health} />
                            {row.original.isHome && <Tag>Home</Tag>}
                            {row.original.id === activeTenantId && <Tag>You work here</Tag>}
                        </div>
                        {row.original.isHome && <p className="truncate text-xs text-muted-foreground">Holds what the platform owns</p>}
                    </div>
                </div>
            ),
        },
        { accessorKey: "members", header: "Members", cell: ({ row }) => <Count value={row.original.members} /> },
        { accessorKey: "connections", header: "Connections", cell: ({ row }) => <Count value={row.original.connections} /> },
        { accessorKey: "databases", header: "Databases", cell: ({ row }) => <Count value={row.original.databases} /> },
        { accessorKey: "jobs", header: "Jobs", cell: ({ row }) => <Count value={row.original.jobs} /> },
        {
            id: "createdAt",
            header: "Created",
            accessorFn: (row) => Date.parse(row.createdAt),
            cell: ({ row }) => <DateDisplay date={row.original.createdAt} format="P" className="text-sm whitespace-nowrap" />,
        },
        {
            id: "actions",
            header: () => <span className="sr-only">Actions</span>,
            enableSorting: false,
            enableHiding: false,
            cell: ({ row }) => <div className="flex justify-end gap-0.5">{renderActions(row.original)}</div>,
        },
    ];
}
