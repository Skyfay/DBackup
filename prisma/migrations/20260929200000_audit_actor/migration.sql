-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN "actorName" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "apiKeyId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "apiKeyName" TEXT;

-- Entries of people who still exist get their name now. Those of deleted people lost it already.
UPDATE "AuditLog" SET "actorName" = (SELECT "name" FROM "User" WHERE "User"."id" = "AuditLog"."userId") WHERE "userId" IS NOT NULL;

-- The JSON is only read where it is valid, CASE keeps json_extract away from anything else.
-- A job run started with an API key named the key in its details.
UPDATE "AuditLog" SET "apiKeyId" = CASE WHEN json_valid("details") THEN json_extract("details", '$.apiKeyId') END
WHERE "details" LIKE '%"apiKeyId"%';
UPDATE "AuditLog" SET "apiKeyName" = (SELECT "name" FROM "ApiKey" WHERE "ApiKey"."id" = "AuditLog"."apiKeyId") WHERE "apiKeyId" IS NOT NULL;

-- Restoring files was written as a run, it is a restore.
UPDATE "AuditLog" SET "action" = 'RESTORE'
WHERE "action" = 'EXECUTE' AND "details" LIKE '%file_restore%'
  AND (CASE WHEN json_valid("details") THEN json_extract("details", '$.action') END) = 'file_restore';

-- Encryption keys were written as system entries, they belong to the Vault.
UPDATE "AuditLog" SET "resource" = 'VAULT'
WHERE "resource" = 'SYSTEM' AND "details" LIKE '%EncryptionProfile%'
  AND (CASE WHEN json_valid("details") THEN json_extract("details", '$.type') END) = 'EncryptionProfile';

-- Every entry about a destination was about the backups at it.
UPDATE "AuditLog" SET "resource" = 'BACKUP' WHERE "resource" = 'DESTINATION';

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");
