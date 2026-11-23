-- The platform also decides whether a tenant makes API keys itself. The keys it has keep working.
ALTER TABLE "Tenant" ADD COLUMN "addsApiKeys" BOOLEAN NOT NULL DEFAULT true;
