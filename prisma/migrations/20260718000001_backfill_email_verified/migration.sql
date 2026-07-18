-- Fix: dashboard-created users were saved with emailVerified=false, which silently blocks
-- SSO account linking (better-auth's requireLocalEmailVerified check, default true) even
-- when the SSO provider is trusted. Email verification is not used as a feature anywhere
-- else in DBackup, so backfill existing users to keep SSO linking working after upgrade.
UPDATE "User"
SET "emailVerified" = 1
WHERE "emailVerified" = 0;
