import { auth } from "@/lib/auth";
import { STORAGE_ROLES } from "@/lib/core/storage-roles";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUserWithGroup, getUserPermissions } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { isEmailLoginDisabled } from "@/lib/auth/env-flags";
import prisma from "@/lib/prisma";
import { SystemSettingsForm } from "@/components/settings/system-settings-form";
import { STUCK_TIMEOUT_SETTING, DEFAULT_STUCK_TIMEOUT_MINUTES } from "@/services/system/stuck-execution-service";
import { SystemTasksSettings } from "@/components/settings/system-tasks-settings";
import { ConfigBackupSettings } from "@/components/settings/config-backup-settings";
import { NotificationSettings } from "@/components/settings/notification-settings";
import { RateLimitSettings } from "@/components/settings/rate-limit-settings";
import { CertificateSettings } from "@/components/settings/certificate-settings";
import { PrivacySettings } from "@/components/settings/privacy-settings";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getRateLimitConfig } from "@/lib/rate-limit/server";
import { DataRetentionCard } from "@/components/settings/data-retention-card";
import { DatabaseCard } from "@/components/settings/database-card";
import { getDataRetentionOverview } from "@/services/system/data-retention-service";
import { getDatabaseInfo } from "@/services/system/database-service";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";

const log = logger.child({ page: "settings" });

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
    const canManageSettings = permissions.includes(PERMISSIONS.SETTINGS.WRITE);
    const isSuperAdmin = (await getCurrentUserWithGroup())?.group?.name === "SuperAdmin";

    // Load Settings
    const maxJobsSetting = await prisma.systemSetting.findUnique({ where: { key: "maxConcurrentJobs" } });
    const maxConcurrentJobs = maxJobsSetting ? parseInt(maxJobsSetting.value) : 1;

    const stuckTimeoutSetting = await prisma.systemSetting.findUnique({ where: { key: STUCK_TIMEOUT_SETTING } });
    const parsedStuckTimeout = stuckTimeoutSetting ? parseInt(stuckTimeoutSetting.value, 10) : NaN;
    const stuckTimeoutMinutes = Number.isFinite(parsedStuckTimeout) && parsedStuckTimeout >= 0
        ? parsedStuckTimeout
        : DEFAULT_STUCK_TIMEOUT_MINUTES;


    const disablePasskeySetting = await prisma.systemSetting.findUnique({ where: { key: "auth.disablePasskeyLogin" } });
    const disablePasskeyLogin = disablePasskeySetting?.value === 'true';

    // Deployment-level switch, not a stored setting - surfaced read-only in the form.
    const emailLoginDisabledByEnv = isEmailLoginDisabled();

    const sessionDurationSetting = await prisma.systemSetting.findUnique({ where: { key: "auth.sessionDuration" } });
    const sessionDuration = sessionDurationSetting ? parseInt(sessionDurationSetting.value) : 604800;

    const checkUpdatesSetting = await prisma.systemSetting.findUnique({ where: { key: "general.checkForUpdates" } });
    const checkForUpdates = checkUpdatesSetting ? checkUpdatesSetting.value === 'true' : true;

    const quickSetupSetting = await prisma.systemSetting.findUnique({ where: { key: "general.showQuickSetup" } });
    const showQuickSetup = quickSetupSetting?.value === 'true';

    const timezoneSetting = await prisma.systemSetting.findUnique({ where: { key: "system.timezone" } });
    const systemTimezone = timezoneSetting?.value || "UTC";

    const patternSetting = await prisma.systemSetting.findUnique({ where: { key: "system.filenamePattern" } });
    const filenamePattern = patternSetting?.value || "{name}_yyyy-MM-dd_HH-mm-ss";

    const instanceNameSetting = await prisma.systemSetting.findUnique({ where: { key: "general.instanceName" } });
    const instanceName = instanceNameSetting?.value || "";

    const dataRetention = await getDataRetentionOverview();
    // Size figures come from the file system. A failure there should not take the whole page down.
    const databaseInfo = await getDatabaseInfo().catch((error: unknown) => {
        log.warn("Failed to read database info", {}, wrapError(error));
        return null;
    });

    // Load Config Backup Settings
    const configEnabled = await prisma.systemSetting.findUnique({ where: { key: "config.backup.enabled" } });
    const configSchedule = await prisma.systemSetting.findUnique({ where: { key: "config.backup.schedule" } });
    const configStorageId = await prisma.systemSetting.findUnique({ where: { key: "config.backup.storageId" } });
    const configProfileId = await prisma.systemSetting.findUnique({ where: { key: "config.backup.profileId" } });
    const configIncludeSecrets = await prisma.systemSetting.findUnique({ where: { key: "config.backup.includeSecrets" } });
    const configRetention = await prisma.systemSetting.findUnique({ where: { key: "config.backup.retention" } });
    const configIncludeStatistics = await prisma.systemSetting.findUnique({ where: { key: "config.backup.includeStatistics" } });

    // Load Options for Config Backup

    // The config backup is written somewhere, so only destinations qualify.
    const filteredStorageAdapters = await prisma.adapterConfig.findMany({
        where: { type: "storage", storageRole: STORAGE_ROLES.DESTINATION },
        select: { id: true, name: true }
    });

    const encryptionProfiles = await prisma.encryptionProfile.findMany({ select: { id: true, name: true }});

    const configBackupSettings = {
        enabled: configEnabled?.value === 'true',
        schedule: configSchedule?.value || "0 3 * * *",
        storageId: configStorageId?.value || "",
        profileId: configProfileId?.value || "",
        includeSecrets: configIncludeSecrets?.value === 'true',
        includeStatistics: configIncludeStatistics?.value === 'true',
        retention: configRetention ? parseInt(configRetention.value) : 10,
    };

    const integritySkipPassed = await prisma.systemSetting.findUnique({ where: { key: 'integrity.skipPassed' } });
    const integrityMaxAgeDays = await prisma.systemSetting.findUnique({ where: { key: 'integrity.maxAgeDays' } });
    const integrityMaxFileSizeMb = await prisma.systemSetting.findUnique({ where: { key: 'integrity.maxFileSizeMb' } });
    const integrityScanMode = await prisma.systemSetting.findUnique({ where: { key: 'integrity.scanMode' } });
    const integritySettings = {
        skipPassed: integritySkipPassed?.value === 'true',
        maxAgeDays: integrityMaxAgeDays ? parseInt(integrityMaxAgeDays.value) || 0 : 0,
        maxFileSizeMb: integrityMaxFileSizeMb ? parseInt(integrityMaxFileSizeMb.value) || 0 : 0,
        scanMode: (integrityScanMode?.value === 'destinations' ? 'destinations' : 'jobs') as 'jobs' | 'destinations',
    };

    // Load Rate Limit Settings
    const rateLimitConfig = await getRateLimitConfig();

    // Load Privacy Settings
    const includeActorSetting = await prisma.systemSetting.findUnique({ where: { key: "privacy.includeActorInMetadata" } });
    const includeActorInMetadata = includeActorSetting ? includeActorSetting.value === 'true' : true;


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
                    <TabsTrigger value="certificate">Certificate</TabsTrigger>
                    <TabsTrigger value="privacy">Privacy</TabsTrigger>
                </TabsList>
                <TabsContent value="general" className="space-y-4">
                    <SystemSettingsForm
                        initialMaxConcurrentJobs={maxConcurrentJobs}
                        initialStuckTimeoutMinutes={stuckTimeoutMinutes}
                        initialDisablePasskeyLogin={disablePasskeyLogin}
                        emailLoginDisabledByEnv={emailLoginDisabledByEnv}
                        initialSessionDuration={sessionDuration}
                        initialCheckForUpdates={checkForUpdates}
                        initialShowQuickSetup={showQuickSetup}
                        initialSystemTimezone={systemTimezone}
                        initialFilenamePattern={filenamePattern}
                        initialInstanceName={instanceName}
                    >
                        <DataRetentionCard
                            initialValues={dataRetention.values}
                            counts={dataRetention.counts}
                            canManage={canManageSettings}
                        />
                        <DatabaseCard
                            initialInfo={databaseInfo}
                            canManage={canManageSettings}
                            isSuperAdmin={isSuperAdmin}
                        />
                    </SystemSettingsForm>
                </TabsContent>
                <TabsContent value="notifications" className="space-y-4">
                    <NotificationSettings />
                </TabsContent>
                <TabsContent value="tasks" className="space-y-4">
                    <SystemTasksSettings initialIntegritySettings={integritySettings} />
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
                <TabsContent value="certificate" className="space-y-4">
                    <CertificateSettings />
                </TabsContent>
                <TabsContent value="privacy" className="space-y-4">
                    <PrivacySettings initialIncludeActorInMetadata={includeActorInMetadata} />
                </TabsContent>
            </Tabs>
        </div>
    );
}
