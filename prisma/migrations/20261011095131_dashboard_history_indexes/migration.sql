-- Indexes for instances with a long history. The Type and Started by filters of the History page
-- count every run, and their columns sit behind `logs` in the row, so without an index each count
-- read the logs of every run. The storage trend of the dashboard looks up the newest snapshot of a
-- destination per day, which the index of both columns answers. It replaces the one of
-- `adapterConfigId` alone, which it covers.

-- DropIndex
DROP INDEX "StorageSnapshot_adapterConfigId_idx";

-- CreateIndex
CREATE INDEX "Execution_type_startedAt_idx" ON "Execution"("type", "startedAt");

-- CreateIndex
CREATE INDEX "Execution_triggerType_triggerLabel_idx" ON "Execution"("triggerType", "triggerLabel");

-- CreateIndex
CREATE INDEX "StorageSnapshot_adapterConfigId_createdAt_idx" ON "StorageSnapshot"("adapterConfigId", "createdAt");
