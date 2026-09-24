import { getCurrentUserWithGroup, getUserPermissions } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getAdapterOptions } from "@/lib/adapters/dto";
import { getEncryptionProfiles } from "@/app/actions/backup/encryption";
import { getTablePreferences, getViewMode } from "@/services/user/preference-service";
import { JOBS_PAGE_ID, JOBS_TABLE_ID } from "@/components/dashboard/jobs/job-tables";
import { JobsClient } from "./jobs-client";

export default async function JobsPage() {
    const [permissions, user] = await Promise.all([getUserPermissions(), getCurrentUserWithGroup()]);

    // The key list goes through its Server Action, which checks who may read the Vault.
    const [sources, destinations, notificationChannels, keys, layouts, savedView] = await Promise.all([
        getAdapterOptions("database"),
        getAdapterOptions("storage"),
        getAdapterOptions("notification"),
        getEncryptionProfiles(),
        user ? getTablePreferences(user.id, [JOBS_TABLE_ID]) : Promise.resolve({} as Awaited<ReturnType<typeof getTablePreferences>>),
        user ? getViewMode(user.id, JOBS_PAGE_ID) : Promise.resolve(null),
    ]);

    return (
        <div className="space-y-4 md:space-y-6">
            {/* The header bar already names the page in its breadcrumb. */}
            <h1 className="sr-only">Jobs</h1>
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
        </div>
    );
}
