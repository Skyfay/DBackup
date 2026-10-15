"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LogIn, Plus, User, Users, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { saveViewLayout } from "@/app/actions/auth/table-preferences";
import { SignInTab, type SignInTabHandle } from "@/components/dashboard/sign-in/sign-in-tab";
import { SIGN_IN_PAGE_ID, SIGN_IN_TABLE_ID } from "@/components/dashboard/sign-in/sign-in-tables";
import { UsersTab, type UsersTabHandle } from "@/components/dashboard/users/users-tab";
import { USERS_TABLE_ID } from "@/components/dashboard/users/users-tables";
import { Button } from "@/components/ui/button";
import { PageHead } from "@/components/ui/page-head";
import { PageTabs } from "@/components/ui/page-tabs";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { ViewSwitch } from "@/components/ui/view-switch";
import { useIsMobileState } from "@/hooks/use-mobile";
import type { TablePreferences, ViewMode } from "@/lib/core/table-preferences";
import type { PlatformGroupListHandle } from "./platform-group-list";
import { groupsKindOf, PlatformGroupsTab, type GroupsKind } from "./platform-groups-tab";

export type PlatformUsersTab = "users" | "groups" | "providers";

const TABS: PlatformUsersTab[] = ["users", "groups", "providers"];

const LABELS: Record<PlatformUsersTab, string> = { users: "Users", groups: "Groups", providers: "Sign-in providers" };
const ICONS: Record<PlatformUsersTab, LucideIcon> = { users: User, groups: Users, providers: LogIn };

/** The sign-in providers show as a table or as cards, the cards on a phone. */
const LIST_VIEWS: ViewMode[] = ["table", "cards"];

/** The tab an address opens, `?tab=sso` of the old Users & Groups as the providers. */
export function platformTabOf(value: string | null): PlatformUsersTab {
    if (value === "sso") return "providers";
    return TABS.includes(value as PlatformUsersTab) ? (value as PlatformUsersTab) : "users";
}

interface PlatformUsersClientProps {
    /** May see every account and the platform groups, the tabs Users and Groups. */
    canReadAccounts: boolean;
    /** May create, change and delete accounts and make and give platform groups. */
    canManageAccounts: boolean;
    /** May see the sign-in providers, the tab Sign-in providers. */
    canReadSignIn: boolean;
    /** May add and change the sign-in providers. */
    canManageSignIn: boolean;
    layouts: Record<string, TablePreferences>;
    /** The view of the sign-in providers this user picked last. */
    signInView: ViewMode;
}

/**
 * Users & Groups of the Platform: every account of the instance once with its tenants, its group
 * in each and its platform group, the platform groups and the groups of every tenant, read only,
 * and the sign-in providers, each tab for whoever may see it. The tab and the kind of groups live
 * in the address, the buttons beside the tabs belong to the open one, and a phone gets cards.
 */
export function PlatformUsersClient({ canReadAccounts, canManageAccounts, canReadSignIn, canManageSignIn, layouts, signInView: savedSignInView }: PlatformUsersClientProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const isMobile = useIsMobileState();
    const users = useRef<UsersTabHandle>(null);
    const platformGroups = useRef<PlatformGroupListHandle>(null);
    const signIn = useRef<SignInTabHandle>(null);
    const [signInView, setSignInView] = useState<"table" | "cards">(savedSignInView === "cards" ? "cards" : "table");
    const tabs = TABS.filter((tab) => (tab === "providers" ? canReadSignIn : canReadAccounts));
    const asked = platformTabOf(searchParams.get("tab"));
    const active = tabs.includes(asked) ? asked : tabs[0] ?? "users";
    const groupsKind = groupsKindOf(searchParams.get("groups"));

    const setParam = useCallback((key: string, value: string) => {
        const next = new URLSearchParams(searchParams.toString());
        next.set(key, value);
        // Replace rather than push, switching tabs should not fill the back button.
        router.replace(`?${next.toString()}`, { scroll: false });
    }, [router, searchParams]);
    const setTab = useCallback((value: string) => setParam("tab", value), [setParam]);
    const setGroupsKind = useCallback((kind: GroupsKind) => setParam("groups", kind), [setParam]);

    const changeSignInView = useCallback((next: ViewMode) => {
        const view = next === "cards" ? "cards" : "table";
        setSignInView(view);
        saveViewLayout(SIGN_IN_PAGE_ID, view)
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
                    tabs={tabs.map((tab) => ({ value: tab, label: LABELS[tab], icon: ICONS[tab] }))}
                    value={active}
                    onValueChange={setTab}
                    label="Accounts, groups and sign-in providers of the platform"
                />
                <div className="ml-auto flex shrink-0 items-center gap-2">
                    {active === "users" && canManageAccounts && (
                        <Button tone="create" onClick={() => users.current?.openCreate()} aria-label="New user">
                            <Plus />
                            <span className="hidden sm:inline">New user</span>
                        </Button>
                    )}
                    {active === "groups" && groupsKind === "platform" && canManageAccounts && (
                        <Button tone="create" onClick={() => platformGroups.current?.openCreate()} aria-label="New platform group">
                            <Plus />
                            <span className="hidden sm:inline">New platform group</span>
                        </Button>
                    )}
                    {active === "providers" && (
                        <>
                            {/* A phone always gets the cards, so it gets no switch. Hidden by CSS, so it never pops in. */}
                            <div className="hidden md:block">
                                <ViewSwitch value={signInView} onChange={changeSignInView} views={LIST_VIEWS} />
                            </div>
                            {canManageSignIn && (
                                <Button tone="create" onClick={() => signIn.current?.openCreate()} aria-label="New provider">
                                    <Plus />
                                    <span className="hidden sm:inline">New provider</span>
                                </Button>
                            )}
                        </>
                    )}
                </div>
            </PageHead>

            {canReadAccounts && (
                <TabsContent value="users">
                    {/* Waits for the measured screen, so a phone never flashes the table before its cards. */}
                    {isMobile !== undefined && (
                        <UsersTab ref={users} cards={isMobile} canManage={canManageAccounts} initialLayout={layouts[USERS_TABLE_ID] ?? null} source="/api/platform/users" withInvitations={false} platformRole />
                    )}
                </TabsContent>
            )}
            {canReadAccounts && (
                <TabsContent value="groups">
                    {isMobile !== undefined && (
                        <PlatformGroupsTab ref={platformGroups} cards={isMobile} kind={groupsKind} onKindChange={setGroupsKind} canManage={canManageAccounts} />
                    )}
                </TabsContent>
            )}
            {canReadSignIn && (
                <TabsContent value="providers">
                    {isMobile !== undefined && (
                        <SignInTab ref={signIn} view={isMobile ? "cards" : signInView} canManage={canManageSignIn} initialLayout={layouts[SIGN_IN_TABLE_ID] ?? null} />
                    )}
                </TabsContent>
            )}
        </Tabs>
    );
}
