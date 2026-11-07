-- How many backups a day a customer may start of each database given to it, set by the platform.
-- A database or a rule without a number of its own follows it. It starts at none, so the databases
-- whose backups on demand were off stay off.
ALTER TABLE "Tenant" ADD COLUMN "onDemandPerDay" INTEGER;
