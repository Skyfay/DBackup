-- Groups belong to a tenant, whose admins make and change them. Every group of an earlier version
-- belongs to the home tenant.
ALTER TABLE "Group" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default';
DROP INDEX "Group_name_key";
CREATE UNIQUE INDEX "Group_tenantId_name_key" ON "Group"("tenantId", "name");
CREATE INDEX "Group_tenantId_idx" ON "Group"("tenantId");

-- A membership or an invitation of another tenant that names a group of the home tenant gets a
-- copy of that group in its own tenant, with the same name and permissions.
INSERT INTO "Group" ("id", "name", "permissions", "fullAccess", "createdAt", "updatedAt", "tenantId")
SELECT DISTINCT g."id" || '-' || used."tenantId", g."name", g."permissions", g."fullAccess", g."createdAt", CURRENT_TIMESTAMP, used."tenantId"
FROM (
    SELECT "tenantId", "groupId" FROM "TenantMembership"
    UNION
    SELECT "tenantId", "groupId" FROM "TenantInvitation"
) used
JOIN "Group" g ON g."id" = used."groupId"
WHERE g."tenantId" <> used."tenantId";

UPDATE "TenantMembership"
SET "groupId" = "groupId" || '-' || "tenantId"
WHERE "tenantId" <> (SELECT g."tenantId" FROM "Group" g WHERE g."id" = "TenantMembership"."groupId");

UPDATE "TenantInvitation"
SET "groupId" = "groupId" || '-' || "tenantId"
WHERE "tenantId" <> (SELECT g."tenantId" FROM "Group" g WHERE g."id" = "TenantInvitation"."groupId");

-- Every tenant has its group with every permission. The permission sync fills its list.
INSERT INTO "Group" ("id", "name", "permissions", "fullAccess", "createdAt", "updatedAt", "tenantId")
SELECT 'admin-' || t."id", 'Admin', '[]', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, t."id"
FROM "Tenant" t
WHERE NOT EXISTS (SELECT 1 FROM "Group" g WHERE g."tenantId" = t."id" AND g."fullAccess" = 1)
  AND NOT EXISTS (SELECT 1 FROM "Group" g WHERE g."tenantId" = t."id" AND g."name" = 'Admin');

-- The settings of a tenant and its Recently deleted have rights of their own now. A group that
-- could see or change the settings keeps seeing and changing what moved to the tenant settings.
UPDATE "Group" SET "permissions" = json_insert("permissions", '$[#]', 'tenant-settings:read')
WHERE json_valid("permissions")
  AND EXISTS (SELECT 1 FROM json_each("Group"."permissions") WHERE value = 'settings:read')
  AND NOT EXISTS (SELECT 1 FROM json_each("Group"."permissions") WHERE value = 'tenant-settings:read');
UPDATE "Group" SET "permissions" = json_insert("permissions", '$[#]', 'tenant-settings:write')
WHERE json_valid("permissions")
  AND EXISTS (SELECT 1 FROM json_each("Group"."permissions") WHERE value = 'settings:write')
  AND NOT EXISTS (SELECT 1 FROM json_each("Group"."permissions") WHERE value = 'tenant-settings:write');

-- The logo of a tenant.
CREATE TABLE "TenantLogo" (
    "tenantId" TEXT NOT NULL PRIMARY KEY,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BLOB NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TenantLogo_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- A sign-in provider a tenant brings, null for one of the platform.
ALTER TABLE "SsoProvider" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "SsoProvider_tenantId_idx" ON "SsoProvider"("tenantId");
