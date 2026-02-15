-- CreateTable
CREATE TABLE "StorageSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "adapterConfigId" TEXT NOT NULL,
    "adapterName" TEXT NOT NULL,
    "adapterId" TEXT NOT NULL,
    "size" BIGINT NOT NULL DEFAULT 0,
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "StorageSnapshot_adapterConfigId_idx" ON "StorageSnapshot"("adapterConfigId");

-- CreateIndex
CREATE INDEX "StorageSnapshot_createdAt_idx" ON "StorageSnapshot"("createdAt");
