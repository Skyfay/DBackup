import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getUserPermissions, getViewer } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { canUseQuickSetup } from "@/lib/auth/sign-in-target";
import { SetupWizard } from "@/components/dashboard/setup/setup-wizard";
import { PickTenantPage } from "@/components/tenant/tenant-pick";
import { getEncryptionProfiles } from "@/services/backup/encryption-service";
import { ownBackupReach, quickSetupFits } from "@/services/dashboard/start-page";

/** The name of the browser tab, which the root layout ends with the name of the instance. */
export const metadata: Metadata = { title: "Quick Setup" };

export default async function SetupPage() {
    const [permissions, viewer] = await Promise.all([getUserPermissions(), getViewer()]);

    // What the Quick Setup makes belongs to one tenant, which All tenants asks for first. It changes
    // nothing itself, so the check of the rights to create waits for that tenant.
    if (viewer?.allTenants) {
        return <PickTenantPage href="/dashboard/setup" />;
    }

    // Require at minimum source + destination + job write permissions
    if (!canUseQuickSetup(permissions)) {
        redirect("/dashboard");
    }

    // The Database part is required, so a tenant without a database that may add none, or without a
    // place for the backups, could never finish.
    if (!quickSetupFits(await ownBackupReach())) {
        redirect("/dashboard");
    }

    // Check optional permissions
    const canCreateVault = permissions.includes(PERMISSIONS.VAULT.WRITE);
    const canCreateNotification = permissions.includes(PERMISSIONS.NOTIFICATIONS.WRITE);

    // Only the name and the description of a key reach the browser, never the key itself. A
    // destination that takes only encrypted backups needs one of them also from someone who may
    // only read the Vault, and a job writer picks keys in the job form too.
    const keys = (await getEncryptionProfiles()).map((profile) => ({ id: profile.id, name: profile.name, detail: profile.description ?? "" }));

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
