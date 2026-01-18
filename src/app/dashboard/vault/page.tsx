import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getUserPermissions } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";
import { EncryptionProfilesList } from "@/components/settings/encryption-profiles-list";

export default async function VaultPage() {
    const headersList = await headers();
    const session = await auth.api.getSession({
        headers: headersList
    });

    if (!session) {
        redirect("/login");
    }

    const permissions = await getUserPermissions();
    if (!permissions.includes(PERMISSIONS.VAULT.READ)) {
        redirect("/dashboard");
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Security Vault</h2>
                    <p className="text-muted-foreground">Manage encryption keys for your backups.</p>
                </div>
            </div>

            <EncryptionProfilesList />
        </div>
    );
}
