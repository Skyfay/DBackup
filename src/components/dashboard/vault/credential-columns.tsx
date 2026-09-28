"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Lock, TriangleAlert } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { CREDENTIAL_TYPE_INFO, CREDENTIAL_TYPE_ORDER } from "@/components/settings/credential-types";
import type { DataTableFilterableColumn } from "@/components/ui/data-table";
import { DateDisplay } from "@/components/utils/date-display";
import { cn } from "@/lib/utils";
import type { VaultConnectionRole, VaultCredential } from "@/services/vault/vault-types";
import { ConnectionStack, TypeTile } from "./vault-cells";

const usersOf = (profile: VaultCredential) => [...new Set(profile.usedBy.map((use) => use.id))];

/** The headings of the Used by filter, in the order of the tabs of the Connections page. */
const GROUPS: Record<VaultConnectionRole, { label: string; order: number }> = {
    database: { label: "Databases", order: 0 },
    source: { label: "Directory sources", order: 1 },
    destination: { label: "Destinations", order: 2 },
    notification: { label: "Notification channels", order: 3 },
};

/** Tile, name and what the profile is for, the button in it opens the details for keyboards. */
function ProfileCell({ profile, compact, onOpen }: { profile: VaultCredential; compact: boolean; onOpen: (profile: VaultCredential) => void }) {
    return (
        <div className="flex min-w-0 items-center gap-3">
            <TypeTile type={profile.type} size={compact ? "sm" : "md"} />
            <div className={cn("min-w-0 max-w-72", compact && "flex items-baseline gap-2")}>
                <button
                    type="button"
                    onClick={() => onOpen(profile)}
                    title={profile.name}
                    className={cn("block max-w-full truncate rounded-sm text-left font-medium outline-none hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring/50", compact && "shrink-0")}
                >
                    {profile.name}
                </button>
                <div className="min-w-0 truncate text-xs text-muted-foreground">{profile.description || CREDENTIAL_TYPE_INFO[profile.type].title}</div>
            </div>
        </div>
    );
}

/** What a profile holds, with a lock, or amber with the reason when it needs a look. */
export function HoldsCell({ profile }: { profile: Pick<VaultCredential, "holds" | "attention"> }) {
    const Icon = profile.attention ? TriangleAlert : Lock;
    return (
        <span className={cn("flex min-w-0 items-center gap-1.5 text-sm", profile.attention ? "text-warning" : "text-muted-foreground")} title={profile.attention ?? undefined}>
            <Icon className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate">{profile.holds}</span>
        </span>
    );
}

interface ColumnOptions {
    onOpen: (profile: VaultCredential) => void;
    renderActions: (profile: VaultCredential) => React.ReactNode;
}

/** The columns of the credential profiles. Name and actions stay put, the rest can move and hide. */
export function credentialColumns({ onOpen, renderActions }: ColumnOptions): ColumnDef<VaultCredential>[] {
    return [
        {
            accessorKey: "name",
            header: "Profile",
            meta: { pin: "start" },
            cell: ({ row, table }) => <ProfileCell profile={row.original} compact={table.options.meta?.density === "compact"} onOpen={onOpen} />,
        },
        {
            accessorKey: "type",
            header: "Type",
            filterFn: (row, id, value: string[]) => value.includes(row.getValue(id)),
            cell: ({ row }) => <span className="text-sm whitespace-nowrap">{CREDENTIAL_TYPE_INFO[row.original.type].title}</span>,
        },
        {
            id: "usedBy",
            header: "Used by",
            // A profile counts once for each connection in the numbers of the filter, not as one list.
            accessorFn: usersOf,
            getUniqueValues: usersOf,
            filterFn: (row, id, value: string[]) => (row.getValue(id) as string[]).some((connectionId) => value.includes(connectionId)),
            cell: ({ row }) => <ConnectionStack connections={row.original.usedBy} className="max-w-72" />,
        },
        {
            id: "holds",
            header: "Stored",
            cell: ({ row }) => <div className="max-w-64"><HoldsCell profile={row.original} /></div>,
        },
        {
            id: "changed",
            header: "Changed",
            cell: ({ row }) => <RelativeTime date={row.original.updatedAt} className="text-sm whitespace-nowrap text-muted-foreground" />,
        },
        {
            id: "created",
            header: "Created",
            meta: { defaultHidden: true },
            cell: ({ row }) => <span className="text-sm whitespace-nowrap"><DateDisplay date={row.original.createdAt} format="P" /></span>,
        },
        {
            id: "revealed",
            header: "Revealed",
            meta: { defaultHidden: true },
            cell: ({ row }) => row.original.revealed
                ? <RelativeTime date={row.original.revealed.at} className="text-sm whitespace-nowrap" />
                : <span className="text-sm text-muted-foreground">Not lately</span>,
        },
        {
            id: "actions",
            header: () => <span className="sr-only">Actions</span>,
            meta: { pin: "end", label: "Actions" },
            enableHiding: false,
            cell: ({ row }) => <div className="flex justify-end">{renderActions(row.original)}</div>,
        },
    ];
}

/** The Type and Used by filters, with only the values some profile has. */
export function credentialFilters(profiles: VaultCredential[]): DataTableFilterableColumn<VaultCredential>[] {
    const shared = { note: "The numbers count the profiles", unavailableLabel: "No profiles with the other filters" };
    const types = CREDENTIAL_TYPE_ORDER.filter((type) => profiles.some((profile) => profile.type === type));
    const connections = new Map(profiles.flatMap((profile) => profile.usedBy.map((use) => [use.id, use] as const)));
    return [
        {
            id: "type",
            title: "Type",
            ...shared,
            options: types.map((type) => {
                const Icon = CREDENTIAL_TYPE_INFO[type].icon;
                return { value: type, label: CREDENTIAL_TYPE_INFO[type].title, lead: <Icon className="size-4 shrink-0 text-muted-foreground" /> };
            }),
        },
        {
            id: "usedBy",
            title: "Used by",
            ...shared,
            contentClassName: "w-72",
            options: [...connections.values()]
                .sort((a, b) => GROUPS[a.role].order - GROUPS[b.role].order || a.name.localeCompare(b.name))
                .map((connection) => ({
                    value: connection.id,
                    label: connection.name,
                    group: GROUPS[connection.role].label,
                    lead: <AdapterIcon adapterId={connection.adapterId} className="size-4 shrink-0" />,
                })),
        },
    ];
}
