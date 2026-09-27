import { Suspense } from "react";
import { redirect } from "next/navigation";
import { VaultClient } from "@/components/dashboard/vault/vault-client";
import { VAULT_TABLE_IDS, type VaultCounts } from "@/components/dashboard/vault/vault-tables";
import { getCurrentUserWithGroup, getUserPermissions } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getTablePreferences } from "@/services/user/preference-service";
import { getVaultCounts } from "@/services/vault/vault-counts";

/**
 * The Vault: the credential profiles connections log in with, and the keys backups are encrypted
 * with. The lists load in the browser, the page only resolves who may do what.
 */
export default async function VaultPage() {
    const [permissions, user] = await Promise.all([getUserPermissions(), getCurrentUserWithGroup()]);
    if (!user) redirect("/login");
    if (!permissions.includes(PERMISSIONS.VAULT.READ)) redirect("/dashboard");

    const [counts, layouts] = await Promise.all([getVaultCounts(), getTablePreferences(user.id, Object.values(VAULT_TABLE_IDS))]);
    const canReadCredentials = permissions.includes(PERMISSIONS.CREDENTIALS.READ);
    // The count of a tab the viewer cannot open stays out, so the page never hints at it.
    const visibleCounts: VaultCounts = { credentials: canReadCredentials ? counts.credentials : undefined, keys: counts.keys };

    return (
        <div className="space-y-4 md:space-y-6">
            {/* The header bar already names the page in its breadcrumb. */}
            <h1 className="sr-only">Vault</h1>
            <Suspense fallback={null}>
                <VaultClient
                    counts={visibleCounts}
                    layouts={layouts}
                    access={{
                        canReadCredentials,
                        canWrite: permissions.includes(PERMISSIONS.CREDENTIALS.WRITE),
                        canDelete: permissions.includes(PERMISSIONS.CREDENTIALS.DELETE),
                        canReveal: permissions.includes(PERMISSIONS.CREDENTIALS.REVEAL),
                        canManageKeys: permissions.includes(PERMISSIONS.VAULT.WRITE),
                    }}
                />
            </Suspense>
        </div>
    );
}
