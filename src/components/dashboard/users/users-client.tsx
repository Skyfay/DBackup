"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { saveViewLayout } from "@/app/actions/auth/table-preferences";
import { GroupsTab, type GroupsTabHandle } from "@/components/dashboard/groups/groups-tab";
import { GROUPS_PAGE_ID, GROUPS_TABLE_ID } from "@/components/dashboard/groups/groups-tables";
import { Button } from "@/components/ui/button";
import { PageHead } from "@/components/ui/page-head";
import { PageTabs } from "@/components/ui/page-tabs";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { ViewSwitch } from "@/components/ui/view-switch";
import { useIsMobileState } from "@/hooks/use-mobile";
import type { TablePreferences, ViewMode } from "@/lib/core/table-preferences";
import { UsersTab, type UsersTabHandle } from "./users-tab";
import { USERS_TABLE_ID, type UsersPageCounts, type UsersPageTab } from "./users-tables";

/** The tabs that still have their old look, rendered by the page on the server. */
export type LegacyTabs = Partial<Record<Exclude<UsersPageTab, "users" | "groups">, React.ReactNode>>;

const LEGACY_ORDER = ["apikeys", "audit", "sso"] as const;

/** The groups show as a table or as cards, the cards on a phone. */
const GROUP_VIEWS: ViewMode[] = ["table", "cards"];

const LABELS: Record<UsersPageTab, string> = {
    users: "Users",
    groups: "Groups",
    apikeys: "API keys",
    audit: "Audit log",
    sso: "Sign-in",
};

interface UsersClientProps {
    canReadUsers: boolean;
    canManageUsers: boolean;
    canReadGroups: boolean;
    canManageGroups: boolean;
    counts: UsersPageCounts;
    layouts: Record<string, TablePreferences>;
    /** The view of the groups this user picked last. */
    groupsView: ViewMode;
    legacy: LegacyTabs;
}

/**
 * The Users & Groups page: the users, the groups, the API keys, the audit log and the ways to
 * sign in. The tab lives in the address, the buttons beside the tabs belong to the open one, and a
 * phone gets cards.
 */
export function UsersClient({ canReadUsers, canManageUsers, canReadGroups, canManageGroups, counts, layouts, groupsView, legacy }: UsersClientProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const isMobile = useIsMobileState();
    const users = useRef<UsersTabHandle>(null);
    const groups = useRef<GroupsTabHandle>(null);
    const [groupView, setGroupView] = useState<"table" | "cards">(groupsView === "cards" ? "cards" : "table");

    const tabs: UsersPageTab[] = [
        ...(canReadUsers ? ["users" as const] : []),
        ...(canReadGroups ? ["groups" as const] : []),
        ...LEGACY_ORDER.filter((tab) => legacy[tab]),
    ];
    const requested = searchParams.get("tab") as UsersPageTab | null;
    const active = requested && tabs.includes(requested) ? requested : tabs[0];

    const setTab = useCallback((value: string) => {
        const next = new URLSearchParams(searchParams.toString());
        next.set("tab", value);
        // Replace rather than push, switching tabs should not fill the back button.
        router.replace(`?${next.toString()}`, { scroll: false });
    }, [router, searchParams]);

    const changeGroupView = useCallback((next: ViewMode) => {
        const view = next === "cards" ? "cards" : "table";
        setGroupView(view);
        saveViewLayout(GROUPS_PAGE_ID, view)
            .then((result) => result.success)
            .catch(() => false)
            .then((saved) => {
                if (!saved) toast.error("Your view could not be saved.");
            });
    }, []);

    return (
        <Tabs value={active} onValueChange={setTab} className="w-full gap-4 md:gap-0">
            <PageHead>
                <PageTabs
                    tabs={tabs.map((tab) => ({ value: tab, label: LABELS[tab], count: counts[tab] }))}
                    value={active}
                    onValueChange={setTab}
                    label="Users and groups list"
                />

                <div className="ml-auto flex shrink-0 items-center gap-2">
                    {active === "users" && canManageUsers && (
                        <Button tone="create" onClick={() => users.current?.openCreate()} aria-label="New user">
                            <Plus />
                            <span className="hidden sm:inline">New user</span>
                        </Button>
                    )}
                    {active === "groups" && (
                        <>
                            {/* A phone always gets the cards, so it gets no switch. Hidden by CSS, so it never pops in. */}
                            <div className="hidden md:block">
                                <ViewSwitch value={groupView} onChange={changeGroupView} views={GROUP_VIEWS} />
                            </div>
                            {canManageGroups && (
                                <Button tone="create" onClick={() => groups.current?.openCreate()} aria-label="New group">
                                    <Plus />
                                    <span className="hidden sm:inline">New group</span>
                                </Button>
                            )}
                        </>
                    )}
                </div>
            </PageHead>

            {canReadUsers && (
                <TabsContent value="users">
                    {/* Waits for the measured screen, so a phone never flashes the table before its cards. */}
                    {isMobile !== undefined && (
                        <UsersTab ref={users} cards={isMobile} canManage={canManageUsers} initialLayout={layouts[USERS_TABLE_ID] ?? null} />
                    )}
                </TabsContent>
            )}
            {canReadGroups && (
                <TabsContent value="groups">
                    {isMobile !== undefined && (
                        <GroupsTab
                            ref={groups}
                            view={isMobile ? "cards" : groupView}
                            canManage={canManageGroups}
                            canMove={canManageUsers}
                            initialLayout={layouts[GROUPS_TABLE_ID] ?? null}
                        />
                    )}
                </TabsContent>
            )}
            {LEGACY_ORDER.map((tab) => legacy[tab] && (
                <TabsContent key={tab} value={tab}>
                    {/* These tabs keep their old card until they get their own design, which goes on from the head from md up. */}
                    <div className="md:*:rounded-t-none md:*:border-t-0">{legacy[tab]}</div>
                </TabsContent>
            ))}
        </Tabs>
    );
}
