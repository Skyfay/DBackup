"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Download, Plus } from "lucide-react";
import { toast } from "sonner";
import { saveViewLayout } from "@/app/actions/auth/table-preferences";
import { ApiKeysTab, type ApiKeysTabHandle } from "@/components/dashboard/api-keys/api-keys-tab";
import { API_KEYS_PAGE_ID, API_KEYS_TABLE_ID } from "@/components/dashboard/api-keys/api-keys-tables";
import { AuditTab, type AuditTabHandle } from "@/components/dashboard/audit/audit-tab";
import { AUDIT_PAGE_ID } from "@/components/dashboard/audit/audit-tables";
import { GroupsTab, type GroupsTabHandle } from "@/components/dashboard/groups/groups-tab";
import { GROUPS_PAGE_ID, GROUPS_TABLE_ID } from "@/components/dashboard/groups/groups-tables";
import { SignInTab, type SignInTabHandle } from "@/components/dashboard/sign-in/sign-in-tab";
import { SIGN_IN_PAGE_ID, SIGN_IN_TABLE_ID } from "@/components/dashboard/sign-in/sign-in-tables";
import { Button } from "@/components/ui/button";
import { PageHead } from "@/components/ui/page-head";
import { PageTabs } from "@/components/ui/page-tabs";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { ViewSwitch } from "@/components/ui/view-switch";
import { useIsMobileState } from "@/hooks/use-mobile";
import type { TablePreferences, ViewMode } from "@/lib/core/table-preferences";
import { UsersTab, type UsersTabHandle } from "./users-tab";
import { USERS_TABLE_ID, type UsersPageCounts, type UsersPageTab } from "./users-tables";

/** The audit log shows as a list or with the timeline above it, a phone gets cards. */
const AUDIT_VIEWS: ViewMode[] = ["table", "timeline"];

/** The groups, the API keys and the sign-in providers show as a table or as cards, the cards on a phone. */
const LIST_VIEWS: ViewMode[] = ["table", "cards"];

const listView = (view: ViewMode | null) => (view === "cards" ? "cards" : "table");

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
    canReadApiKeys: boolean;
    canManageApiKeys: boolean;
    /** May open the runs an API key started. */
    canOpenRuns: boolean;
    canReadAudit: boolean;
    /** May see the sign-in providers, which reading the settings allows. */
    canReadSignIn: boolean;
    /** Only a SuperAdmin changes the sign-in providers and signs out a SuperAdmin. */
    viewerSuperAdmin: boolean;
    counts: UsersPageCounts;
    layouts: Record<string, TablePreferences>;
    /** The view of the groups this user picked last. */
    groupsView: ViewMode;
    /** The view of the API keys this user picked last. */
    apiKeysView: ViewMode;
    /** The view of the audit log this user picked last. */
    auditView: ViewMode;
    /** The view of the sign-in providers this user picked last. */
    signInView: ViewMode;
}

/**
 * The Users & Groups page: the users, the groups, the API keys, the audit log and the ways to
 * sign in. The tab lives in the address, the buttons beside the tabs belong to the open one, and a
 * phone gets cards.
 */
export function UsersClient(props: UsersClientProps) {
    const { canReadUsers, canManageUsers, canReadGroups, canManageGroups, canReadApiKeys, canManageApiKeys, canOpenRuns, canReadAudit, canReadSignIn, viewerSuperAdmin, counts, layouts } = props;
    const router = useRouter();
    const searchParams = useSearchParams();
    const isMobile = useIsMobileState();
    const users = useRef<UsersTabHandle>(null);
    const groups = useRef<GroupsTabHandle>(null);
    const apiKeys = useRef<ApiKeysTabHandle>(null);
    const audit = useRef<AuditTabHandle>(null);
    const signIn = useRef<SignInTabHandle>(null);
    const [auditView, setAuditView] = useState<"table" | "timeline">(props.auditView === "timeline" ? "timeline" : "table");
    const [groupView, setGroupView] = useState<"table" | "cards">(listView(props.groupsView));
    const [keyView, setKeyView] = useState<"table" | "cards">(listView(props.apiKeysView));
    const [signInView, setSignInView] = useState<"table" | "cards">(listView(props.signInView));

    const tabs: UsersPageTab[] = [
        ...(canReadUsers ? ["users" as const] : []),
        ...(canReadGroups ? ["groups" as const] : []),
        ...(canReadApiKeys ? ["apikeys" as const] : []),
        ...(canReadAudit ? ["audit" as const] : []),
        ...(canReadSignIn ? ["sso" as const] : []),
    ];
    const requested = searchParams.get("tab") as UsersPageTab | null;
    const active = requested && tabs.includes(requested) ? requested : tabs[0];

    const setTab = useCallback((value: string) => {
        const next = new URLSearchParams(searchParams.toString());
        next.set("tab", value);
        // Replace rather than push, switching tabs should not fill the back button.
        router.replace(`?${next.toString()}`, { scroll: false });
    }, [router, searchParams]);

    const saveView = useCallback((pageId: string, view: ViewMode) => {
        saveViewLayout(pageId, view)
            .then((result) => result.success)
            .catch(() => false)
            .then((saved) => {
                if (!saved) toast.error("Your view could not be saved.");
            });
    }, []);

    const changeGroupView = useCallback((next: ViewMode) => {
        setGroupView(listView(next));
        saveView(GROUPS_PAGE_ID, listView(next));
    }, [saveView]);

    const changeKeyView = useCallback((next: ViewMode) => {
        setKeyView(listView(next));
        saveView(API_KEYS_PAGE_ID, listView(next));
    }, [saveView]);

    const changeSignInView = useCallback((next: ViewMode) => {
        setSignInView(listView(next));
        saveView(SIGN_IN_PAGE_ID, listView(next));
    }, [saveView]);

    const changeAuditView = useCallback((next: ViewMode) => {
        const view = next === "timeline" ? "timeline" : "table";
        setAuditView(view);
        saveView(AUDIT_PAGE_ID, view);
    }, [saveView]);

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
                                <ViewSwitch value={groupView} onChange={changeGroupView} views={LIST_VIEWS} />
                            </div>
                            {canManageGroups && (
                                <Button tone="create" onClick={() => groups.current?.openCreate()} aria-label="New group">
                                    <Plus />
                                    <span className="hidden sm:inline">New group</span>
                                </Button>
                            )}
                        </>
                    )}
                    {active === "audit" && (
                        <>
                            <div className="hidden md:block">
                                <ViewSwitch value={auditView} onChange={changeAuditView} views={AUDIT_VIEWS} />
                            </div>
                            <Button variant="outline" onClick={() => audit.current?.exportCsv()} aria-label="Export CSV">
                                <Download />
                                <span className="hidden sm:inline">Export CSV</span>
                            </Button>
                        </>
                    )}
                    {active === "sso" && (
                        <>
                            <div className="hidden md:block">
                                <ViewSwitch value={signInView} onChange={changeSignInView} views={LIST_VIEWS} />
                            </div>
                            {viewerSuperAdmin && (
                                <Button tone="create" onClick={() => signIn.current?.openCreate()} aria-label="New provider">
                                    <Plus />
                                    <span className="hidden sm:inline">New provider</span>
                                </Button>
                            )}
                        </>
                    )}
                    {active === "apikeys" && (
                        <>
                            <div className="hidden md:block">
                                <ViewSwitch value={keyView} onChange={changeKeyView} views={LIST_VIEWS} />
                            </div>
                            {canManageApiKeys && (
                                <Button tone="create" onClick={() => apiKeys.current?.openCreate()} aria-label="New API key">
                                    <Plus />
                                    <span className="hidden sm:inline">New API key</span>
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
            {canReadApiKeys && (
                <TabsContent value="apikeys">
                    {isMobile !== undefined && (
                        <ApiKeysTab
                            ref={apiKeys}
                            view={isMobile ? "cards" : keyView}
                            canManage={canManageApiKeys}
                            canOpenRuns={canOpenRuns}
                            initialLayout={layouts[API_KEYS_TABLE_ID] ?? null}
                        />
                    )}
                </TabsContent>
            )}
            {canReadAudit && (
                <TabsContent value="audit">
                    {isMobile !== undefined && (
                        <AuditTab ref={audit} view={auditView} cards={isMobile} canSignOut={canManageUsers} viewerSuperAdmin={viewerSuperAdmin} />
                    )}
                </TabsContent>
            )}
            {canReadSignIn && (
                <TabsContent value="sso">
                    {isMobile !== undefined && (
                        <SignInTab
                            ref={signIn}
                            view={isMobile ? "cards" : signInView}
                            canManage={viewerSuperAdmin}
                            initialLayout={layouts[SIGN_IN_TABLE_ID] ?? null}
                        />
                    )}
                </TabsContent>
            )}
        </Tabs>
    );
}
