"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Copy, Eye, Pencil, Trash } from "lucide-react";
import type { BackupActionGroup } from "@/components/dashboard/storage/explorer/backup-actions";
import { MemberFaces } from "@/components/dashboard/groups/group-cells";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { PLATFORM_AREAS } from "@/lib/auth/permission-areas";
import { platformLevelsText, platformLine, tenantLevelsText, tenantLine } from "@/lib/auth/platform-group-summary";
import { cn } from "@/lib/utils";
import type { PlatformGroupRow, PlatformGroupTenant } from "@/services/user/platform-groups-types";
import { BuiltInTag, PlatformGroupMade, PlatformGroupTile, RightsCell, WhereCell } from "./platform-group-cells";

/** What members of a platform group may do on the platform, in a line and in levels. */
export function platformRights(group: PlatformGroupRow): { line: string; levels: string } {
    if (group.builtIn) return { line: "Everything on the platform", levels: "every area at its top level" };
    const held = new Set(group.platformPermissions);
    return { line: platformLine(held), levels: platformLevelsText(held) };
}

/** What members of a platform group may do in the tenants of its scope, in a line and in levels. */
export function tenantRights(group: PlatformGroupRow): { line: string; levels: string } {
    if (group.builtIn) return { line: "Everything", levels: "every area at its top level" };
    return { line: tenantLine(group.tenantPermissions), levels: tenantLevelsText(new Set(group.tenantPermissions)) };
}

/** The areas on the platform a group holds, for the filter Platform right. */
export function platformAreaIds(group: PlatformGroupRow): string[] {
    return PLATFORM_AREAS.filter((area) => group.builtIn || area.permissions.some((permission) => group.platformPermissions.includes(permission.id))).map((area) => area.id);
}

/** When the group last changed and by whom. */
function ChangedCell({ group }: { group: PlatformGroupRow }) {
    if (!group.changed) return <span className="text-sm whitespace-nowrap text-muted-foreground">{group.builtIn ? "always the same" : "never"}</span>;
    return (
        <div className="min-w-0 text-sm">
            <RelativeTime date={group.changed.at} className="whitespace-nowrap" />
            {group.changed.by && <div className="truncate text-xs text-muted-foreground">by {group.changed.by}</div>}
        </div>
    );
}

export interface PlatformGroupHandlers {
    /** Opens the editor, read only for Platform admin and for a group the viewer may not change. */
    onOpen: (group: PlatformGroupRow) => void;
    onEdit?: (group: PlatformGroupRow) => void;
    onDuplicate?: (group: PlatformGroupRow) => void;
    onDelete?: (group: PlatformGroupRow) => void;
}

/**
 * What a platform group can have done to it, for the button at the end of its row and the right
 * click: Edit or View, Duplicate and Delete. Platform admin is only viewed and duplicated, and a
 * handler the viewer may not use is absent.
 */
export function platformGroupActions(group: PlatformGroupRow, handlers: PlatformGroupHandlers, editable: boolean): BackupActionGroup[] {
    const { onEdit, onDuplicate, onDelete } = handlers;
    const open = onEdit && editable
        ? { id: "edit", label: "Edit", icon: Pencil, onSelect: () => onEdit(group), tone: "edit" as const }
        : { id: "view", label: "View", icon: Eye, onSelect: () => handlers.onOpen(group), tone: "neutral" as const };
    const manage = [open, ...(onDuplicate ? [{ id: "duplicate", label: "Duplicate", icon: Copy, onSelect: () => onDuplicate(group), tone: "create" as const }] : [])];
    const remove = onDelete && editable ? [{ id: "delete", label: "Delete", icon: Trash, onSelect: () => onDelete(group), tone: "destructive" as const }] : [];
    return [{ label: "Manage", actions: manage }, ...(remove.length > 0 ? [{ actions: remove }] : [])];
}

interface ColumnOptions {
    tenants: readonly PlatformGroupTenant[];
    onOpen: (group: PlatformGroupRow) => void;
    renderActions: (group: PlatformGroupRow) => React.ReactNode;
}

/** The columns of the platform groups: the group, its rights on the platform and in the tenants, where, its members and when it changed. */
export function platformGroupColumns({ tenants, onOpen, renderActions }: ColumnOptions): ColumnDef<PlatformGroupRow>[] {
    return [
        {
            accessorKey: "name",
            header: "Group",
            meta: { pin: "start" },
            cell: ({ row, table }) => {
                const group = row.original;
                const compact = table.options.meta?.density === "compact";
                return (
                    <div className="flex min-w-0 items-center gap-3">
                        <PlatformGroupTile group={group} size={compact ? "sm" : "md"} />
                        <div className="min-w-0 max-w-64">
                            <div className="flex min-w-0 items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => onOpen(group)}
                                    title={group.name}
                                    className="block min-w-0 truncate rounded-sm text-left font-medium outline-none hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring/50"
                                >
                                    {group.name}
                                </button>
                                {group.builtIn && <BuiltInTag />}
                            </div>
                            {!compact && (
                                <div className="truncate text-xs text-muted-foreground">
                                    <PlatformGroupMade group={group} />
                                </div>
                            )}
                        </div>
                    </div>
                );
            },
        },
        {
            id: "platform",
            header: "On the platform",
            enableSorting: false,
            accessorFn: platformAreaIds,
            filterFn: (row, id, value: string[]) => value.length === 0 || (row.getValue<string[]>(id)).some((area) => value.includes(area)),
            getUniqueValues: platformAreaIds,
            cell: ({ row }) => <RightsCell {...platformRights(row.original)} />,
        },
        {
            id: "tenants",
            header: "In the tenants",
            enableSorting: false,
            cell: ({ row }) => <RightsCell {...tenantRights(row.original)} />,
        },
        {
            id: "where",
            header: "Where",
            accessorFn: (group) => (group.allTenants ? "all" : "selected"),
            filterFn: (row, id, value: string[]) => value.length === 0 || value.includes(row.getValue<string>(id)),
            cell: ({ row }) => <WhereCell group={row.original} tenants={tenants} />,
        },
        {
            id: "members",
            header: "Members",
            accessorFn: (group) => group.members.length,
            cell: ({ row }) => <MemberFaces members={row.original.members} />,
        },
        {
            id: "changed",
            header: "Changed",
            accessorFn: (group) => (group.changed ? Date.parse(group.changed.at) : 0),
            cell: ({ row }) => <div className={cn("max-w-40")}><ChangedCell group={row.original} /></div>,
        },
        {
            id: "actions",
            header: () => <span className="sr-only">Actions</span>,
            meta: { pin: "end", label: "Actions" },
            enableHiding: false,
            enableSorting: false,
            cell: ({ row }) => <div className="flex justify-end">{renderActions(row.original)}</div>,
        },
    ];
}
