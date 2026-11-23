import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { PlatformUsersClient } from "@/components/dashboard/platform/platform-users-client";
import { PLATFORM_GROUPS_TABLE_ID, TENANT_GROUPS_TABLE_ID } from "@/components/dashboard/platform/platform-tables";
import { SIGN_IN_PAGE_ID, SIGN_IN_TABLE_ID } from "@/components/dashboard/sign-in/sign-in-tables";
import { USERS_TABLE_ID } from "@/components/dashboard/users/users-tables";
import { TenantNamesProvider } from "@/components/tenant/tenant-view";
import { getViewer, hasPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS, type Permission } from "@/lib/auth/permissions";
import { accountsSeenReach } from "@/services/user/account-visibility";
import { platformTenantNames } from "@/services/user/groups-model";
import { getTablePreferences, getViewMode } from "@/services/user/preference-service";

/** The name of the browser tab, which the root layout ends with the name of the instance. */
export const metadata: Metadata = { title: "Users & Groups of the platform" };

/**
 * Users & Groups under Platform: every account of the instance once with its tenants, its group in
 * each and its platform group, the platform groups and the groups of every tenant, and the sign-in
 * providers. Whoever may see the accounts of the platform opens the first two tabs, whoever may see
 * the sign-in providers the third, from any tenant. Every list loads in the browser and reads every
 * tenant, or for someone of a platform group of some tenants the tenants it reaches.
 */
export default async function PlatformUsersPage() {
    const viewer = await getViewer();
    // The login lives on the root page, there is no /login.
    if (!viewer) redirect("/");
    const can = (permission: Permission) => hasPermissionWithContext(viewer, permission);
    const canReadAccounts = can(PERMISSIONS.PLATFORM.ACCOUNTS_READ);
    // The providers are seen with the settings too, as on an install of one tenant before platform groups.
    const canReadSignIn = can(PERMISSIONS.PLATFORM.SIGN_IN_READ) || can(PERMISSIONS.SETTINGS.READ);
    if (!canReadAccounts && !canReadSignIn) redirect("/dashboard");

    const [layouts, signInView, tenantNames] = await Promise.all([
        getTablePreferences(viewer.id, [USERS_TABLE_ID, SIGN_IN_TABLE_ID, PLATFORM_GROUPS_TABLE_ID, TENANT_GROUPS_TABLE_ID]),
        getViewMode(viewer.id, SIGN_IN_PAGE_ID),
        // The accounts and groups name their tenants, the ones of the reach of the viewer and no other.
        canReadAccounts ? accountsSeenReach({ ...viewer, userId: viewer.id }).then(platformTenantNames) : [],
    ]);

    return (
        <div className="space-y-4 md:space-y-6">
            {/* The header bar already names the page in its breadcrumb. */}
            <h1 className="sr-only">Users & Groups of the platform</h1>
            <Suspense fallback={null}>
                <TenantNamesProvider names={tenantNames}>
                    <PlatformUsersClient
                        canReadAccounts={canReadAccounts}
                        canManageAccounts={can(PERMISSIONS.PLATFORM.ACCOUNTS_WRITE)}
                        canReadSignIn={canReadSignIn}
                        canManageSignIn={can(PERMISSIONS.PLATFORM.SIGN_IN_WRITE)}
                        layouts={layouts}
                        signInView={signInView ?? "table"}
                    />
                </TenantNamesProvider>
            </Suspense>
        </div>
    );
}
