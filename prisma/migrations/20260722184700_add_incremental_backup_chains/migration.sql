-- AlterTable
ALTER TABLE "Execution" ADD COLUMN "backupType" TEXT;
ALTER TABLE "Execution" ADD COLUMN "baseArchive" TEXT;
ALTER TABLE "Execution" ADD COLUMN "chainId" TEXT;
ALTER TABLE "Execution" ADD COLUMN "chainIndex" INTEGER;
ALTER TABLE "Execution" ADD COLUMN "logicalSize" BIGINT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "backupMode" TEXT NOT NULL DEFAULT 'FULL',
    "fullEveryDays" INTEGER NOT NULL DEFAULT 7,
    "verifyByHash" BOOLEAN NOT NULL DEFAULT false,
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
