-- The longest a run may take came with the stuck run watchdog. A watchdog that an older version
-- switched off, with the timeout Never, stays off, so no run of such an instance ends after a day.
INSERT INTO "SystemSetting" ("key", "value", "updatedAt")
SELECT 'execution.maxRunMinutes', '0', CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "SystemSetting" WHERE "key" = 'execution.stuckTimeoutMinutes' AND "value" = '0')
ON CONFLICT ("key") DO NOTHING;
