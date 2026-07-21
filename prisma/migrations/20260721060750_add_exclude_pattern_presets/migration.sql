-- CreateTable
CREATE TABLE "ExcludePatternPreset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "patterns" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_JobSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "path" TEXT NOT NULL,
    "excludePatterns" TEXT NOT NULL DEFAULT '[]',
    "excludePatternPresetId" TEXT,
    "useStagingCache" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "JobSource_excludePatternPresetId_fkey" FOREIGN KEY ("excludePatternPresetId") REFERENCES "ExcludePatternPreset" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "JobSource_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "JobSource_configId_fkey" FOREIGN KEY ("configId") REFERENCES "AdapterConfig" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_JobSource" ("configId", "createdAt", "excludePatterns", "id", "jobId", "path", "priority", "updatedAt", "useStagingCache") SELECT "configId", "createdAt", "excludePatterns", "id", "jobId", "path", "priority", "updatedAt", "useStagingCache" FROM "JobSource";
DROP TABLE "JobSource";
ALTER TABLE "new_JobSource" RENAME TO "JobSource";
CREATE UNIQUE INDEX "JobSource_jobId_configId_path_key" ON "JobSource"("jobId", "configId", "path");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ExcludePatternPreset_name_key" ON "ExcludePatternPreset"("name");
