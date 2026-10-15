-- Tenants: every connection, job, key, run and template belongs to one tenant, and people work in
-- a tenant through a membership with a role. An installation of an earlier version becomes the
-- tenant "default" with everything it holds, and nothing changes for it until a second tenant
-- exists. See src/lib/tenant/.
--
-- The tenant column is added in place rather than by copying each table, which Prisma would do,
-- so a large history is not rewritten. Only User is copied, to drop its group.

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TenantMembership" (
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("userId", "tenantId"),
    CONSTRAINT "TenantMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TenantMembership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TenantMembership_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TenantInvitation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "acceptedAt" DATETIME,
    "acceptedById" TEXT,
    CONSTRAINT "TenantInvitation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TenantInvitation_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- AlterTable
ALTER TABLE "Session" ADD COLUMN "activeTenantId" TEXT;
ALTER TABLE "Group" ADD COLUMN "fullAccess" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AdapterConfig" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "CredentialProfile" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "EncryptionProfile" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "RetentionPolicy" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "NamingTemplate" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "SchedulePreset" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "ExcludePatternPreset" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "Job" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "NotificationTemplate" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "Execution" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "AuditLog" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "ApiKey" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "StorageSnapshot" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "NotificationLog" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "DeletedRecord" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default';

-- The tenant every installation starts with, and everyone with a group as its member in that group.
INSERT INTO "Tenant" ("id", "name", "createdAt", "updatedAt") VALUES ('default', 'Default', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "TenantMembership" ("userId", "tenantId", "groupId", "createdAt")
    SELECT "id", 'default', "groupId", CURRENT_TIMESTAMP FROM "User" WHERE "groupId" IS NOT NULL;

-- The SuperAdmin group becomes the role Admin with every permission of a tenant. Its members become
-- platform admins below. A group already named Admin keeps its name.
UPDATE "Group" SET "fullAccess" = true WHERE "name" = 'SuperAdmin';
UPDATE "Group" SET "name" = 'Admin' WHERE "name" = 'SuperAdmin' AND NOT EXISTS (SELECT 1 FROM "Group" WHERE "name" = 'Admin');
UPDATE "Group" SET "name" = 'Admin (was SuperAdmin)' WHERE "name" = 'SuperAdmin';

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "platformRole" TEXT
);
INSERT INTO "new_User" ("autoRedirectOnJobStart", "createdAt", "dateFormat", "email", "emailVerified", "id", "image", "name", "passkeyTwoFactor", "timeFormat", "timezone", "twoFactorEnabled", "updatedAt", "platformRole")
    SELECT "autoRedirectOnJobStart", "createdAt", "dateFormat", "email", "emailVerified", "id", "image", "name", "passkeyTwoFactor", "timeFormat", "timezone", "twoFactorEnabled", "updatedAt",
        CASE WHEN "groupId" IN (SELECT "id" FROM "Group" WHERE "fullAccess") THEN 'ADMIN' ELSE NULL END
    FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- A name is unique within its tenant, so every customer can have a template called Daily.
DROP INDEX "CredentialProfile_name_key";
CREATE UNIQUE INDEX "CredentialProfile_tenantId_name_key" ON "CredentialProfile"("tenantId", "name");
DROP INDEX "RetentionPolicy_name_key";
CREATE UNIQUE INDEX "RetentionPolicy_tenantId_name_key" ON "RetentionPolicy"("tenantId", "name");
DROP INDEX "NamingTemplate_name_key";
CREATE UNIQUE INDEX "NamingTemplate_tenantId_name_key" ON "NamingTemplate"("tenantId", "name");
DROP INDEX "SchedulePreset_name_key";
CREATE UNIQUE INDEX "SchedulePreset_tenantId_name_key" ON "SchedulePreset"("tenantId", "name");
DROP INDEX "ExcludePatternPreset_name_key";
CREATE UNIQUE INDEX "ExcludePatternPreset_tenantId_name_key" ON "ExcludePatternPreset"("tenantId", "name");
DROP INDEX "NotificationTemplate_name_key";
CREATE UNIQUE INDEX "NotificationTemplate_tenantId_name_key" ON "NotificationTemplate"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_name_key" ON "Tenant"("name");
CREATE INDEX "TenantMembership_tenantId_idx" ON "TenantMembership"("tenantId");
CREATE INDEX "TenantMembership_groupId_idx" ON "TenantMembership"("groupId");
CREATE UNIQUE INDEX "TenantInvitation_tokenHash_key" ON "TenantInvitation"("tokenHash");
CREATE INDEX "TenantInvitation_tenantId_idx" ON "TenantInvitation"("tenantId");
CREATE INDEX "AdapterConfig_tenantId_idx" ON "AdapterConfig"("tenantId");
CREATE INDEX "EncryptionProfile_tenantId_idx" ON "EncryptionProfile"("tenantId");
CREATE INDEX "Job_tenantId_idx" ON "Job"("tenantId");
CREATE INDEX "ApiKey_tenantId_idx" ON "ApiKey"("tenantId");
CREATE INDEX "StorageSnapshot_tenantId_idx" ON "StorageSnapshot"("tenantId");
CREATE INDEX "DeletedRecord_tenantId_idx" ON "DeletedRecord"("tenantId");
CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");
CREATE INDEX "NotificationLog_tenantId_sentAt_idx" ON "NotificationLog"("tenantId", "sentAt");
CREATE INDEX "Execution_tenantId_startedAt_idx" ON "Execution"("tenantId", "startedAt");
CREATE INDEX "Execution_tenantId_status_startedAt_idx" ON "Execution"("tenantId", "status", "startedAt");
CREATE INDEX "Execution_tenantId_type_startedAt_idx" ON "Execution"("tenantId", "type", "startedAt");
CREATE INDEX "Execution_tenantId_triggerType_triggerLabel_idx" ON "Execution"("tenantId", "triggerType", "triggerLabel");
