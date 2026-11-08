"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Bell, Database, FolderTree, HardDrive, Lock, Plus, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { saveViewLayout } from "@/app/actions/auth/table-preferences";
import { AdapterManager, type AdapterManagerHandle } from "@/components/adapter/adapter-manager";
import { Button } from "@/components/ui/button";
import { PageHead } from "@/components/ui/page-head";
import { PageTabs } from "@/components/ui/page-tabs";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { ViewSwitch } from "@/components/ui/view-switch";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { STORAGE_ROLES } from "@/lib/core/storage-roles";
import { listView, type ListViewMode, type TablePreferences, type ViewMode } from "@/lib/core/table-preferences";
import { useIsMobileState } from "@/hooks/use-mobile";
import { useNewFromLink } from "@/hooks/use-new-from-link";
import { useNewInTenant } from "@/components/tenant/tenant-actions";
import { useMayAdd, useTenantView } from "@/components/tenant/tenant-view";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CONNECTION_TABLE_IDS, CONNECTIONS_PAGE_ID, type ConnectionAttention } from "./connection-tables";

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

// One name per list, the one its strip, the pickers and the search use too.
const TAB_NAMES: Record<ConnectionTab, string> = {
    [CONNECTION_TABS.DATABASES]: "Databases",
    [CONNECTION_TABS.DIRECTORY_SOURCES]: "Directory sources",
    [CONNECTION_TABS.DESTINATIONS]: "Destinations",
    [CONNECTION_TABS.NOTIFICATIONS]: "Channels",
};

/** What the pick of a tenant says before a new connection in All tenants. */
const NEW_PICK_NOTES: Record<ConnectionTab, string> = {
    [CONNECTION_TABS.DATABASES]: "A database belongs to one tenant, pick the one it is added to.",
    [CONNECTION_TABS.DIRECTORY_SOURCES]: "A directory source belongs to one tenant, pick the one it is added to.",
    [CONNECTION_TABS.DESTINATIONS]: "A destination belongs to one tenant, pick the one it is added to.",
    [CONNECTION_TABS.NOTIFICATIONS]: "A channel belongs to one tenant, pick the one it is added to.",
};

/** The New button of each list, which names what it adds like on every other page. */
const NEW_LABELS: Record<ConnectionTab, string> = {
    [CONNECTION_TABS.DATABASES]: "New database",
    [CONNECTION_TABS.DIRECTORY_SOURCES]: "New directory source",
    [CONNECTION_TABS.DESTINATIONS]: "New destination",
    [CONNECTION_TABS.NOTIFICATIONS]: "New channel",
};

interface ConnectionsTabsProps {
    permissions: string[];
    attention: ConnectionAttention;
    /** Saved column layouts, keyed by table id. */
    layouts: Record<string, TablePreferences>;
    /** The view this user picked last, table when they never picked one. */
    initialView: ViewMode;
}

/** What needs a look in a list, left out for the lists the user cannot open. */
function attentionOf(tab: ConnectionTab, attention: ConnectionAttention) {
    return {
        [CONNECTION_TABS.DATABASES]: attention.databases,
        [CONNECTION_TABS.DIRECTORY_SOURCES]: attention.sources,
        [CONNECTION_TABS.DESTINATIONS]: attention.destinations,
        [CONNECTION_TABS.NOTIFICATIONS]: attention.notifications,
    }[tab];
}

const TAB_ICONS: Record<ConnectionTab, LucideIcon> = {
    [CONNECTION_TABS.DATABASES]: Database,
    [CONNECTION_TABS.DIRECTORY_SOURCES]: FolderTree,
    [CONNECTION_TABS.DESTINATIONS]: HardDrive,
    [CONNECTION_TABS.NOTIFICATIONS]: Bell,
};

export function ConnectionsTabs({ permissions, attention, layouts, initialView }: ConnectionsTabsProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [view, setView] = useState<ListViewMode>(listView(initialView));
    // A phone has no room for the table, so it always gets the cards and no switch. The lists
    // wait until the screen is measured, so a phone never flashes the table first.
    const isMobile = useIsMobileState();
    const shownView: ListViewMode | undefined = isMobile === undefined ? undefined : isMobile ? "cards" : view;

    const changeView = useCallback((next: ViewMode) => {
        setView(listView(next));
        saveViewLayout(CONNECTIONS_PAGE_ID, listView(next))
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

    // The platform may not let the tenant add a kind of connection itself. What it has, it still manages.
    const mayAdd: Record<ConnectionTab, boolean> = {
        [CONNECTION_TABS.DATABASES]: useMayAdd("databases"),
        [CONNECTION_TABS.DIRECTORY_SOURCES]: useMayAdd("directorySources"),
        [CONNECTION_TABS.DESTINATIONS]: useMayAdd("destinations"),
        [CONNECTION_TABS.NOTIFICATIONS]: useMayAdd("channels"),
    };
    const canAdd = (tab: ConnectionTab) => canManage[tab] && mayAdd[tab];
    const { allTenants, platformName } = useTenantView();

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

    // A connection belongs to one tenant, so in All tenants New asks for it and opens the form there.
    const openCreate = useCallback(() => {
        if (active) managers.current[active]?.openCreate();
    }, [active]);
    const newConnection = useNewInTenant({
        canCreate: active ? canAdd(active) : false,
        title: active ? NEW_LABELS[active] : "New connection",
        description: active ? NEW_PICK_NOTES[active] : "",
        href: `/dashboard/connections?tab=${active}&new=1`,
        onCreate: openCreate,
    });
    // The pick of a tenant comes back here with `?new=1` and opens the form of the list.
    useNewFromLink(active !== undefined && canAdd(active), openCreate);

    if (visible.length === 0) return null;

    const managerProps = (tab: ConnectionTab) => ({
        ref: (handle: AdapterManagerHandle | null) => {
            managers.current[tab] = handle;
        },
        canManage: canManage[tab],
        canAdd: canAdd(tab),
        permissions,
        view: shownView,
        tableId: CONNECTION_TABLE_IDS[tab],
        initialLayout: layouts[CONNECTION_TABLE_IDS[tab]] ?? null,
        onCreate: newConnection.available ? newConnection.start : undefined,
    });

    return (
        <Tabs value={active} onValueChange={onTabChange} className="w-full gap-4 md:gap-0">
            <PageHead>
                <PageTabs
                    tabs={visible.map((tab) => ({ value: tab, label: TAB_NAMES[tab], icon: TAB_ICONS[tab], attention: attentionOf(tab, attention) }))}
                    value={active}
                    onValueChange={onTabChange}
                    label="Connection list"
                />
                <div className="ml-auto flex shrink-0 items-center gap-2 self-start md:self-auto">
                    {/* Hidden by CSS rather than by the measured screen, so it never pops in after loading. */}
                    <div className="hidden md:block">
                        <ViewSwitch value={view} onChange={changeView} />
                    </div>
                    {newConnection.available && (
                        <Button tone="create" onClick={newConnection.start} aria-label={NEW_LABELS[active]}>
                            <Plus />
                            <span className="hidden sm:inline">{NEW_LABELS[active]}</span>
                        </Button>
                    )}
                    {!allTenants && active && canManage[active] && !mayAdd[active] && (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <span tabIndex={0} className="inline-flex h-9 items-center gap-2 rounded-md border border-dashed px-3 text-sm text-muted-foreground">
                                    <Lock className="size-4" aria-hidden="true" />
                                    <span className="hidden sm:inline">{TAB_NAMES[active]} come from {platformName ?? "the platform"}</span>
                                </span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-72">
                                <p className="font-medium">Set by {platformName ?? "the platform"}</p>
                                <p className="text-muted-foreground">
                                    This tenant adds no {TAB_NAMES[active].toLowerCase()} of its own. Its jobs pick from the ones other tenants share with it.
                                </p>
                            </TooltipContent>
                        </Tooltip>
                    )}
                </div>
            </PageHead>

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
            {newConnection.dialog}
        </Tabs>
    );
}
