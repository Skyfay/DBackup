-- The system task Check for updates follows Look for new versions under General. A task that was
-- switched off on its own turns that switch off, so no instance starts to check by itself.
INSERT INTO "SystemSetting" ("key", "value", "updatedAt")
SELECT 'general.checkForUpdates', 'false', CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "SystemSetting" WHERE "key" = 'task.system.check_for_updates.enabled' AND "value" = 'false')
ON CONFLICT ("key") DO UPDATE SET "value" = 'false', "updatedAt" = CURRENT_TIMESTAMP;

DELETE FROM "SystemSetting" WHERE "key" = 'task.system.check_for_updates.enabled';

-- The stuck run watchdog follows the timeout under General, where Never is 0. A watchdog that was
-- switched off on its own sets the timeout to Never.
INSERT INTO "SystemSetting" ("key", "value", "updatedAt")
SELECT 'execution.stuckTimeoutMinutes', '0', CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "SystemSetting" WHERE "key" = 'task.system.stuck_execution_check.enabled' AND "value" = 'false')
ON CONFLICT ("key") DO UPDATE SET "value" = '0', "updatedAt" = CURRENT_TIMESTAMP;

DELETE FROM "SystemSetting" WHERE "key" = 'task.system.stuck_execution_check.enabled';

-- The schedule of the configuration backup has one key. The one of an older version still counted
-- over the key of the task, so a schedule set under System tasks never applied.
INSERT INTO "SystemSetting" ("key", "value", "updatedAt")
SELECT 'config.backup.schedule', "value", CURRENT_TIMESTAMP FROM "SystemSetting" WHERE "key" = 'task.system.config_backup.schedule'
ON CONFLICT ("key") DO NOTHING;

DELETE FROM "SystemSetting" WHERE "key" = 'task.system.config_backup.schedule';

-- Saving General wrote a file name pattern with the unknown token {name}. A job without a naming
-- template, while no template is the default, fell back to it and named its files {name}_...
DELETE FROM "SystemSetting" WHERE "key" = 'system.filenamePattern' AND "value" = '{name}_yyyy-MM-dd_HH-mm-ss';
