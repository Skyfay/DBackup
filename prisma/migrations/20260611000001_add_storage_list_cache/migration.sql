-- CreateTable
CREATE TABLE "StorageListCache" (
    "adapterConfigId" TEXT NOT NULL PRIMARY KEY,
    "filesJson" TEXT NOT NULL,
    "cachedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StorageListCache_adapterConfigId_fkey" FOREIGN KEY ("adapterConfigId") REFERENCES "AdapterConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
