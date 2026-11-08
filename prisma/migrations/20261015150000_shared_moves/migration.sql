-- A shared server keeps its assignments when its connection is deleted, so its customers keep the
-- backups of their time to download. The assignments and rules point at a SharedServer, which keeps
-- the name, the engine and the tenant of the server, instead of at the connection itself. A
-- database can move to another server, and a customer can start a backup of it on demand. See
-- src/services/tenant/shared-servers.ts, database-moves.ts and shared-on-demand.ts.

-- CreateTable
CREATE TABLE "SharedServer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "adapterId" TEXT NOT NULL,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenantId" TEXT NOT NULL
);

-- Every server whose databases were given to a customer so far.
INSERT INTO "SharedServer" ("id", "name", "adapterId", "tenantId")
SELECT a."id", a."name", a."adapterId", a."tenantId"
FROM "AdapterConfig" a
WHERE a."id" IN (SELECT "sourceId" FROM "DatabaseAssignment" UNION SELECT "sourceId" FROM "DatabaseAssignmentRule");

-- CreateTable
CREATE TABLE "SharedBackupRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT NOT NULL,
    "databaseName" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "requestedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenantId" TEXT NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DatabaseAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT NOT NULL,
    "databaseName" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "validFrom" DATETIME NOT NULL,
    "validUntil" DATETIME,
    "movedToSourceId" TEXT,
    "movedToDatabase" TEXT,
    "onDemandPerDay" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    CONSTRAINT "DatabaseAssignment_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "SharedServer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DatabaseAssignment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_DatabaseAssignment" ("createdAt", "createdById", "databaseName", "id", "sourceId", "tenantId", "validFrom", "validUntil") SELECT "createdAt", "createdById", "databaseName", "id", "sourceId", "tenantId", "validFrom", "validUntil" FROM "DatabaseAssignment";
DROP TABLE "DatabaseAssignment";
ALTER TABLE "new_DatabaseAssignment" RENAME TO "DatabaseAssignment";
CREATE INDEX "DatabaseAssignment_sourceId_databaseName_idx" ON "DatabaseAssignment"("sourceId", "databaseName");
CREATE INDEX "DatabaseAssignment_tenantId_idx" ON "DatabaseAssignment"("tenantId");
CREATE TABLE "new_DatabaseAssignmentRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "validFrom" DATETIME NOT NULL,
    "onDemandPerDay" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DatabaseAssignmentRule_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "SharedServer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DatabaseAssignmentRule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_DatabaseAssignmentRule" ("createdAt", "id", "pattern", "priority", "sourceId", "tenantId", "validFrom") SELECT "createdAt", "id", "pattern", "priority", "sourceId", "tenantId", "validFrom" FROM "DatabaseAssignmentRule";
DROP TABLE "DatabaseAssignmentRule";
ALTER TABLE "new_DatabaseAssignmentRule" RENAME TO "DatabaseAssignmentRule";
CREATE INDEX "DatabaseAssignmentRule_sourceId_idx" ON "DatabaseAssignmentRule"("sourceId");
CREATE INDEX "DatabaseAssignmentRule_tenantId_idx" ON "DatabaseAssignmentRule"("tenantId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "SharedServer_tenantId_idx" ON "SharedServer"("tenantId");

-- CreateIndex
CREATE INDEX "SharedBackupRequest_tenantId_sourceId_databaseName_createdAt_idx" ON "SharedBackupRequest"("tenantId", "sourceId", "databaseName", "createdAt");
