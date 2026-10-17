-- A tenant of the MSP shares destinations and notification channels too, so the switch that let it
-- share databases now covers all of it. The platform also decides what a tenant adds itself.
ALTER TABLE "Tenant" RENAME COLUMN "sharesDatabases" TO "sharesWithCustomers";
ALTER TABLE "Tenant" ADD COLUMN "addsDatabases" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Tenant" ADD COLUMN "addsDirectorySources" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Tenant" ADD COLUMN "addsDestinations" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Tenant" ADD COLUMN "addsChannels" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "ConnectionShare" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "allTenants" BOOLEAN NOT NULL DEFAULT false,
    "encryptedOnly" BOOLEAN NOT NULL DEFAULT false,
    "ownRecipients" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "tenantId" TEXT NOT NULL,
    CONSTRAINT "ConnectionShare_id_fkey" FOREIGN KEY ("id") REFERENCES "AdapterConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ConnectionShareTenant" (
    "shareId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("shareId", "tenantId"),
    CONSTRAINT "ConnectionShareTenant_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "ConnectionShare" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChannelRecipients" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "configId" TEXT NOT NULL,
    "recipients" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    "tenantId" TEXT NOT NULL,
    CONSTRAINT "ChannelRecipients_configId_fkey" FOREIGN KEY ("configId") REFERENCES "AdapterConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- The listing of a destination is kept per tenant, since a shared destination holds the backups of
-- several. The listings so far are the ones of the tenant of their destination.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_StorageListCache" (
    "adapterConfigId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "filesJson" TEXT NOT NULL,
    "cachedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("adapterConfigId", "tenantId"),
    CONSTRAINT "StorageListCache_adapterConfigId_fkey" FOREIGN KEY ("adapterConfigId") REFERENCES "AdapterConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_StorageListCache" ("adapterConfigId", "tenantId", "filesJson", "cachedAt")
    SELECT "cache"."adapterConfigId", "config"."tenantId", "cache"."filesJson", "cache"."cachedAt"
    FROM "StorageListCache" AS "cache" JOIN "AdapterConfig" AS "config" ON "config"."id" = "cache"."adapterConfigId";
DROP TABLE "StorageListCache";
ALTER TABLE "new_StorageListCache" RENAME TO "StorageListCache";
CREATE INDEX "StorageListCache_tenantId_idx" ON "StorageListCache"("tenantId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ConnectionShare_tenantId_idx" ON "ConnectionShare"("tenantId");

-- CreateIndex
CREATE INDEX "ConnectionShareTenant_tenantId_idx" ON "ConnectionShareTenant"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelRecipients_tenantId_configId_key" ON "ChannelRecipients"("tenantId", "configId");
