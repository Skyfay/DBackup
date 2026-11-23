-- Single databases of a shared server given to the customer they belong to. The tenant of the
-- server backs them up with all the others, the customer sees and restores the backups of its own
-- database. See src/services/tenant/database-assignments.ts.

-- CreateTable
CREATE TABLE "DatabaseAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT NOT NULL,
    "databaseName" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "validFrom" DATETIME NOT NULL,
    "validUntil" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    CONSTRAINT "DatabaseAssignment_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "AdapterConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DatabaseAssignment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DatabaseAssignmentRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "validFrom" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DatabaseAssignmentRule_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "AdapterConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DatabaseAssignmentRule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "DatabaseAssignment_sourceId_databaseName_idx" ON "DatabaseAssignment"("sourceId", "databaseName");

-- CreateIndex
CREATE INDEX "DatabaseAssignment_tenantId_idx" ON "DatabaseAssignment"("tenantId");

-- CreateIndex
CREATE INDEX "DatabaseAssignmentRule_sourceId_idx" ON "DatabaseAssignmentRule"("sourceId");

-- CreateIndex
CREATE INDEX "DatabaseAssignmentRule_tenantId_idx" ON "DatabaseAssignmentRule"("tenantId");
