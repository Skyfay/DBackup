"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { ArrowRightLeft, Asterisk, Database, EyeOff, History, MoreHorizontal, Tag, Undo2, Zap } from "lucide-react";
import { TenantTileMark } from "@/components/tenant/tenant-pick";
import { Button } from "@/components/ui/button";
import type { DataTableFilterableColumn } from "@/components/ui/data-table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DateDisplay } from "@/components/utils/date-display";
import { formatBytes } from "@/lib/utils";
import type { DatabaseOwnerRow, SourceAssignments } from "@/services/tenant/database-assignments";
import { NOBODY, howOf, movedText, onDemandText, ownerKey, type How } from "./assignment-model";
import { OwnerPicker, type OwnerChange } from "./assignment-picker";

interface ColumnOptions {
    data: SourceAssignments;
    /** The tenant of the server. */
    tenantName: string;
    /** Whether the viewer may give databases away, which turns the tenant into a picker. */
    canAssign: boolean;
    onChange: (changes: OwnerChange[]) => Promise<boolean>;
    /** Shows who held the database in the timeline under the table. */
    onHistory: (name: string) => void;
    /** Marks a database a tenant holds as moved to another server. */
    onMove: (row: DatabaseOwnerRow) => void;
    /** Switches backups on demand of a database given by name. */
    onOnDemand: (row: DatabaseOwnerRow) => void;
    now: Date;
}

/** The tenant as text, for a viewer who may not change it. */
function OwnerText({ row }: { row: DatabaseOwnerRow }) {
    if (!row.owner) {
        return (
            <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <EyeOff className="size-4 shrink-0" aria-hidden="true" />
                Nobody else
            </span>
        );
    }
    return (
        <span className="inline-flex min-w-0 items-center gap-2 text-sm font-medium">
            <TenantTileMark name={row.owner.tenantName} className="size-5 text-[9px]" />
            <span className="truncate">{row.owner.tenantName}</span>
        </span>
    );
}

/** How the tenant holds the database, on two lines like the design of the card, and a third for backups on demand. */
function HowCell({ how, tenantName, databaseName }: { how: How; tenantName: string; databaseName: string }) {
    const [title, line]: [React.ReactNode, React.ReactNode] = how.kind === "assignment"
        ? ["By name", <>since <DateDisplay date={how.since} format="P" />{how.from ? <> · from {how.from.serverName}</> : how.byName && <> · by {how.byName}</>}</>]
        : how.kind === "rule"
            ? [<>Rule <span className="font-mono">{how.pattern}</span></>, <>since <DateDisplay date={how.since} format="P" /></>]
            : how.kind === "moved"
                ? [<>Moved <DateDisplay date={how.at} format="P" /></>, how.before ? `${movedText(how.to, databaseName)}, with ${how.before}` : movedText(how.to, databaseName)]
                : how.kind === "taken-back"
                    ? [<>Taken back <DateDisplay date={how.at} format="P" /></>, how.before ? `${how.before} before` : "no rule gives it"]
                    : [`Only ${tenantName}`, "never given"];
    const onDemand = how.kind === "assignment" || how.kind === "rule" ? onDemandText(how.onDemandPerDay) : null;
    return (
        <div className="min-w-0 text-sm">
            <p className="max-w-56 truncate">{title}</p>
            <p className="max-w-56 truncate text-xs text-muted-foreground tabular-nums">{line}</p>
            {onDemand && (
                <p className="flex max-w-56 items-center gap-1 truncate text-xs text-muted-foreground">
                    <Zap className="size-3 shrink-0" aria-hidden="true" />
                    {onDemand}
                </p>
            )}
        </div>
    );
}

/** The databases of the server with who sees each, how and how many backups each has kept. */
export function assignmentColumns({ data, tenantName, canAssign, onChange, onHistory, onMove, onOnDemand, now }: ColumnOptions): ColumnDef<DatabaseOwnerRow>[] {
    return [
        {
            accessorKey: "name",
            header: "Database",
            cell: ({ row }) => (
                <div className="flex min-w-0 items-center gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/50" aria-hidden="true">
                        <Database className="size-4 text-muted-foreground" />
                    </span>
                    <div className="min-w-0">
                        <p className="max-w-56 truncate text-sm font-medium">{row.original.name}</p>
                        <p className="text-xs text-muted-foreground tabular-nums">{row.original.sizeInBytes === null ? "no size" : formatBytes(row.original.sizeInBytes)}</p>
                    </div>
                </div>
            ),
        },
        {
            id: "owner",
            accessorFn: ownerKey,
            header: "Tenant",
            enableSorting: false,
            filterFn: (row, id, value: string[]) => value.includes(row.getValue(id)),
            cell: ({ row }) => (
                <div className="w-44 sm:w-56">
                    {canAssign ? <OwnerPicker row={row.original} data={data} tenantName={tenantName} onChange={onChange} /> : <OwnerText row={row.original} />}
                </div>
            ),
        },
        {
            id: "how",
            accessorFn: (row) => howOf(row, data, now).kind,
            header: "How",
            enableSorting: false,
            filterFn: (row, id, value: string[]) => value.includes(row.getValue(id)),
            cell: ({ row }) => <HowCell how={howOf(row.original, data, now)} tenantName={tenantName} databaseName={row.original.name} />,
        },
        {
            accessorKey: "backups",
            header: () => <div className="text-right">Backups</div>,
            cell: ({ row }) => <div className="text-right text-sm tabular-nums">{row.original.backups.toLocaleString()}</div>,
        },
        {
            id: "actions",
            header: "",
            enableSorting: false,
            cell: ({ row }) => (
                <div className="flex justify-end">
                    <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" className="size-8 p-0">
                                <MoreHorizontal />
                                <span className="sr-only">Open menu for {row.original.name}</span>
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                            <DropdownMenuItem onSelect={() => onHistory(row.original.name)}><History /> Who held it</DropdownMenuItem>
                            {canAssign && row.original.owner && (
                                <DropdownMenuItem tone="edit" onSelect={() => onMove(row.original)}>
                                    <ArrowRightLeft /> Move to another server
                                </DropdownMenuItem>
                            )}
                            {canAssign && row.original.owner?.via === "assignment" && (
                                <DropdownMenuItem tone="edit" onSelect={() => onOnDemand(row.original)}>
                                    <Zap /> Backups on demand
                                </DropdownMenuItem>
                            )}
                            {canAssign && row.original.owner?.via === "assignment" && (
                                <DropdownMenuItem onSelect={() => void onChange([{ databaseName: row.original.name, tenantId: null }])}>
                                    <Undo2 /> Take back
                                </DropdownMenuItem>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            ),
        },
    ];
}

/** The filters by tenant and by how a database is given. The table counts the rows. */
export function assignmentFilters(data: SourceAssignments): DataTableFilterableColumn<DatabaseOwnerRow>[] {
    return [
        {
            id: "owner",
            title: "Tenant",
            note: "The numbers count the databases",
            unavailableLabel: "No databases with the other filters",
            options: [
                { value: NOBODY, label: "Nobody else", icon: EyeOff },
                ...data.customers.map((tenant) => ({ value: tenant.id, label: tenant.name, lead: <TenantTileMark name={tenant.name} className="size-4 rounded-sm border-0 text-[8px]" /> })),
            ],
        },
        {
            id: "how",
            title: "How",
            note: "The numbers count the databases",
            unavailableLabel: "No databases with the other filters",
            options: [
                { value: "assignment", label: "By name", icon: Tag },
                { value: "rule", label: "By a rule", icon: Asterisk },
                { value: "moved", label: "Moved away", icon: ArrowRightLeft },
                { value: "taken-back", label: "Taken back", icon: Undo2 },
                { value: "nobody", label: "Never given", icon: EyeOff },
            ],
        },
    ];
}
