import { getUserPermissions } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getAdapterOptions } from "@/lib/adapters/dto";
import { getEncryptionProfiles } from "@/app/actions/backup/encryption";
import { JobsClient } from "./jobs-client";
import type { EncryptionOption } from "@/components/dashboard/jobs/job-form";

export default async function JobsPage() {
    const permissions = await getUserPermissions();
    const canManage = permissions.includes(PERMISSIONS.JOBS.WRITE);
    const canExecute = permissions.includes(PERMISSIONS.JOBS.EXECUTE);

    const [sources, destinations, notificationChannels, encRes] = await Promise.all([
        getAdapterOptions("database"),
        getAdapterOptions("storage"),
        getAdapterOptions("notification"),
        getEncryptionProfiles(),
    ]);
    const encryptionProfiles: EncryptionOption[] =
        encRes.success && encRes.data ? encRes.data.map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })) : [];

    return (
        <JobsClient
            canManage={canManage}
            canExecute={canExecute}
            sources={sources}
            destinations={destinations}
            notificationChannels={notificationChannels}
            encryptionProfiles={encryptionProfiles}
        />
    );
}
