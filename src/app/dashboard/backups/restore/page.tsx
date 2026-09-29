import { getCurrentUserWithGroup, getUserPermissions } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";
import { RestoreClient } from "./restore-client";

export default async function RestorePage() {
    const [permissions, user] = await Promise.all([getUserPermissions(), getCurrentUserWithGroup()]);
    const canRestore = permissions.includes(PERMISSIONS.STORAGE.RESTORE);

    if (!canRestore) {
        redirect("/dashboard/backups");
    }

    // Decides whether the key recovery dialog may offer to save a typed key, since doing so
    // creates a vault profile.
    return (
        <RestoreClient
            canManageVault={permissions.includes(PERMISSIONS.VAULT.WRITE)}
            canDownload={permissions.includes(PERMISSIONS.STORAGE.DOWNLOAD)}
            canRestoreConfig={user?.group?.name === "SuperAdmin"}
        />
    );
}
