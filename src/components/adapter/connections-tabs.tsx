"use client";

import { useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { AdapterManager, type AdapterManagerHandle } from "@/components/adapter/adapter-manager";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { STORAGE_ROLES } from "@/lib/core/storage-roles";
import type { TablePreferences } from "@/lib/core/table-preferences";
import { CONNECTION_TABLE_IDS, type ConnectionCounts } from "./connection-tables";

/**
 * Tab keys, also the `?tab=` values.
 *
 * Part of the URL because things link here directly: the OAuth callbacks return to a
 * specific tab, and so do bookmarks and the redirects left behind by the old
 * Sources/Destinations/Notifications pages.
 */
export const CONNECTION_TABS = {
    DATABASES: "databases",
    DIRECTORY_SOURCES: "directory-sources",
    DESTINATIONS: "destinations",
    NOTIFICATIONS: "notifications",
} as const;

export type ConnectionTab = typeof CONNECTION_TABS[keyof typeof CONNECTION_TABS];

interface ConnectionsTabsProps {
    permissions: string[];
    counts: ConnectionCounts;
    /** Saved column layouts, keyed by table id. */
    layouts: Record<string, TablePreferences>;
}

function Count({ value }: { value: number | undefined }) {
    if (value === undefined) return null;
    return <span className="text-xs font-normal text-muted-foreground tabular-nums">{value}</span>;
}

export function ConnectionsTabs({ permissions, counts, layouts }: ConnectionsTabsProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    // The Add button sits beside the tabs, the dialog it opens belongs to the active list.
    const managers = useRef<Partial<Record<ConnectionTab, AdapterManagerHandle | null>>>({});

    // Directory sources and destinations are both storage adapters, so they share the
    // destinations permission - the same reasoning the Destinations page always used.
    const canViewDatabases = permissions.includes(PERMISSIONS.SOURCES.VIEW);
    const canViewStorage = permissions.includes(PERMISSIONS.DESTINATIONS.READ);
    const canViewNotifications = permissions.includes(PERMISSIONS.NOTIFICATIONS.READ);

    const canManage: Record<ConnectionTab, boolean> = {
        [CONNECTION_TABS.DATABASES]: permissions.includes(PERMISSIONS.SOURCES.WRITE),
        [CONNECTION_TABS.DIRECTORY_SOURCES]: permissions.includes(PERMISSIONS.DESTINATIONS.WRITE),
        [CONNECTION_TABS.DESTINATIONS]: permissions.includes(PERMISSIONS.DESTINATIONS.WRITE),
        [CONNECTION_TABS.NOTIFICATIONS]: permissions.includes(PERMISSIONS.NOTIFICATIONS.WRITE),
    };

    const visible: ConnectionTab[] = [
        ...(canViewDatabases ? [CONNECTION_TABS.DATABASES] : []),
        ...(canViewStorage ? [CONNECTION_TABS.DIRECTORY_SOURCES, CONNECTION_TABS.DESTINATIONS] : []),
        ...(canViewNotifications ? [CONNECTION_TABS.NOTIFICATIONS] : []),
    ];

    const requested = searchParams.get("tab") as ConnectionTab | null;
    // A tab the user cannot see (or a typo) falls back to their first one rather than
    // rendering an empty panel.
    const active = requested && visible.includes(requested) ? requested : visible[0];

    const onTabChange = useCallback((value: string) => {
        const next = new URLSearchParams(searchParams.toString());
        next.set("tab", value);
        // Replace rather than push: switching tabs should not fill the back button.
        router.replace(`?${next.toString()}`, { scroll: false });
    }, [router, searchParams]);

    if (visible.length === 0) return null;

    const managerProps = (tab: ConnectionTab) => ({
        ref: (handle: AdapterManagerHandle | null) => {
            managers.current[tab] = handle;
        },
        canManage: canManage[tab],
        permissions,
        tableId: CONNECTION_TABLE_IDS[tab],
        initialLayout: layouts[CONNECTION_TABLE_IDS[tab]] ?? null,
    });

    return (
        <Tabs value={active} onValueChange={onTabChange} className="w-full gap-4">
            <div className="flex flex-wrap items-center gap-3">
                <TabsList>
                    {canViewDatabases && (
                        <TabsTrigger value={CONNECTION_TABS.DATABASES}>Databases <Count value={counts.databases} /></TabsTrigger>
                    )}
                    {canViewStorage && (
                        <>
                            <TabsTrigger value={CONNECTION_TABS.DIRECTORY_SOURCES}>Directory Sources <Count value={counts.sources} /></TabsTrigger>
                            <TabsTrigger value={CONNECTION_TABS.DESTINATIONS}>Backup Destinations <Count value={counts.destinations} /></TabsTrigger>
                        </>
                    )}
                    {canViewNotifications && (
                        <TabsTrigger value={CONNECTION_TABS.NOTIFICATIONS}>Notifications <Count value={counts.notifications} /></TabsTrigger>
                    )}
                </TabsList>
                {canManage[active] && (
                    <Button className="ml-auto" onClick={() => managers.current[active]?.openCreate()}>
                        <Plus />
                        Add New
                    </Button>
                )}
            </div>

            {canViewDatabases && (
                <TabsContent value={CONNECTION_TABS.DATABASES}>
                    <AdapterManager type="database" {...managerProps(CONNECTION_TABS.DATABASES)} />
                </TabsContent>
            )}

            {canViewStorage && (
                <>
                    <TabsContent value={CONNECTION_TABS.DIRECTORY_SOURCES}>
                        <AdapterManager
                            type="storage"
                            roleFilter={STORAGE_ROLES.SOURCE}
                            defaultRole={STORAGE_ROLES.SOURCE}
                            {...managerProps(CONNECTION_TABS.DIRECTORY_SOURCES)}
                        />
                    </TabsContent>

                    <TabsContent value={CONNECTION_TABS.DESTINATIONS}>
                        <AdapterManager
                            type="storage"
                            roleFilter={STORAGE_ROLES.DESTINATION}
                            defaultRole={STORAGE_ROLES.DESTINATION}
                            {...managerProps(CONNECTION_TABS.DESTINATIONS)}
                        />
                    </TabsContent>
                </>
            )}

            {canViewNotifications && (
                <TabsContent value={CONNECTION_TABS.NOTIFICATIONS}>
                    <AdapterManager type="notification" {...managerProps(CONNECTION_TABS.NOTIFICATIONS)} />
                </TabsContent>
            )}
        </Tabs>
    );
}
