import type { Metadata } from "next";
import { getViewer, getUserPermissions } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";
import { RestoreAllTenants } from "./restore-all-tenants";
import { RestoreClient } from "./restore-client";

/** The name of the browser tab, which the root layout ends with the name of the instance. */
export const metadata: Metadata = { title: "Restore" };

export default async function RestorePage() {
    const [permissions, user] = await Promise.all([getUserPermissions(), getViewer()]);
    const canRestore = permissions.includes(PERMISSIONS.STORAGE.RESTORE);

    // All tenants restores nothing, a restore happens in the tenant of the backup. The page says so
    // there and opens the same restore in that tenant.
    if (user?.allTenants) return <RestoreAllTenants />;

    if (!canRestore) {
        redirect("/dashboard/backups");
    }

    // Decides whether the key recovery dialog may offer to save a typed key, since doing so
    // creates a vault profile.
    return (
        <RestoreClient
            canManageVault={permissions.includes(PERMISSIONS.VAULT.WRITE)}
            canDownload={permissions.includes(PERMISSIONS.STORAGE.DOWNLOAD)}
            canRestoreConfig={user?.isPlatformAdmin ?? false}
        />
    );
}
