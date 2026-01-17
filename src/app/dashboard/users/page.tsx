import { getUsers } from "@/app/actions/user";
import { getGroups } from "@/app/actions/group";
import { UserTable } from "./user-table";
import { GroupTable } from "./group-table";
import { CreateUserDialog } from "./create-user-dialog";
import { CreateGroupDialog } from "./create-group-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getUserPermissions } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";

export default async function UsersPage() {
    const users = await getUsers();
    const groups = await getGroups();
    const permissions = await getUserPermissions();

    const canManageUsers = permissions.includes(PERMISSIONS.USERS.WRITE);
    const canManageGroups = permissions.includes(PERMISSIONS.GROUPS.WRITE);

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Access Management</h2>
                    <p className="text-muted-foreground">
                        Manage users, groups and their permissions.
                    </p>
                </div>
            </div>

            <Tabs defaultValue="users" className="space-y-4">
                <TabsList>
                    <TabsTrigger value="users">Users</TabsTrigger>
                    <TabsTrigger value="groups">Groups</TabsTrigger>
                </TabsList>
                <TabsContent value="users" className="space-y-4">
                    {canManageUsers && (
                        <div className="flex justify-end">
                            <CreateUserDialog />
                        </div>
                    )}
                    <UserTable data={users} groups={groups} canManage={canManageUsers} />
                </TabsContent>
                <TabsContent value="groups" className="space-y-4">
                    {canManageGroups && (
                        <div className="flex justify-end">
                            <CreateGroupDialog />
                        </div>
                    )}
                    <GroupTable data={groups} canManage={canManageGroups} />
                </TabsContent>
            </Tabs>
        </div>
    );
}
