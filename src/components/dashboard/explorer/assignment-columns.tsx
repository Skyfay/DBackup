"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { ArrowRightLeft, Asterisk, Database, EyeOff, History, Lock, Tag, Undo2, Zap } from "lucide-react";
import type { BackupActionGroup } from "@/components/dashboard/storage/explorer/backup-actions";
import { BackupRowMenu } from "@/components/dashboard/storage/explorer/backup-menus";
import { TenantTileMark } from "@/components/tenant/tenant-pick";
import type { DataTableFilterableColumn } from "@/components/ui/data-table";
import { DateDisplay } from "@/components/utils/date-display";
import { formatBytes } from "@/lib/utils";
import type { DatabaseOwnerRow, SourceAssignments } from "@/services/tenant/database-assignments";
import { NOBODY, howOf, movedText, onDemandLine, ownerKey, type How } from "./assignment-model";
import { OnDemandNote } from "./assignment-on-demand-note";
import { OwnerPicker, type OwnerChange } from "./assignment-picker";
import { ownerLock } from "./assignment-reach";

/** What the menu of a database needs: who may change it and what each entry does. */
export interface AssignmentActionOptions {
    canAssign: boolean;
    /** The tenants the viewer reaches, a database of another one stays as it is. */
    data: Pick<SourceAssignments, "customers">;
    onChange: (changes: OwnerChange[]) => Promise<boolean>;
    onHistory: (name: string) => void;
    onMove: (row: DatabaseOwnerRow) => void;
    onOnDemand: (row: DatabaseOwnerRow) => void;
}

/**
 * What a database of the server can have done to it, for the button at the end of its row and the
 * right click: who held it, and for whoever may give databases away moving it, its backups on
 * demand and taking it back, while its tenant is one they reach.
 */
export function assignmentActions(row: DatabaseOwnerRow, { canAssign: mayAssign, data, onChange, onHistory, onMove, onOnDemand }: AssignmentActionOptions): BackupActionGroup[] {
    const byName = row.owner?.via === "assignment";
    const canAssign = mayAssign && !ownerLock(row, data);
    const manage = canAssign ? [
        ...(row.owner ? [{ id: "move", label: "Move to another server", icon: ArrowRightLeft, onSelect: () => onMove(row), tone: "edit" as const }] : []),
        ...(byName ? [{ id: "on-demand", label: "Backups on demand", icon: Zap, onSelect: () => onOnDemand(row), tone: "edit" as const }] : []),
    ] : [];
    return [
        { actions: [{ id: "history", label: "Who held it", icon: History, onSelect: () => onHistory(row.name), tone: "neutral" as const }] },
        ...(manage.length > 0 ? [{ actions: manage }] : []),
        ...(canAssign && byName ? [{ actions: [{ id: "take-back", label: "Take back", icon: Undo2, onSelect: () => void onChange([{ databaseName: row.name, tenantId: null }]), tone: "neutral" as const }] }] : []),
    ];
}

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

/** The tenant as text, for a viewer who may not change it, with why when the tenant lies beyond their reach. */
function OwnerText({ row, lock }: { row: DatabaseOwnerRow; lock?: string | null }) {
    if (!row.owner) {
        return (
            <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <EyeOff className="size-4 shrink-0" aria-hidden="true" />
                Nobody else
            </span>
        );
    }
    return (
        <span className="inline-flex min-w-0 items-center gap-2 text-sm font-medium" title={lock ?? undefined}>
            <TenantTileMark name={row.owner.tenantName} className="size-5 text-[9px]" />
            <span className="truncate">{row.owner.tenantName}</span>
            {lock && (
                <>
                    <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="sr-only">{lock}</span>
                </>
            )}
        </span>
    );
}

/** How the tenant holds the database, on two lines like the design of the card, and a third for backups on demand. */
function HowCell({ how, tenantName, ownerName, databaseName }: { how: How; tenantName: string; ownerName: string | null; databaseName: string }) {
    const [title, line]: [React.ReactNode, React.ReactNode] = how.kind === "assignment"
        ? ["By name", <>since <DateDisplay date={how.since} format="P" />{how.from ? <> · from {how.from.serverName}</> : how.byName && <> · by {how.byName}</>}</>]
        : how.kind === "rule"
            ? [<>Rule <span className="font-mono">{how.pattern}</span></>, <>since <DateDisplay date={how.since} format="P" /></>]
            : how.kind === "moved"
                ? [<>Moved <DateDisplay date={how.at} format="P" /></>, how.before ? `${movedText(how.to, databaseName)}, with ${how.before}` : movedText(how.to, databaseName)]
                : how.kind === "taken-back"
                    ? [<>Taken back <DateDisplay date={how.at} format="P" /></>, how.before ? `${how.before} before` : "no rule gives it"]
                    : [`Only ${tenantName}`, "never given"];
    const onDemand = how.kind === "assignment" || how.kind === "rule" ? onDemandLine(how.onDemandPerDay, how.tenantOnDemand, ownerName ?? "the tenant") : null;
    return (
        <div className="min-w-0 text-sm">
            <p className="max-w-56 truncate">{title}</p>
            <p className="max-w-56 truncate text-xs text-muted-foreground tabular-nums">{line}</p>
            {onDemand && <OnDemandNote line={onDemand} />}
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
            cell: ({ row }) => {
                // A database of a tenant beyond the reach stays as it is, and without a tenant to give to there is nothing to pick.
                const lock = canAssign ? ownerLock(row.original, data) : null;
                return (
                    <div className="w-44 sm:w-56">
                        {canAssign && !lock && data.customers.length > 0
                            ? <OwnerPicker row={row.original} data={data} tenantName={tenantName} onChange={onChange} />
                            : <OwnerText row={row.original} lock={lock} />}
                    </div>
                );
            },
        },
        {
            id: "how",
            accessorFn: (row) => howOf(row, data, now).kind,
            header: "How",
            enableSorting: false,
            filterFn: (row, id, value: string[]) => value.includes(row.getValue(id)),
            cell: ({ row }) => <HowCell how={howOf(row.original, data, now)} tenantName={tenantName} ownerName={row.original.owner?.tenantName ?? null} databaseName={row.original.name} />,
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
                    <BackupRowMenu name={row.original.name} groups={assignmentActions(row.original, { canAssign, data, onChange, onHistory, onMove, onOnDemand })} />
                </div>
            ),
        },
    ];
}

/** The filters by tenant, every one that can hold a database, and by how a database is given. The table counts the rows. */
export function assignmentFilters(data: SourceAssignments): DataTableFilterableColumn<DatabaseOwnerRow>[] {
    return [
        {
            id: "owner",
            title: "Tenant",
            note: "The numbers count the databases",
            unavailableLabel: "No databases with the other filters",
            options: [
                { value: NOBODY, label: "Nobody else", icon: EyeOff },
                ...data.tenants.map((tenant) => ({ value: tenant.id, label: tenant.name, lead: <TenantTileMark name={tenant.name} className="size-4 rounded-sm border-0 text-[8px]" /> })),
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
