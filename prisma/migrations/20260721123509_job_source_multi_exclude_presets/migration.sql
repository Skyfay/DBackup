/*
  Warnings:

  - You are about to drop the column `excludePatternPresetId` on the `JobSource` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "_ExcludePatternPresetToJobSource" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_ExcludePatternPresetToJobSource_A_fkey" FOREIGN KEY ("A") REFERENCES "ExcludePatternPreset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_ExcludePatternPresetToJobSource_B_fkey" FOREIGN KEY ("B") REFERENCES "JobSource" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
    "useStagingCache" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
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
CREATE UNIQUE INDEX "_ExcludePatternPresetToJobSource_AB_unique" ON "_ExcludePatternPresetToJobSource"("A", "B");

-- CreateIndex
CREATE INDEX "_ExcludePatternPresetToJobSource_B_index" ON "_ExcludePatternPresetToJobSource"("B");
