-- CreateTable
CREATE TABLE "NotificationTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "NotificationTemplateChannel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "templateId" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "events" TEXT NOT NULL DEFAULT 'SUCCESS|PARTIAL|FAILED',
    CONSTRAINT "NotificationTemplateChannel_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "NotificationTemplate" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "NotificationTemplateChannel_configId_fkey" FOREIGN KEY ("configId") REFERENCES "AdapterConfig" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JobNotificationTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "JobNotificationTemplate_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "JobNotificationTemplate_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "NotificationTemplate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AdapterConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "adapterId" TEXT NOT NULL,
    "config" TEXT NOT NULL,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "primaryCredentialId" TEXT,
    "sshCredentialId" TEXT,
    "defaultRetentionPolicyId" TEXT,
    "lastHealthCheck" DATETIME,
    "lastStatus" TEXT NOT NULL DEFAULT 'ONLINE',
    "lastError" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "AdapterConfig_primaryCredentialId_fkey" FOREIGN KEY ("primaryCredentialId") REFERENCES "CredentialProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AdapterConfig_sshCredentialId_fkey" FOREIGN KEY ("sshCredentialId") REFERENCES "CredentialProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AdapterConfig_defaultRetentionPolicyId_fkey" FOREIGN KEY ("defaultRetentionPolicyId") REFERENCES "RetentionPolicy" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_AdapterConfig" ("adapterId", "config", "consecutiveFailures", "createdAt", "defaultRetentionPolicyId", "id", "lastError", "lastHealthCheck", "lastStatus", "metadata", "name", "primaryCredentialId", "sshCredentialId", "type", "updatedAt") SELECT "adapterId", "config", "consecutiveFailures", "createdAt", "defaultRetentionPolicyId", "id", "lastError", "lastHealthCheck", "lastStatus", "metadata", "name", "primaryCredentialId", "sshCredentialId", "type", "updatedAt" FROM "AdapterConfig";
DROP TABLE "AdapterConfig";
ALTER TABLE "new_AdapterConfig" RENAME TO "AdapterConfig";
CREATE TABLE "new_Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "schedule" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sourceId" TEXT NOT NULL,
    "databases" TEXT NOT NULL DEFAULT '[]',
    "encryptionProfileId" TEXT,
    "compression" TEXT NOT NULL DEFAULT 'NONE',
    "pgCompression" TEXT NOT NULL DEFAULT '',
    "namingTemplateId" TEXT,
    "schedulePresetId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "notificationEvents" TEXT NOT NULL DEFAULT 'ALWAYS',
    "skipVerification" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Job_encryptionProfileId_fkey" FOREIGN KEY ("encryptionProfileId") REFERENCES "EncryptionProfile" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Job_namingTemplateId_fkey" FOREIGN KEY ("namingTemplateId") REFERENCES "NamingTemplate" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Job_schedulePresetId_fkey" FOREIGN KEY ("schedulePresetId") REFERENCES "SchedulePreset" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Job_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "AdapterConfig" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Job" ("compression", "createdAt", "databases", "enabled", "encryptionProfileId", "id", "name", "namingTemplateId", "notificationEvents", "pgCompression", "schedule", "schedulePresetId", "skipVerification", "sourceId", "updatedAt") SELECT "compression", "createdAt", "databases", "enabled", "encryptionProfileId", "id", "name", "namingTemplateId", "notificationEvents", "pgCompression", "schedule", "schedulePresetId", "skipVerification", "sourceId", "updatedAt" FROM "Job";
DROP TABLE "Job";
ALTER TABLE "new_Job" RENAME TO "Job";
CREATE TABLE "new_JobDestination" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "retention" TEXT NOT NULL DEFAULT '{}',
    "retentionPolicyId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "JobDestination_retentionPolicyId_fkey" FOREIGN KEY ("retentionPolicyId") REFERENCES "RetentionPolicy" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "JobDestination_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "JobDestination_configId_fkey" FOREIGN KEY ("configId") REFERENCES "AdapterConfig" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_JobDestination" ("configId", "createdAt", "id", "jobId", "priority", "retention", "retentionPolicyId", "updatedAt") SELECT "configId", "createdAt", "id", "jobId", "priority", "retention", "retentionPolicyId", "updatedAt" FROM "JobDestination";
DROP TABLE "JobDestination";
ALTER TABLE "new_JobDestination" RENAME TO "JobDestination";
CREATE UNIQUE INDEX "JobDestination_jobId_configId_key" ON "JobDestination"("jobId", "configId");
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL,
    "image" TEXT,
    "timezone" TEXT NOT NULL DEFAULT '',
    "dateFormat" TEXT NOT NULL DEFAULT 'P',
    "timeFormat" TEXT NOT NULL DEFAULT 'p',
    "autoRedirectOnJobStart" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    "twoFactorEnabled" BOOLEAN,
    "passkeyTwoFactor" BOOLEAN DEFAULT false,
    "groupId" TEXT,
    CONSTRAINT "User_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_User" ("autoRedirectOnJobStart", "createdAt", "dateFormat", "email", "emailVerified", "groupId", "id", "image", "name", "passkeyTwoFactor", "timeFormat", "timezone", "twoFactorEnabled", "updatedAt") SELECT "autoRedirectOnJobStart", "createdAt", "dateFormat", "email", "emailVerified", "groupId", "id", "image", "name", "passkeyTwoFactor", "timeFormat", "timezone", "twoFactorEnabled", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "NotificationTemplate_name_key" ON "NotificationTemplate"("name");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationTemplateChannel_templateId_configId_key" ON "NotificationTemplateChannel"("templateId", "configId");

-- CreateIndex
CREATE UNIQUE INDEX "JobNotificationTemplate_jobId_templateId_key" ON "JobNotificationTemplate"("jobId", "templateId");
