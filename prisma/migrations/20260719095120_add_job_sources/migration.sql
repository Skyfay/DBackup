-- CreateTable
CREATE TABLE "JobSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "path" TEXT NOT NULL,
    "excludePatterns" TEXT NOT NULL DEFAULT '[]',
    "useStagingCache" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "JobSource_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "JobSource_configId_fkey" FOREIGN KEY ("configId") REFERENCES "AdapterConfig" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
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
    "usableAsSource" BOOLEAN NOT NULL DEFAULT false,
    "usableAsDestination" BOOLEAN NOT NULL DEFAULT true,
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
    "sourceId" TEXT,
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
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "JobSource_jobId_configId_path_key" ON "JobSource"("jobId", "configId", "path");
