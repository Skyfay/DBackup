-- Who held a shared database at a time stays known for good. An assignment and a rule no longer
-- belong to their customer by a relation that deletes them with the tenant: the id of a deleted
-- tenant stays, so the backups of its time stay with nobody instead of falling to whoever another
-- rule names. A null tenant on an assignment means the server's tenant took the database back, and
-- a removed rule ends with validUntil instead of disappearing. See src/lib/tenant/database-owner.ts.

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DatabaseAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT NOT NULL,
    "databaseName" TEXT NOT NULL,
    "tenantId" TEXT,
    "validFrom" DATETIME NOT NULL,
    "validUntil" DATETIME,
    "movedToSourceId" TEXT,
    "movedToDatabase" TEXT,
    "onDemandPerDay" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    CONSTRAINT "DatabaseAssignment_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "SharedServer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_DatabaseAssignment" ("createdAt", "createdById", "databaseName", "id", "movedToDatabase", "movedToSourceId", "onDemandPerDay", "sourceId", "tenantId", "validFrom", "validUntil") SELECT "createdAt", "createdById", "databaseName", "id", "movedToDatabase", "movedToSourceId", "onDemandPerDay", "sourceId", "tenantId", "validFrom", "validUntil" FROM "DatabaseAssignment";
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
    "validUntil" DATETIME,
    "onDemandPerDay" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DatabaseAssignmentRule_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "SharedServer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_DatabaseAssignmentRule" ("createdAt", "id", "onDemandPerDay", "pattern", "priority", "sourceId", "tenantId", "validFrom") SELECT "createdAt", "id", "onDemandPerDay", "pattern", "priority", "sourceId", "tenantId", "validFrom" FROM "DatabaseAssignmentRule";
DROP TABLE "DatabaseAssignmentRule";
ALTER TABLE "new_DatabaseAssignmentRule" RENAME TO "DatabaseAssignmentRule";
CREATE INDEX "DatabaseAssignmentRule_sourceId_idx" ON "DatabaseAssignmentRule"("sourceId");
CREATE INDEX "DatabaseAssignmentRule_tenantId_idx" ON "DatabaseAssignmentRule"("tenantId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
