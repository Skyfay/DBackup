import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getGroups } from "@/app/actions/auth/group";
import { getSsoProviders } from "@/app/actions/auth/oidc";
import { getApiKeys } from "@/app/actions/auth/api-key";
import { GroupTable } from "./group-table";
import { CreateGroupDialog } from "./create-group-dialog";
import { AddSsoProviderDialog } from "@/components/oidc/add-sso-provider-dialog";
import { SsoProviderList } from "@/components/oidc/sso-provider-list";
import { CreateApiKeyDialog } from "@/components/api-keys/create-api-key-dialog";
import { ApiKeyTable } from "@/components/api-keys/api-key-table";
import { AuditTable } from "@/components/audit/audit-table";
import { UsersClient, type LegacyTabs } from "@/components/dashboard/users/users-client";
import { USERS_TABLE_ID, type UsersPageCounts } from "@/components/dashboard/users/users-tables";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUserWithGroup, getUserPermissions } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getTablePreferences } from "@/services/user/preference-service";
import { getUsersPageCounts } from "@/services/user/users-model";

/** The old look of a tab that has not been redesigned yet: a card with a title, a line and one button. */
function LegacyCard({ title, description, action, children }: { title: string; description: string; action?: React.ReactNode; children: React.ReactNode }) {
    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <CardTitle>{title}</CardTitle>
                        <CardDescription>{description}</CardDescription>
                    </div>
                    {action}
                </div>
            </CardHeader>
            <CardContent>{children}</CardContent>
        </Card>
    );
}

/**
 * Users & Groups: the users with how they sign in, the groups, the API keys, the audit log and
 * the ways to sign in. The users load in the browser, the other tabs still load here.
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

    const [counts, layouts, groups, ssoProviders, apiKeys] = await Promise.all([
        getUsersPageCounts(),
        getTablePreferences(user.id, [USERS_TABLE_ID]),
        canReadGroups ? getGroups() : Promise.resolve([]),
        canReadSettings ? getSsoProviders() : Promise.resolve([]),
        canReadApiKeys ? getApiKeys() : Promise.resolve([]),
    ]);

    // The count of a tab the viewer cannot open stays out, so the page never hints at it.
    const visibleCounts: UsersPageCounts = {
        users: canReadUsers ? counts.users : undefined,
        groups: canReadGroups ? counts.groups : undefined,
        apikeys: canReadApiKeys ? counts.apikeys : undefined,
        sso: canReadSettings ? counts.sso : undefined,
    };

    const legacy: LegacyTabs = {
        groups: canReadGroups ? (
            <LegacyCard title="Groups" description="Manage permission groups." action={can(PERMISSIONS.GROUPS.WRITE) && <CreateGroupDialog />}>
                <GroupTable data={groups} canManage={can(PERMISSIONS.GROUPS.WRITE)} />
            </LegacyCard>
        ) : undefined,
        apikeys: canReadApiKeys ? (
            <LegacyCard
                title="API Keys"
                description="Create and manage API keys for external integrations and automation."
                action={can(PERMISSIONS.API_KEYS.WRITE) && <CreateApiKeyDialog />}
            >
                <ApiKeyTable data={apiKeys} canManage={can(PERMISSIONS.API_KEYS.WRITE)} />
            </LegacyCard>
        ) : undefined,
        audit: canReadAudit ? (
            <LegacyCard title="Audit Logs" description="View system activity and user actions.">
                <AuditTable />
            </LegacyCard>
        ) : undefined,
        sso: canReadSettings ? (
            <LegacyCard title="Single Sign-On" description="Manage OpenID Connect providers." action={can(PERMISSIONS.SETTINGS.WRITE) && <AddSsoProviderDialog />}>
                <SsoProviderList providers={ssoProviders} />
            </LegacyCard>
        ) : undefined,
    };

    return (
        <div className="space-y-4 md:space-y-6">
            {/* The header bar already names the page in its breadcrumb. */}
            <h1 className="sr-only">Users & Groups</h1>
            <Suspense fallback={null}>
                <UsersClient
                    canReadUsers={canReadUsers}
                    canManageUsers={can(PERMISSIONS.USERS.WRITE)}
                    counts={visibleCounts}
                    layouts={layouts}
                    legacy={legacy}
                />
            </Suspense>
        </div>
    );
}
