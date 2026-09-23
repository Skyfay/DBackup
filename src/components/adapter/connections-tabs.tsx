"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { saveViewLayout } from "@/app/actions/auth/table-preferences";
import { AdapterManager, type AdapterManagerHandle } from "@/components/adapter/adapter-manager";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ViewSwitch } from "@/components/ui/view-switch";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { STORAGE_ROLES } from "@/lib/core/storage-roles";
import type { TablePreferences, ViewMode } from "@/lib/core/table-preferences";
import { useIsMobileState } from "@/hooks/use-mobile";
import { CONNECTION_TABLE_IDS, CONNECTIONS_PAGE_ID, type ConnectionCounts } from "./connection-tables";

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

const TAB_NAMES: Record<ConnectionTab, string> = {
    [CONNECTION_TABS.DATABASES]: "Databases",
    [CONNECTION_TABS.DIRECTORY_SOURCES]: "Directory Sources",
    [CONNECTION_TABS.DESTINATIONS]: "Backup Destinations",
    [CONNECTION_TABS.NOTIFICATIONS]: "Notifications",
};

interface ConnectionsTabsProps {
    permissions: string[];
    counts: ConnectionCounts;
    /** Saved column layouts, keyed by table id. */
    layouts: Record<string, TablePreferences>;
    /** The view this user picked last, table when they never picked one. */
    initialView: ViewMode;
}

function Count({ value }: { value: number | undefined }) {
    if (value === undefined) return null;
    return <span className="text-xs font-normal text-muted-foreground tabular-nums">{value}</span>;
}

/** One list with its name and how many connections it holds. */
function tabLabel(tab: ConnectionTab, counts: ConnectionCounts) {
    const count = {
        [CONNECTION_TABS.DATABASES]: counts.databases,
        [CONNECTION_TABS.DIRECTORY_SOURCES]: counts.sources,
        [CONNECTION_TABS.DESTINATIONS]: counts.destinations,
        [CONNECTION_TABS.NOTIFICATIONS]: counts.notifications,
    }[tab];
    return (
        <span className="flex items-center gap-2">
            {TAB_NAMES[tab]}
            <Count value={count} />
        </span>
    );
}

export function ConnectionsTabs({ permissions, counts, layouts, initialView }: ConnectionsTabsProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [view, setView] = useState<ViewMode>(initialView);
    // A phone has no room for the table, so it always gets the cards and no switch. The lists
    // wait until the screen is measured, so a phone never flashes the table first.
    const isMobile = useIsMobileState();
    const shownView: ViewMode | undefined = isMobile === undefined ? undefined : isMobile ? "cards" : view;

    const changeView = useCallback((next: ViewMode) => {
        setView(next);
        saveViewLayout(CONNECTIONS_PAGE_ID, next)
            .then((result) => result.success)
            .catch(() => false)
            .then((saved) => {
                if (!saved) toast.error("Your view could not be saved.");
            });
    }, []);
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
        view: shownView,
        tableId: CONNECTION_TABLE_IDS[tab],
        initialLayout: layouts[CONNECTION_TABLE_IDS[tab]] ?? null,
    });

    return (
        <Tabs value={active} onValueChange={onTabChange} className="w-full gap-4">
            <div className="flex items-center gap-2 md:gap-3">
                {/* A phone picks the list from a menu, four tabs never fit next to the Add button.
                    Both are hidden by CSS rather than by the measured screen, so neither pops in. */}
                <div className="min-w-0 flex-1 md:hidden">
                    <Select value={active} onValueChange={onTabChange}>
                        <SelectTrigger className="w-full" aria-label="Connection list">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {visible.map((tab) => (
                                <SelectItem key={tab} value={tab}>
                                    {tabLabel(tab, counts)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                {/* From a tablet up they stay tabs, and scroll sideways when they outgrow the row. */}
                <ScrollArea horizontal className="hidden min-w-0 md:block">
                    <TabsList>
                        {visible.map((tab) => (
                            <TabsTrigger key={tab} value={tab}>
                                {tabLabel(tab, counts)}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </ScrollArea>
                <div className="ml-auto flex shrink-0 items-center gap-2 self-start md:self-auto">
                    {/* Hidden by CSS rather than by the measured screen, so it never pops in after loading. */}
                    <div className="hidden md:block">
                        <ViewSwitch value={view} onChange={changeView} />
                    </div>
                    {canManage[active] && (
                        <Button tone="create" onClick={() => managers.current[active]?.openCreate()} aria-label="Add New">
                            <Plus />
                            <span className="hidden sm:inline">Add New</span>
                        </Button>
                    )}
                </div>
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
