/*
  Warnings:

  - You are about to alter the column `size` on the `Execution` table. The data in that column could be lost. The data in that column will be cast from `Int` to `BigInt`.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Execution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'Backup',
    "status" TEXT NOT NULL,
    "logs" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "size" BIGINT,
    "path" TEXT,
    "metadata" TEXT,
    CONSTRAINT "Execution_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Execution" ("endedAt", "id", "jobId", "logs", "metadata", "path", "size", "startedAt", "status", "type") SELECT "endedAt", "id", "jobId", "logs", "metadata", "path", "size", "startedAt", "status", "type" FROM "Execution";
DROP TABLE "Execution";
ALTER TABLE "new_Execution" RENAME TO "Execution";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
