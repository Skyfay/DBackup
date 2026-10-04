-- CreateTable
CREATE TABLE "DeletedRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "detail" TEXT,
    "data" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "superAdminOnly" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedById" TEXT,
    "deletedByName" TEXT
);

-- CreateIndex
CREATE INDEX "DeletedRecord_kind_idx" ON "DeletedRecord"("kind");

-- CreateIndex
CREATE INDEX "DeletedRecord_deletedAt_idx" ON "DeletedRecord"("deletedAt");

