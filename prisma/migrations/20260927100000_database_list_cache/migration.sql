-- CreateTable
CREATE TABLE "DatabaseListCache" (
    "adapterConfigId" TEXT NOT NULL PRIMARY KEY,
    "databasesJson" TEXT NOT NULL DEFAULT '[]',
    "readAt" DATETIME,
    "error" TEXT,
    "attemptedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DatabaseListCache_adapterConfigId_fkey" FOREIGN KEY ("adapterConfigId") REFERENCES "AdapterConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
