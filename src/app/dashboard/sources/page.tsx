import { AdapterManager } from "@/components/adapter/adapter-manager";
import { STORAGE_ROLES } from "@/lib/core/storage-roles";
import { getUserPermissions } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";

export default async function SourcesPage() {
    const permissions = await getUserPermissions();
    const canManageSources = permissions.includes(PERMISSIONS.SOURCES.WRITE);
    // Storage-adapter role is a destination-adapter concern (same underlying credentials/CRUD
    // as the Destinations page), so directory sources are gated by DESTINATIONS.WRITE, not a
    // separate sources permission - see the Destinations page for the same check.
    const canManageDirectorySources = permissions.includes(PERMISSIONS.DESTINATIONS.WRITE);

    return (
        <div className="space-y-8">
            <AdapterManager
                type="database"
                title="Sources"
                description="Configure the databases you want to backup."
                canManage={canManageSources}
                permissions={permissions}
            />
            <AdapterManager
                type="storage"
                title="Directory Sources"
                description="Storage adapters enabled to back up files and directories."
                canManage={canManageDirectorySources}
                permissions={permissions}
                roleFilter={STORAGE_ROLES.SOURCE}
                defaultRole={STORAGE_ROLES.SOURCE}
            />
        </div>
    )
}
