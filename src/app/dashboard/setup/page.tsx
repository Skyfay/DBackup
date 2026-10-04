import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getUserPermissions } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { canUseQuickSetup } from "@/lib/auth/sign-in-target";
import { SetupWizard } from "@/components/dashboard/setup/setup-wizard";
import { getEncryptionProfiles } from "@/services/backup/encryption-service";

/** The name of the browser tab, which the root layout ends with the name of the instance. */
export const metadata: Metadata = { title: "Quick Setup" };

export default async function SetupPage() {
    const permissions = await getUserPermissions();

    // Require at minimum source + destination + job write permissions
    if (!canUseQuickSetup(permissions)) {
        redirect("/dashboard");
    }

    // Check optional permissions
    const canCreateVault = permissions.includes(PERMISSIONS.VAULT.WRITE);
    const canCreateNotification = permissions.includes(PERMISSIONS.NOTIFICATIONS.WRITE);

    // Only the name and the description of a key reach the browser, never the key itself.
    const keys = canCreateVault
        ? (await getEncryptionProfiles()).map((profile) => ({ id: profile.id, name: profile.name, detail: profile.description ?? "" }))
        : [];

    // Only pass serializable props - Zod schemas cannot cross the Server→Client boundary
    return (
        <SetupWizard
            canCreateVault={canCreateVault}
            canCreateNotification={canCreateNotification}
            canRunJob={permissions.includes(PERMISSIONS.JOBS.EXECUTE)}
            canOpenVault={permissions.includes(PERMISSIONS.VAULT.READ)}
            keys={keys}
        />
    );
}
