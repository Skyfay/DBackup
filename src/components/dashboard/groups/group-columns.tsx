"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { DateDisplay } from "@/components/utils/date-display";
import { accessLine, summarizeAccess } from "@/lib/auth/access-summary";
import { cn } from "@/lib/utils";
import type { GroupRow } from "@/services/user/groups-types";
import { GroupTile, MemberFaces, permissionCount, ShareBar } from "./group-cells";

/** What members of a group may do in one line. */
export const groupLine = (group: Pick<GroupRow, "permissions" | "superAdmin">) => accessLine(summarizeAccess(group.permissions, group.superAdmin));

/** "built in", or when the group was made and by whom. */
export function MadeText({ group }: { group: GroupRow }) {
    if (group.superAdmin) return <>built in, the group of the first user</>;
    return (
        <>
            made <DateDisplay date={group.made?.at ?? group.createdAt} format="P" />
            {group.made?.by && ` by ${group.made.by}`}
        </>
    );
}

/** Tile, name and when it was made. The name is a button, the way in for keyboards. */
function GroupCell({ group, compact, onOpen }: { group: GroupRow; compact: boolean; onOpen: (group: GroupRow) => void }) {
    return (
        <div className="flex min-w-0 items-center gap-3">
            <GroupTile group={group} size={compact ? "sm" : "md"} />
            <div className={cn("min-w-0 max-w-64", compact && "flex items-baseline gap-2")}>
                <button
                    type="button"
                    onClick={() => onOpen(group)}
                    title={group.name}
                    className="block max-w-full truncate rounded-sm text-left font-medium outline-none hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                    {group.name}
                </button>
                <div className="min-w-0 truncate text-xs text-muted-foreground">
                    <MadeText group={group} />
                </div>
            </div>
        </div>
    );
}

/** When the group last changed and by whom. */
export function ChangedCell({ group }: { group: GroupRow }) {
    if (!group.changed) {
        return <span className="text-sm whitespace-nowrap text-muted-foreground">{group.superAdmin ? "always the same" : "never"}</span>;
    }
    return (
        <div className="min-w-0 text-sm">
            <RelativeTime date={group.changed.at} className="whitespace-nowrap" />
            {group.changed.by && <div className="truncate text-xs text-muted-foreground">by {group.changed.by}</div>}
        </div>
    );
}

interface ColumnOptions {
    onOpen: (group: GroupRow) => void;
    renderActions: (group: GroupRow) => React.ReactNode;
}

/** The columns of the groups. Group and actions stay put, the rest can move and hide. */
export function groupColumns({ onOpen, renderActions }: ColumnOptions): ColumnDef<GroupRow>[] {
    return [
        {
            accessorKey: "name",
            header: "Group",
            meta: { pin: "start" },
            cell: ({ row, table }) => <GroupCell group={row.original} compact={table.options.meta?.density === "compact"} onOpen={onOpen} />,
        },
        {
            id: "access",
            header: "What members may do",
            enableSorting: false,
            cell: ({ row }) => <div className="max-w-md min-w-0 text-sm">{groupLine(row.original)}</div>,
        },
        {
            id: "members",
            header: "Members",
            accessorFn: (group) => group.members.length,
            cell: ({ row }) => <MemberFaces members={row.original.members} />,
        },
        {
            id: "permissions",
            header: "Permissions",
            accessorFn: permissionCount,
            cell: ({ row }) => <ShareBar count={permissionCount(row.original)} />,
        },
        {
            id: "changed",
            header: "Changed",
            accessorFn: (group) => (group.changed ? Date.parse(group.changed.at) : 0),
            cell: ({ row }) => <div className="max-w-40"><ChangedCell group={row.original} /></div>,
        },
        {
            id: "created",
            header: "Made",
            accessorFn: (group) => Date.parse(group.createdAt),
            meta: { defaultHidden: true },
            cell: ({ row }) => <span className="text-sm whitespace-nowrap"><DateDisplay date={row.original.createdAt} format="P" /></span>,
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
