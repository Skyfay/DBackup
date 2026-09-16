import { getUserPermissions } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";
import { RestoreClient } from "./restore-client";

export default async function RestorePage() {
    const permissions = await getUserPermissions();
    const canRestore = permissions.includes(PERMISSIONS.STORAGE.RESTORE);

    if (!canRestore) {
        redirect("/dashboard/storage");
    }

    // Decides whether the key recovery dialog may offer to save a typed key, since doing so
    // creates a vault profile.
    return (
        <RestoreClient
            canManageVault={permissions.includes(PERMISSIONS.VAULT.WRITE)}
            canDownload={permissions.includes(PERMISSIONS.STORAGE.DOWNLOAD)}
        />
    );
}
