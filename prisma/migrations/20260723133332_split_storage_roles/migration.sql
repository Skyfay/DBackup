-- Replaces the two independent role flags (usableAsSource / usableAsDestination) with a
-- single exclusive role. A destination writes into its configured root and creates folders
-- there; a source reads selected folders out of that same root. One config cannot be both
-- without a job eventually backing up its own archives.

-- Adapters that carried both roles have to be resolved before the columns disappear. The
-- destination usage keeps the original row (jobs reference it by id) and the source usage
-- moves to a twin, so neither side of an existing job breaks. randomblob() stands in for
-- uuid(): the column only has to be unique.
CREATE TABLE "_storage_role_migration" (
    "originalId" TEXT NOT NULL,
    "twinId" TEXT NOT NULL
);

INSERT INTO "_storage_role_migration" ("originalId", "twinId")
SELECT a."id", lower(hex(randomblob(16)))
FROM "AdapterConfig" a
WHERE a."type" = 'storage'
  AND a."usableAsSource" = 1
  AND a."usableAsDestination" = 1
  AND EXISTS (SELECT 1 FROM "JobSource" js WHERE js."configId" = a."id")
  AND EXISTS (SELECT 1 FROM "JobDestination" jd WHERE jd."configId" = a."id");

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
    "storageRole" TEXT NOT NULL DEFAULT 'DESTINATION',
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
-- Source-only rows become SOURCE. Everything else becomes DESTINATION: database and
-- notification adapters (where the column is meaningless), every storage adapter that
-- predates the role flags, and the dual-role rows whose destination usage stays here.
INSERT INTO "new_AdapterConfig" ("adapterId", "config", "consecutiveFailures", "createdAt", "defaultRetentionPolicyId", "id", "lastError", "lastHealthCheck", "lastStatus", "metadata", "name", "primaryCredentialId", "sshCredentialId", "storageRole", "type", "updatedAt")
SELECT "adapterId", "config", "consecutiveFailures", "createdAt", "defaultRetentionPolicyId", "id", "lastError", "lastHealthCheck", "lastStatus", "metadata", "name", "primaryCredentialId", "sshCredentialId",
    CASE
        WHEN "type" <> 'storage' THEN 'DESTINATION'
        WHEN "usableAsSource" = 1 AND "usableAsDestination" = 0 THEN 'SOURCE'
        WHEN "usableAsSource" = 1
             AND EXISTS (SELECT 1 FROM "JobSource" js WHERE js."configId" = "AdapterConfig"."id")
             AND NOT EXISTS (SELECT 1 FROM "JobDestination" jd WHERE jd."configId" = "AdapterConfig"."id")
        THEN 'SOURCE'
        ELSE 'DESTINATION'
    END,
    "type", "updatedAt"
FROM "AdapterConfig";
DROP TABLE "AdapterConfig";
ALTER TABLE "new_AdapterConfig" RENAME TO "AdapterConfig";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Materialise the twins for the dual-role rows recorded above, then move every directory
-- source reference over to them. Health state is deliberately not copied: the twin is a
-- new adapter and gets its own first check.
INSERT INTO "AdapterConfig" ("id", "name", "type", "adapterId", "config", "metadata", "createdAt", "updatedAt", "storageRole", "primaryCredentialId", "sshCredentialId", "lastStatus", "consecutiveFailures")
SELECT m."twinId", a."name" || ' (Source)', a."type", a."adapterId", a."config", a."metadata", a."createdAt", a."updatedAt", 'SOURCE', a."primaryCredentialId", a."sshCredentialId", 'ONLINE', 0
FROM "AdapterConfig" a
JOIN "_storage_role_migration" m ON m."originalId" = a."id";

UPDATE "JobSource"
SET "configId" = (SELECT m."twinId" FROM "_storage_role_migration" m WHERE m."originalId" = "JobSource"."configId")
WHERE "configId" IN (SELECT "originalId" FROM "_storage_role_migration");

DROP TABLE "_storage_role_migration";
