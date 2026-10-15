"use client";

import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, HardDrive } from "lucide-react";
import { useExplorerData } from "@/components/dashboard/storage/explorer/explorer-data";
import type { FileInfo } from "@/components/dashboard/storage/file-info";
import { parseRestoreScope } from "@/components/dashboard/storage/restore-scope";
import { RestoreHead } from "@/components/dashboard/storage/restore/restore-head";
import { RestorePlaceholder } from "@/components/dashboard/storage/restore/restore-parts";
import { AllTenantsNotice } from "@/components/tenant/all-tenants-notice";
import { useTenantName } from "@/components/tenant/tenant-view";
import { decodeUrlPayload } from "@/lib/url-payload";
import type { ExplorerIndex } from "@/services/storage/explorer-types";

/**
 * The restore page in All tenants, like from a bookmark. A restore writes into a server of one
 * tenant, so the page only says what would be restored and offers to open it in the tenant of the
 * destination that holds the backup, where the restore starts. Nothing here reads the archive or
 * starts a run.
 */
export function RestoreAllTenants() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const file = useMemo(() => decodeUrlPayload<FileInfo>(searchParams.get("file")), [searchParams]);
    const destinationId = searchParams.get("destinationId") ?? "";
    const mode = searchParams.get("mode");
    const { wantsDatabases, wantsFiles } = parseRestoreScope(mode);
    // The destination names the tenant of the backup.
    const index = useExplorerData<ExplorerIndex>(file && destinationId ? "/api/storage/explorer" : null);
    const destination = index.data?.destinations.find((entry) => entry.id === destinationId) ?? null;
    const nameOf = useTenantName();
    const tenantName = nameOf(destination?.tenantId);
    const back = () => router.push(destinationId ? `/dashboard/backups?at=${encodeURIComponent(destinationId)}` : "/dashboard/backups");

    if (!file || !destinationId) {
        return (
            <RestorePlaceholder icon={HardDrive} title="No backup is picked" action={{ label: "Back to Backups", onClick: () => router.push("/dashboard/backups") }}>
                Open a backup on the Backups page and pick Restore.
            </RestorePlaceholder>
        );
    }

    return (
        <div className="space-y-4 md:space-y-6">
            <AllTenantsNotice tenantId={destination?.tenantId} />
            <RestoreHead
                file={file}
                destinationId={destinationId}
                scopeLabel={!wantsDatabases ? "Files only" : !wantsFiles ? "Databases only" : null}
                mode={mode}
                onBack={back}
                destination={destination}
            />
            <RestorePlaceholder icon={Building2} title="A restore runs in the tenant of its backup">
                {index.loading
                    ? "Looking up the tenant of the backup."
                    : tenantName
                        ? `Open it in ${tenantName} to pick what comes back and where it goes.`
                        : index.error
                            ? "The tenant of the backup could not be looked up. Open the backup from the Backups page."
                            : "Its destination is gone, so no tenant holds this backup anymore."}
            </RestorePlaceholder>
        </div>
    );
}
