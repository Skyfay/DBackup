import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { API_KEYS_PAGE_ID, API_KEYS_TABLE_ID } from "@/components/dashboard/api-keys/api-keys-tables";
import { AUDIT_PAGE_ID } from "@/components/dashboard/audit/audit-tables";
import { GROUPS_PAGE_ID, GROUPS_TABLE_ID } from "@/components/dashboard/groups/groups-tables";
import { SIGN_IN_PAGE_ID, SIGN_IN_TABLE_ID } from "@/components/dashboard/sign-in/sign-in-tables";
import { UsersClient } from "@/components/dashboard/users/users-client";
import { USERS_TABLE_ID, type UsersPageAttention } from "@/components/dashboard/users/users-tables";
import { PickTenantPanel } from "@/components/tenant/tenant-pick";
import { getViewer, getUserPermissions } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getTablePreferences, getViewMode } from "@/services/user/preference-service";
import { getUsersPageAttention } from "@/services/user/users-model";
import { tenantService } from "@/services/tenant/tenant-service";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { firstOf, type PageSearchParams } from "../search-params";

/** The name of the browser tab, which the root layout ends with the name of the instance. */
export const metadata: Metadata = { title: "Users & Groups" };

/**
 * Users & Groups under Administration: the members of the open tenant with how they sign in, its
 * groups, its API keys and its audit log, and with one tenant the ways to sign in. With more than
 * one tenant the sign-in providers and every account of the instance are under Platform. Every tab
 * loads in the browser, the page only decides which ones show.
 */
export default async function UsersPage({ searchParams }: { searchParams: Promise<PageSearchParams> }) {
    const [permissions, user, params, tenantCount] = await Promise.all([getUserPermissions(), getViewer(), searchParams, tenantService.count()]);
    // The login lives on the root page, there is no /login.
    if (!user) redirect("/");

    const can = (permission: string) => permissions.includes(permission);
    const canReadUsers = can(PERMISSIONS.USERS.READ);
    const canReadGroups = can(PERMISSIONS.GROUPS.READ);
    const canReadAudit = can(PERMISSIONS.AUDIT.READ);
    const canReadApiKeys = can(PERMISSIONS.API_KEYS.READ);
    // The providers are seen with the settings too, as on an install of one tenant before platform groups.
    const canReadSignIn = can(PERMISSIONS.PLATFORM.SIGN_IN_READ) || can(PERMISSIONS.SETTINGS.READ);
    // With more than one tenant the sign-in providers are the platform's, an old link to them lands there.
    if (tenantCount > 1 && firstOf(params, "tab") === "sso" && canReadSignIn) redirect("/dashboard/platform/users?tab=providers");
    // With one tenant the providers are a tab of this page, which may be all the viewer sees here.
    const showsSignIn = canReadSignIn && tenantCount <= 1;
    if (!canReadUsers && !canReadGroups && !canReadAudit && !canReadApiKeys && !showsSignIn) redirect("/dashboard");

    // All tenants changes no tenant: the members, groups and keys belong to one, every account is under Platform.
    if (user.allTenants) {
        return (
            <PickTenantPanel
                title="Users & Groups"
                description="Members, groups, API keys and the audit log belong to one tenant. Pick the tenant to open them in."
                href="/dashboard/users"
                footer={
                    <>
                        Every account of the instance with its tenants is under{" "}
                        <Link href="/dashboard/platform/users" className="font-medium text-foreground underline-offset-4 hover:underline">Platform, Users & Groups</Link>.
                    </>
                }
            />
        );
    }

    const [attention, layouts, groupsView, apiKeysView, auditView, signInView] = await Promise.all([
        getUsersPageAttention(user.tenantId ?? HOME_TENANT_ID),
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
                    // With more than one tenant the providers are the platform's, under Platform, Users & Groups.
                    canReadSignIn={showsSignIn}
                    canManageSignIn={can(PERMISSIONS.PLATFORM.SIGN_IN_WRITE)}
                    viewerPlatformAdmin={user.isPlatformAdmin}
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
