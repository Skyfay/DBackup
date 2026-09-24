import { getUsers } from "@/app/actions/auth/user";
import { getGroups } from "@/app/actions/auth/group";
import { getSsoProviders } from "@/app/actions/auth/oidc";
import { getApiKeys } from "@/app/actions/auth/api-key";
import { UserTable } from "./user-table";
import { GroupTable } from "./group-table";
import { AddSsoProviderDialog } from "@/components/oidc/add-sso-provider-dialog";
import { SsoProviderList } from "@/components/oidc/sso-provider-list";
import { CreateUserDialog } from "./create-user-dialog";
import { CreateGroupDialog } from "./create-group-dialog";
import { CreateApiKeyDialog } from "@/components/api-keys/create-api-key-dialog";
import { ApiKeyTable } from "@/components/api-keys/api-key-table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getUserPermissions, getCurrentUserWithGroup } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AuditTable } from "@/components/audit/audit-table";

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
    const permissions = await getUserPermissions();
    const { tab } = await searchParams;

    const hasReadUsers = permissions.includes(PERMISSIONS.USERS.READ);
    const hasReadGroups = permissions.includes(PERMISSIONS.GROUPS.READ);
    const hasReadAudit = permissions.includes(PERMISSIONS.AUDIT.READ);
    const hasReadApiKeys = permissions.includes(PERMISSIONS.API_KEYS.READ);

    if (!hasReadUsers && !hasReadGroups && !hasReadAudit && !hasReadApiKeys) {
        redirect("/dashboard");
    }

    const canManageUsers = permissions.includes(PERMISSIONS.USERS.WRITE);
    const canManageGroups = permissions.includes(PERMISSIONS.GROUPS.WRITE);
    const canManageApiKeys = permissions.includes(PERMISSIONS.API_KEYS.WRITE);
    const hasReadSettings = permissions.includes(PERMISSIONS.SETTINGS.READ);
    const hasWriteSettings = permissions.includes(PERMISSIONS.SETTINGS.WRITE);

    // Fetch data only if permission is granted, otherwise provide empty array to avoid server action errors
    // The table needs this to keep the signed-in account out of a bulk selection. The
    // action refuses it server-side too, this only avoids offering it.
    const currentUser = await getCurrentUserWithGroup();
    const users = hasReadUsers ? await getUsers() : [];
    const groups = hasReadGroups ? await getGroups() : [];
    const ssoProviders = hasReadSettings ? await getSsoProviders() : [];
    const apiKeys = hasReadApiKeys ? await getApiKeys() : [];

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Access Management</h2>
                    <p className="text-muted-foreground">
                        Manage users, groups and their permissions.
                    </p>
                </div>
            </div>

            {/* A link like the one of the API trigger opens the API Keys tab with ?tab=apikeys. */}
            <Tabs
                defaultValue={tab === "apikeys" && hasReadApiKeys ? "apikeys" : hasReadUsers ? "users" : hasReadGroups ? "groups" : hasReadApiKeys ? "apikeys" : "audit"}
                className="space-y-4"
            >
                <TabsList>
                    {hasReadUsers && <TabsTrigger value="users">Users</TabsTrigger>}
                    {hasReadGroups && <TabsTrigger value="groups">Groups</TabsTrigger>}
                    {hasReadApiKeys && <TabsTrigger value="apikeys">API Keys</TabsTrigger>}
                    {hasReadAudit && <TabsTrigger value="audit">Audit Log</TabsTrigger>}
                    {hasReadSettings && <TabsTrigger value="sso">SSO / OIDC</TabsTrigger>}
                </TabsList>
                {hasReadUsers && (
                    <TabsContent value="users" className="space-y-4">
                        <Card>
                            <CardHeader>
                                <div className="flex justify-between items-center">
                                    <div>
                                        <CardTitle>Users</CardTitle>
                                        <CardDescription>Manage system users and their assignments.</CardDescription>
                                    </div>
                                    {canManageUsers && <CreateUserDialog />}
                                </div>
                            </CardHeader>
                            <CardContent>
                                <UserTable data={users} groups={groups} canManage={canManageUsers} currentUserId={currentUser?.id ?? null} />
                            </CardContent>
                        </Card>
                    </TabsContent>
                )}
                {hasReadGroups && (
                    <TabsContent value="groups" className="space-y-4">
                        <Card>
                            <CardHeader>
                                <div className="flex justify-between items-center">
                                    <div>
                                        <CardTitle>Groups</CardTitle>
                                        <CardDescription>Manage permission groups.</CardDescription>
                                    </div>
                                    {canManageGroups && <CreateGroupDialog />}
                                </div>
                            </CardHeader>
                            <CardContent>
                                <GroupTable data={groups} canManage={canManageGroups} />
                            </CardContent>
                        </Card>
                    </TabsContent>
                )}
                {hasReadApiKeys && (
                    <TabsContent value="apikeys" className="space-y-4">
                        <Card>
                            <CardHeader>
                                <div className="flex justify-between items-center">
                                    <div>
                                        <CardTitle>API Keys</CardTitle>
                                        <CardDescription>Create and manage API keys for external integrations and automation.</CardDescription>
                                    </div>
                                    {canManageApiKeys && <CreateApiKeyDialog />}
                                </div>
                            </CardHeader>
                            <CardContent>
                                <ApiKeyTable data={apiKeys} canManage={canManageApiKeys} />
                            </CardContent>
                        </Card>
                    </TabsContent>
                )}
                {hasReadAudit && (
                    <TabsContent value="audit" className="space-y-4">
                        <Card>
                            <CardHeader>
                                <CardTitle>Audit Logs</CardTitle>
                                <CardDescription>View system activity and user actions.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <AuditTable />
                            </CardContent>
                        </Card>
                    </TabsContent>
                )}
                {hasReadSettings && (
                    <TabsContent value="sso" className="space-y-4">
                        <Card>
                             <CardHeader>
                                <div className="flex justify-between items-center">
                                    <div>
                                        <CardTitle>Single Sign-On</CardTitle>
                                        <CardDescription>Manage OpenID Connect providers.</CardDescription>
                                    </div>
                                    {hasWriteSettings && <AddSsoProviderDialog />}
                                </div>
                            </CardHeader>
                            <CardContent>
                                <SsoProviderList providers={ssoProviders} />
                            </CardContent>
                        </Card>
                    </TabsContent>
                )}
            </Tabs>
        </div>
    );
}
