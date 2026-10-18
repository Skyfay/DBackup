-- The platform decides whether the connections of a tenant reach the local network of the server
-- DBackup runs on, and which ranges it reaches anyway. A new tenant starts blocked. The tenants made
-- before keep reaching what they reach, so nothing that runs today stops with the update.
ALTER TABLE "Tenant" ADD COLUMN "blocksLocalNetwork" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Tenant" ADD COLUMN "allowedNetworks" TEXT NOT NULL DEFAULT '[]';
UPDATE "Tenant" SET "blocksLocalNetwork" = false;
