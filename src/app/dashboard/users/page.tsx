import { Suspense } from "react";
import { redirect } from "next/navigation";
import { API_KEYS_PAGE_ID, API_KEYS_TABLE_ID } from "@/components/dashboard/api-keys/api-keys-tables";
import { AUDIT_PAGE_ID } from "@/components/dashboard/audit/audit-tables";
import { GROUPS_PAGE_ID, GROUPS_TABLE_ID } from "@/components/dashboard/groups/groups-tables";
import { SIGN_IN_PAGE_ID, SIGN_IN_TABLE_ID } from "@/components/dashboard/sign-in/sign-in-tables";
import { UsersClient } from "@/components/dashboard/users/users-client";
import { USERS_TABLE_ID, type UsersPageAttention } from "@/components/dashboard/users/users-tables";
import { getCurrentUserWithGroup, getUserPermissions } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getTablePreferences, getViewMode } from "@/services/user/preference-service";
import { getUsersPageAttention } from "@/services/user/users-model";

/**
 * Users & Groups: the users with how they sign in, the groups, the API keys, the audit log and
 * the ways to sign in. Every tab loads in the browser, the page only decides which ones show.
 */
export default async function UsersPage() {
    const [permissions, user] = await Promise.all([getUserPermissions(), getCurrentUserWithGroup()]);
    if (!user) redirect("/login");

    const can = (permission: string) => permissions.includes(permission);
    const canReadUsers = can(PERMISSIONS.USERS.READ);
    const canReadGroups = can(PERMISSIONS.GROUPS.READ);
    const canReadAudit = can(PERMISSIONS.AUDIT.READ);
    const canReadApiKeys = can(PERMISSIONS.API_KEYS.READ);
    const canReadSettings = can(PERMISSIONS.SETTINGS.READ);
    if (!canReadUsers && !canReadGroups && !canReadAudit && !canReadApiKeys) redirect("/dashboard");

    const [attention, layouts, groupsView, apiKeysView, auditView, signInView] = await Promise.all([
        getUsersPageAttention(),
        getTablePreferences(user.id, [USERS_TABLE_ID, GROUPS_TABLE_ID, API_KEYS_TABLE_ID, SIGN_IN_TABLE_ID]),
        getViewMode(user.id, GROUPS_PAGE_ID),
        getViewMode(user.id, API_KEYS_PAGE_ID),
        getViewMode(user.id, AUDIT_PAGE_ID),
        getViewMode(user.id, SIGN_IN_PAGE_ID),
    ]);

    // The dot of a tab the viewer cannot open stays out, so the page never hints at it.
    const visibleAttention: UsersPageAttention = {
        users: canReadUsers ? attention.users : undefined,
        apikeys: canReadApiKeys ? attention.apikeys : undefined,
    };

    return (
        <div className="space-y-4 md:space-y-6">
            {/* The header bar already names the page in its breadcrumb. */}
            <h1 className="sr-only">Users & Groups</h1>
            <Suspense fallback={null}>
                <UsersClient
                    canReadUsers={canReadUsers}
                    canManageUsers={can(PERMISSIONS.USERS.WRITE)}
                    canReadGroups={canReadGroups}
                    canManageGroups={can(PERMISSIONS.GROUPS.WRITE)}
                    canReadApiKeys={canReadApiKeys}
                    canManageApiKeys={can(PERMISSIONS.API_KEYS.WRITE)}
                    canOpenRuns={can(PERMISSIONS.HISTORY.READ)}
                    canReadAudit={canReadAudit}
                    canReadSignIn={canReadSettings}
                    viewerSuperAdmin={user.group?.name === "SuperAdmin"}
                    attention={visibleAttention}
                    layouts={layouts}
                    groupsView={groupsView ?? "table"}
                    apiKeysView={apiKeysView ?? "table"}
                    auditView={auditView ?? "table"}
                    signInView={signInView ?? "table"}
                />
            </Suspense>
        </div>
    );
}
