-- AlterTable
ALTER TABLE "Execution" ADD COLUMN "logsPurgedAt" DATETIME;

-- CreateIndex
CREATE INDEX "Execution_startedAt_idx" ON "Execution"("startedAt");

-- CreateIndex
CREATE INDEX "Execution_status_startedAt_idx" ON "Execution"("status", "startedAt");

-- CreateIndex
CREATE INDEX "Execution_jobId_startedAt_idx" ON "Execution"("jobId", "startedAt");

-- CreateIndex
CREATE INDEX "Execution_logsPurgedAt_startedAt_idx" ON "Execution"("logsPurgedAt", "startedAt");
