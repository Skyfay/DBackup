import { AdapterManager } from "@/components/adapter/adapter-manager";
import { getUserPermissions } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";

export default async function SourcesPage() {
    const permissions = await getUserPermissions();
    const canManage = permissions.includes(PERMISSIONS.SOURCES.WRITE);

    return (
        <AdapterManager
            type="database"
            title="Sources"
            description="Configure the databases you want to backup."
            canManage={canManage}
            permissions={permissions}
        />
    )
}
