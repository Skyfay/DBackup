-- More than one tenant can give the databases of its servers to customers. The platform marks the
-- tenants of the MSP that do, the home tenant from the start, as it was the only one so far. See
-- src/services/tenant/shared-servers.ts.

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "sharesDatabases" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Tenant" SET "sharesDatabases" = true WHERE "id" = 'default';
