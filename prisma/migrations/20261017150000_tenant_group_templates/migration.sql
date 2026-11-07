-- Groups the platform makes once for tenants. Each tenant one reaches gets a Group linked to it, which
-- follows its name and permissions, see src/services/user/tenant-group-templates.ts.
-- CreateTable
CREATE TABLE "TenantGroupTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "permissions" TEXT NOT NULL DEFAULT '[]',
    "allTenants" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TenantGroupTemplateTenant" (
    "templateId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,

    PRIMARY KEY ("templateId", "tenantId"),
    CONSTRAINT "TenantGroupTemplateTenant_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "TenantGroupTemplate" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TenantGroupTemplateTenant_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Group" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "permissions" TEXT NOT NULL,
    "fullAccess" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "templateId" TEXT,
    CONSTRAINT "Group_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "TenantGroupTemplate" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Group" ("createdAt", "fullAccess", "id", "name", "permissions", "tenantId", "updatedAt") SELECT "createdAt", "fullAccess", "id", "name", "permissions", "tenantId", "updatedAt" FROM "Group";
DROP TABLE "Group";
ALTER TABLE "new_Group" RENAME TO "Group";
CREATE INDEX "Group_tenantId_idx" ON "Group"("tenantId");
CREATE UNIQUE INDEX "Group_tenantId_name_key" ON "Group"("tenantId", "name");
CREATE UNIQUE INDEX "Group_tenantId_templateId_key" ON "Group"("tenantId", "templateId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "TenantGroupTemplate_name_key" ON "TenantGroupTemplate"("name");

-- CreateIndex
CREATE INDEX "TenantGroupTemplateTenant_tenantId_idx" ON "TenantGroupTemplateTenant"("tenantId");
