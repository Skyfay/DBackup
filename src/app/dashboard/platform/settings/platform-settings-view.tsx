import { redirect } from "next/navigation";
import { SettingsClient } from "@/components/dashboard/settings/settings-client";
import { getViewer, hasPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS, TRASH_ADMIN_PERMISSION } from "@/lib/auth/permissions";
import { getSettingsModel } from "@/services/system/settings-model";

/**
 * The settings of the instance: Settings with one tenant, Platform settings with more. Whoever may
 * read the settings opens them, as before tenants, and only who may change them saves. With one
 * tenant Recently deleted is a part of them too, for whoever may read the tenant settings, and
 * restores for whoever may change them. With more it is a part of the tenant settings.
 */
export async function PlatformSettingsView({ tenantCount }: { tenantCount: number }) {
    const viewer = await getViewer();
    if (!viewer) redirect("/");
    if (!hasPermissionWithContext(viewer, PERMISSIONS.SETTINGS.READ)) redirect("/dashboard");

    const withTrash = tenantCount <= 1 && hasPermissionWithContext(viewer, PERMISSIONS.TENANT_SETTINGS.READ);
    const model = await getSettingsModel({
        canManage: hasPermissionWithContext(viewer, PERMISSIONS.SETTINGS.WRITE),
        isPlatformAdmin: viewer.isPlatformAdmin,
        allTenants: viewer.allTenants,
        trash: withTrash
            ? { permissions: viewer.permissions, isPlatformAdmin: viewer.isPlatformAdmin, canManage: hasPermissionWithContext(viewer, TRASH_ADMIN_PERMISSION) }
            : null,
    });

    return (
        <>
            {/* The header bar already names the page in its breadcrumb. */}
            <h1 className="sr-only">{tenantCount > 1 ? "Platform settings" : "Settings"}</h1>
            <SettingsClient
                model={model}
                viewerName={viewer.name || viewer.email || "Admin"}
                note={tenantCount > 1 ? `These settings count for the whole instance, all ${tenantCount} tenants. Each tenant keeps its name, logo, notifications and Recently deleted under Settings in the tenant.` : undefined}
            />
        </>
    );
}
