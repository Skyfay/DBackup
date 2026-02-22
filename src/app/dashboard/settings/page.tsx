import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getUserPermissions } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";
import prisma from "@/lib/prisma";
import { SystemSettingsForm } from "@/components/settings/system-settings-form";
import { SystemTasksSettings } from "@/components/settings/system-tasks-settings";
import { ConfigBackupSettings } from "@/components/settings/config-backup-settings";
import { NotificationSettings } from "@/components/settings/notification-settings";
import { RateLimitSettings } from "@/components/settings/rate-limit-settings";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getRateLimitConfig } from "@/lib/rate-limit";

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

    const snapshotRetentionSetting = await prisma.systemSetting.findUnique({ where: { key: "storage.snapshotRetentionDays" } });
    const storageSnapshotRetentionDays = snapshotRetentionSetting ? parseInt(snapshotRetentionSetting.value) : 90;

    const checkUpdatesSetting = await prisma.systemSetting.findUnique({ where: { key: "general.checkForUpdates" } });
    const checkForUpdates = checkUpdatesSetting ? checkUpdatesSetting.value === 'true' : true;

    const quickSetupSetting = await prisma.systemSetting.findUnique({ where: { key: "general.showQuickSetup" } });
    const showQuickSetup = quickSetupSetting?.value === 'true';

    // Load Config Backup Settings
    const configEnabled = await prisma.systemSetting.findUnique({ where: { key: "config.backup.enabled" } });
    const configSchedule = await prisma.systemSetting.findUnique({ where: { key: "config.backup.schedule" } });
    const configStorageId = await prisma.systemSetting.findUnique({ where: { key: "config.backup.storageId" } });
    const configProfileId = await prisma.systemSetting.findUnique({ where: { key: "config.backup.profileId" } });
    const configIncludeSecrets = await prisma.systemSetting.findUnique({ where: { key: "config.backup.includeSecrets" } });
    const configRetention = await prisma.systemSetting.findUnique({ where: { key: "config.backup.retention" } });

    // Load Options for Config Backup

    // Correct approach: Fetch where type is 'storage'
    const filteredStorageAdapters = await prisma.adapterConfig.findMany({
        where: { type: "storage" },
        select: { id: true, name: true }
    });

    const encryptionProfiles = await prisma.encryptionProfile.findMany({ select: { id: true, name: true }});

    const configBackupSettings = {
        enabled: configEnabled?.value === 'true',
        schedule: configSchedule?.value || "0 3 * * *",
        storageId: configStorageId?.value || "",
        profileId: configProfileId?.value || "",
        includeSecrets: configIncludeSecrets?.value === 'true',
        retention: configRetention ? parseInt(configRetention.value) : 10,
    };

    // Load Rate Limit Settings
    const rateLimitConfig = await getRateLimitConfig();


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
                    <TabsTrigger value="notifications">Notifications</TabsTrigger>
                    <TabsTrigger value="tasks">System Tasks</TabsTrigger>
                    <TabsTrigger value="config">Configuration Backup</TabsTrigger>
                    <TabsTrigger value="ratelimits">Rate Limits</TabsTrigger>
                </TabsList>
                <TabsContent value="general" className="space-y-4">
                    <SystemSettingsForm
                        initialMaxConcurrentJobs={maxConcurrentJobs}
                        initialDisablePasskeyLogin={disablePasskeyLogin}
                        initialAuditLogRetentionDays={auditLogRetentionDays}
                        initialStorageSnapshotRetentionDays={storageSnapshotRetentionDays}
                        initialCheckForUpdates={checkForUpdates}
                        initialShowQuickSetup={showQuickSetup}
                    />
                </TabsContent>
                <TabsContent value="notifications" className="space-y-4">
                    <NotificationSettings />
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
                <TabsContent value="ratelimits" className="space-y-4">
                    <RateLimitSettings initialConfig={rateLimitConfig} />
                </TabsContent>
            </Tabs>
        </div>
    );
}
