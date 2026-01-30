import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getUserPermissions } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";
import prisma from "@/lib/prisma";
import { SystemSettingsForm } from "@/components/settings/system-settings-form";
import { SystemTasksSettings } from "@/components/settings/system-tasks-settings";
import { ConfigBackupSettings } from "@/components/settings/config-backup-settings";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default async function SettingsPage() {
    const headersList = await headers();
    const session = await auth.api.getSession({
        headers: headersList
    });

    if (!session) {
        redirect("/login");
    }

    const permissions = await getUserPermissions();
    if (!permissions.includes(PERMISSIONS.SETTINGS.READ)) {
        redirect("/dashboard");
    }

    // Load Settings
    const maxJobsSetting = await prisma.systemSetting.findUnique({ where: { key: "maxConcurrentJobs" } });
    const maxConcurrentJobs = maxJobsSetting ? parseInt(maxJobsSetting.value) : 1;

    const disablePasskeySetting = await prisma.systemSetting.findUnique({ where: { key: "auth.disablePasskeyLogin" } });
    const disablePasskeyLogin = disablePasskeySetting?.value === 'true';

    const retentionSetting = await prisma.systemSetting.findUnique({ where: { key: "audit.retentionDays" } });
    const auditLogRetentionDays = retentionSetting ? parseInt(retentionSetting.value) : 90;

    const checkUpdatesSetting = await prisma.systemSetting.findUnique({ where: { key: "general.checkForUpdates" } });
    const checkForUpdates = checkUpdatesSetting ? checkUpdatesSetting.value === 'true' : true;

    // Load Config Backup Settings
    const configEnabled = await prisma.systemSetting.findUnique({ where: { key: "config.backup.enabled" } });
    const configSchedule = await prisma.systemSetting.findUnique({ where: { key: "config.backup.schedule" } });
    const configStorageId = await prisma.systemSetting.findUnique({ where: { key: "config.backup.storageId" } });
    const configProfileId = await prisma.systemSetting.findUnique({ where: { key: "config.backup.profileId" } });
    const configIncludeSecrets = await prisma.systemSetting.findUnique({ where: { key: "config.backup.includeSecrets" } });
    const configRetention = await prisma.systemSetting.findUnique({ where: { key: "config.backup.retention" } });

    // Load Options for Config Backup
    const storageAdapters = await prisma.adapterConfig.findMany({
        where: { type: { in: ["s3", "local", "sftp"] } }, // Or better logic to identify storage?
        // Wait, adapter types are dynamic strings. Usually I filtered by registry logic or blindly by what I think are storage.
        // Actually, schema has 'type' which matches adapter IDs like 's3-generic', 'filesystem', 'sftp' etc.
        // In AdapterService I usually have `getStorageAdapters()`.
        // Direct DB Query: I should define which types are "storage".
        // Or I fetch all and client side filter? No.
        // Let's use standard types I know of: 'filesystem', 's3', 's3-aws', 's3-r2', 's3-hetzner', 'sftp'.
        // Better: look at `src/lib/adapters/index.ts`.
        // For now, I'll filter in code? No, I can fetch all.
        // Or I can add `where: { type: { contains: "s3" } }` etc.
        // Correct approach: `registry.getByType("storage")` helps in backend, specifically here we query DB.
        // DB `AdapterConfig` has `type` field.
        select: { id: true, name: true, type: true }
    });

    // Simple heuristic for now since I can't import registry easily in RSC without side effects sometimes.
    // Actually, `src/lib/adapters/index.ts` is safe.
    // But `type` in DB is the ID of adapter e.g. "mysql", "filesystem".
    // I will fetch all and filter in JS for now to be safe, assuming < 100 adapters.
    const allAdapters = await prisma.adapterConfig.findMany({ select: { id: true, name: true, type: true }});
    // Hardcoded known storage types list for now.
    const storageTypes = ["filesystem", "s3", "s3-aws", "s3-r2", "s3-hetzner", "sftp"];
    const filteredStorageAdapters = allAdapters.filter(a => storageTypes.includes(a.type) || a.type.startsWith("s3"));

    const encryptionProfiles = await prisma.encryptionProfile.findMany({ select: { id: true, name: true }});

    const configBackupSettings = {
        enabled: configEnabled?.value === 'true',
        schedule: configSchedule?.value || "0 3 * * *",
        storageId: configStorageId?.value || "",
        profileId: configProfileId?.value || "",
        includeSecrets: configIncludeSecrets?.value === 'true',
        retention: configRetention ? parseInt(configRetention.value) : 10,
    };


    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                   <h2 className="text-3xl font-bold tracking-tight">System Settings</h2>
                   <p className="text-muted-foreground">Configure global system parameters.</p>
                </div>
            </div>

            <Tabs defaultValue="general" className="space-y-4">
                <TabsList>
                    <TabsTrigger value="general">General</TabsTrigger>
                    <TabsTrigger value="tasks">System Tasks</TabsTrigger>
                    <TabsTrigger value="config">Configuration Backup</TabsTrigger>
                </TabsList>
                <TabsContent value="general" className="space-y-4">
                    <SystemSettingsForm
                        initialMaxConcurrentJobs={maxConcurrentJobs}
                        initialDisablePasskeyLogin={disablePasskeyLogin}
                        initialAuditLogRetentionDays={auditLogRetentionDays}
                        initialCheckForUpdates={checkForUpdates}
                    />
                </TabsContent>
                <TabsContent value="tasks" className="space-y-4">
                    <SystemTasksSettings />
                </TabsContent>
                <TabsContent value="config" className="space-y-4">
                    <ConfigBackupSettings
                        initialSettings={configBackupSettings}
                        storageAdapters={filteredStorageAdapters}
                        encryptionProfiles={encryptionProfiles}
                    />
                </TabsContent>
            </Tabs>
        </div>
    );
}
