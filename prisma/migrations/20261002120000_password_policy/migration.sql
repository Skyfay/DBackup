-- The rules of new passwords under Settings > Passwords. A new instance asks for Standard, which
-- needs no row. An instance with users keeps what it asked until now, 8 characters and nothing else.
INSERT INTO "SystemSetting" ("key", "value", "description", "updatedAt")
SELECT 'auth.password.level', 'basic', 'How strong a new password has to be', CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "User")
ON CONFLICT ("key") DO NOTHING;
