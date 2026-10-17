import type { Metadata } from "next";
import { getViewer, getUserPermissions } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getAdapterOptions } from "@/lib/adapters/dto";
import { connectionOptions } from "@/services/sharing/connection-options";
import { getEncryptionProfiles } from "@/app/actions/backup/encryption";
import { getTablePreferences, getViewMode } from "@/services/user/preference-service";
import { JOBS_PAGE_ID, JOBS_TABLE_ID } from "@/components/dashboard/jobs/job-tables";
import { TenantKeyed } from "@/components/tenant/tenant-keyed";
import { JobsClient } from "./jobs-client";

/** The name of the browser tab, which the root layout ends with the name of the instance. */
export const metadata: Metadata = { title: "Jobs" };

export default async function JobsPage() {
    const [permissions, user] = await Promise.all([getUserPermissions(), getViewer()]);

    // The key list goes through its Server Action, which checks who may read the Vault.
    const [sources, destinations, notificationChannels, keys, layouts, savedView] = await Promise.all([
        getAdapterOptions("database"),
        // The destinations and channels other tenants share with this one too.
        connectionOptions("storage"),
        connectionOptions("notification"),
        getEncryptionProfiles(),
        user ? getTablePreferences(user.id, [JOBS_TABLE_ID]) : Promise.resolve({} as Awaited<ReturnType<typeof getTablePreferences>>),
        user ? getViewMode(user.id, JOBS_PAGE_ID) : Promise.resolve(null),
    ]);

    return (
        <div className="space-y-4 md:space-y-6">
            {/* The header bar already names the page in its breadcrumb. */}
            <h1 className="sr-only">Jobs</h1>
            <TenantKeyed>
                <JobsClient
                    canManage={permissions.includes(PERMISSIONS.JOBS.WRITE)}
                    canExecute={permissions.includes(PERMISSIONS.JOBS.EXECUTE)}
                    canViewHistory={permissions.includes(PERMISSIONS.HISTORY.READ)}
                    canViewStorage={permissions.includes(PERMISSIONS.STORAGE.READ)}
                    sources={sources}
                    destinations={destinations}
                    notificationChannels={notificationChannels}
                    encryptionProfiles={
                        keys.success && keys.data
                            ? keys.data.map((profile) => ({ id: profile.id, name: profile.name, description: profile.description, jobCount: profile._count.jobs }))
                            : []
                    }
                    initialLayout={layouts[JOBS_TABLE_ID] ?? null}
                    initialView={savedView ?? "table"}
                />
            </TenantKeyed>
        </div>
    );
}
