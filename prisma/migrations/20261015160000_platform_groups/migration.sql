-- Groups of the platform, for the people of the MSP: rights on the instance itself, and rights in
-- the tenants of their scope on top of the group someone holds there. Platform admin stays
-- User.platformRole, which the pages show as the built-in platform group.
CREATE TABLE "PlatformGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "platformPermissions" TEXT NOT NULL DEFAULT '[]',
    "tenantPermissions" TEXT NOT NULL DEFAULT '[]',
    "allTenants" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "PlatformGroup_name_key" ON "PlatformGroup"("name");

-- The tenants of a platform group that does not cover every tenant.
CREATE TABLE "PlatformGroupTenant" (
    "groupId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,

    PRIMARY KEY ("groupId", "tenantId"),
    CONSTRAINT "PlatformGroupTenant_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "PlatformGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlatformGroupTenant_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "PlatformGroupTenant_tenantId_idx" ON "PlatformGroupTenant"("tenantId");

-- The platform group of an account, none for everyone today.
ALTER TABLE "User" ADD COLUMN "platformGroupId" TEXT REFERENCES "PlatformGroup" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "User_platformGroupId_idx" ON "User"("platformGroupId");
