import { AdapterManager } from "@/components/adapter/adapter-manager";
import { STORAGE_ROLES } from "@/lib/core/storage-roles";
import { getUserPermissions } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default async function SourcesPage() {
    const permissions = await getUserPermissions();
    const canManageSources = permissions.includes(PERMISSIONS.SOURCES.WRITE);
    // Storage-adapter role is a destination-adapter concern (same underlying credentials/CRUD
    // as the Destinations page), so directory sources are gated by DESTINATIONS.WRITE, not a
    // separate sources permission - see the Destinations page for the same check. These two
    // permissions are also why the tabs keep two separate tables: a user can hold one and not
    // the other, and a merged table would have to decide per row who may edit what.
    const canManageDirectorySources = permissions.includes(PERMISSIONS.DESTINATIONS.WRITE);

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Sources</h2>
                    <p className="text-muted-foreground">Configure the databases and directories you want to back up.</p>
                </div>
            </div>

            <Tabs defaultValue="databases" className="w-full">
                <TabsList>
                    <TabsTrigger value="databases">Databases</TabsTrigger>
                    <TabsTrigger value="directories">Directories</TabsTrigger>
                </TabsList>

                <TabsContent value="databases" className="mt-4">
                    <AdapterManager
                        type="database"
                        title="Databases"
                        description="Configure the databases you want to backup."
                        canManage={canManageSources}
                        permissions={permissions}
                        hidePageHeading
                    />
                </TabsContent>

                <TabsContent value="directories" className="mt-4">
                    <AdapterManager
                        type="storage"
                        title="Directories"
                        description="Storage adapters whose folders can be backed up as files."
                        canManage={canManageDirectorySources}
                        permissions={permissions}
                        roleFilter={STORAGE_ROLES.SOURCE}
                        defaultRole={STORAGE_ROLES.SOURCE}
                        hidePageHeading
                    />
                </TabsContent>
            </Tabs>
        </div>
    )
}
