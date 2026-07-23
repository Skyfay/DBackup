"use client";

import { useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AdapterManager } from "@/components/adapter/adapter-manager";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { STORAGE_ROLES } from "@/lib/core/storage-roles";

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
}

export function ConnectionsTabs({ permissions }: ConnectionsTabsProps) {
    const router = useRouter();
    const searchParams = useSearchParams();

    // Directory sources and destinations are both storage adapters, so they share the
    // destinations permission - the same reasoning the Destinations page always used.
    const canViewDatabases = permissions.includes(PERMISSIONS.SOURCES.VIEW);
    const canViewStorage = permissions.includes(PERMISSIONS.DESTINATIONS.READ);
    const canViewNotifications = permissions.includes(PERMISSIONS.NOTIFICATIONS.READ);

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

    return (
        <Tabs value={active} onValueChange={onTabChange} className="w-full">
            <TabsList>
                {canViewDatabases && (
                    <TabsTrigger value={CONNECTION_TABS.DATABASES}>Databases</TabsTrigger>
                )}
                {canViewStorage && (
                    <>
                        <TabsTrigger value={CONNECTION_TABS.DIRECTORY_SOURCES}>Directory Sources</TabsTrigger>
                        <TabsTrigger value={CONNECTION_TABS.DESTINATIONS}>Backup Destinations</TabsTrigger>
                    </>
                )}
                {canViewNotifications && (
                    <TabsTrigger value={CONNECTION_TABS.NOTIFICATIONS}>Notifications</TabsTrigger>
                )}
            </TabsList>

            {canViewDatabases && (
                <TabsContent value={CONNECTION_TABS.DATABASES} className="mt-4">
                    <AdapterManager
                        type="database"
                        title="Databases"
                        description="The databases you want to back up."
                        canManage={permissions.includes(PERMISSIONS.SOURCES.WRITE)}
                        permissions={permissions}
                        hidePageHeading
                    />
                </TabsContent>
            )}

            {canViewStorage && (
                <>
                    <TabsContent value={CONNECTION_TABS.DIRECTORY_SOURCES} className="mt-4">
                        <AdapterManager
                            type="storage"
                            title="Directory Sources"
                            description="Storage adapters whose folders can be backed up as files."
                            canManage={permissions.includes(PERMISSIONS.DESTINATIONS.WRITE)}
                            permissions={permissions}
                            roleFilter={STORAGE_ROLES.SOURCE}
                            defaultRole={STORAGE_ROLES.SOURCE}
                            hidePageHeading
                        />
                    </TabsContent>

                    <TabsContent value={CONNECTION_TABS.DESTINATIONS} className="mt-4">
                        <AdapterManager
                            type="storage"
                            title="Backup Destinations"
                            description="Where your backups are stored."
                            canManage={permissions.includes(PERMISSIONS.DESTINATIONS.WRITE)}
                            permissions={permissions}
                            roleFilter={STORAGE_ROLES.DESTINATION}
                            defaultRole={STORAGE_ROLES.DESTINATION}
                            hidePageHeading
                        />
                    </TabsContent>
                </>
            )}

            {canViewNotifications && (
                <TabsContent value={CONNECTION_TABS.NOTIFICATIONS} className="mt-4">
                    <AdapterManager
                        type="notification"
                        title="Notifications"
                        description="Channels that receive alerts about your backups."
                        canManage={permissions.includes(PERMISSIONS.NOTIFICATIONS.WRITE)}
                        permissions={permissions}
                        hidePageHeading
                    />
                </TabsContent>
            )}
        </Tabs>
    );
}
