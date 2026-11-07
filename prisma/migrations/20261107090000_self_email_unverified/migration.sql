-- An email someone sets on their own account is unverified since this version, so a sign-in
-- provider no longer links the account by it, see src/lib/auth/sso-tenant-guard.ts. An account
-- whose owner set its email before is unverified too. The log tells which: the last change of the
-- email of the account was its owner's own, to the email it has now. A later change by an admin
-- vouches for the email, and the flag stays.
UPDATE "User" SET "emailVerified" = false
WHERE "emailVerified" = true AND "id" IN (
    WITH "named" AS (
        -- Every entry of the log that names the email of an account. The profile writes the change
        -- of the email with what it was, the dialog of the users writes the email it saved, changed
        -- or not, and the creation of an account the email it got.
        SELECT a."resourceId" AS "accountId", a."createdAt" AS "at", a.rowid AS "seq",
            COALESCE(a."action" = 'UPDATE' AND a."userId" = a."resourceId", 0) AS "own",
            a."action" = 'CREATE' AS "created",
            (SELECT CASE WHEN c."type" = 'object' THEN json_extract(c."value", '$.to') END
                FROM json_each(a."details", '$.changes') c
                WHERE CASE WHEN c."type" = 'object' THEN json_extract(c."value", '$.field') END = 'Email') AS "changedTo",
            json_extract(a."details", '$.email') AS "saved"
        FROM "AuditLog" a
        WHERE a."resource" = 'USER' AND a."action" IN ('CREATE', 'UPDATE') AND a."resourceId" IS NOT NULL AND json_valid(a."details")
    ),
    "emails" AS (
        SELECT "accountId", "at", "seq", "own", "created", COALESCE("changedTo", "saved") AS "email", "changedTo" IS NOT NULL AS "certain",
            LAG(COALESCE("changedTo", "saved")) OVER (PARTITION BY "accountId" ORDER BY "at", "seq") AS "before"
        FROM "named"
        WHERE COALESCE("changedTo", "saved") IS NOT NULL
    ),
    "changes" AS (
        -- The dialog writes the email on every save, so its entry is a change only when an earlier
        -- entry names another email. One that nothing in the log names before is no change, like the
        -- first account, made at setup without an entry, that only renamed itself. The profile names
        -- the change itself, and the creation gives the account its first email.
        SELECT "accountId", "own", "email", ROW_NUMBER() OVER (PARTITION BY "accountId" ORDER BY "at" DESC, "seq" DESC) AS "rank"
        FROM "emails"
        WHERE "certain" OR "created" OR ("before" IS NOT NULL AND lower("email") <> lower("before"))
    )
    SELECT c."accountId" FROM "changes" c JOIN "User" u ON u."id" = c."accountId"
    WHERE c."rank" = 1 AND c."own" AND lower(c."email") = lower(u."email")
);

-- The templates and presets an installation starts with were written with their times as text,
-- which SQLite sorts after every time the app writes in milliseconds. They get milliseconds too.
UPDATE "RetentionPolicy" SET "createdAt" = CAST(strftime('%s', "createdAt") AS INTEGER) * 1000 WHERE typeof("createdAt") = 'text' AND strftime('%s', "createdAt") IS NOT NULL;
UPDATE "RetentionPolicy" SET "updatedAt" = CAST(strftime('%s', "updatedAt") AS INTEGER) * 1000 WHERE typeof("updatedAt") = 'text' AND strftime('%s', "updatedAt") IS NOT NULL;
UPDATE "NamingTemplate" SET "createdAt" = CAST(strftime('%s', "createdAt") AS INTEGER) * 1000 WHERE typeof("createdAt") = 'text' AND strftime('%s', "createdAt") IS NOT NULL;
UPDATE "NamingTemplate" SET "updatedAt" = CAST(strftime('%s', "updatedAt") AS INTEGER) * 1000 WHERE typeof("updatedAt") = 'text' AND strftime('%s', "updatedAt") IS NOT NULL;
UPDATE "SchedulePreset" SET "createdAt" = CAST(strftime('%s', "createdAt") AS INTEGER) * 1000 WHERE typeof("createdAt") = 'text' AND strftime('%s', "createdAt") IS NOT NULL;
UPDATE "SchedulePreset" SET "updatedAt" = CAST(strftime('%s', "updatedAt") AS INTEGER) * 1000 WHERE typeof("updatedAt") = 'text' AND strftime('%s', "updatedAt") IS NOT NULL;
UPDATE "ExcludePatternPreset" SET "createdAt" = CAST(strftime('%s', "createdAt") AS INTEGER) * 1000 WHERE typeof("createdAt") = 'text' AND strftime('%s', "createdAt") IS NOT NULL;
UPDATE "ExcludePatternPreset" SET "updatedAt" = CAST(strftime('%s', "updatedAt") AS INTEGER) * 1000 WHERE typeof("updatedAt") = 'text' AND strftime('%s', "updatedAt") IS NOT NULL;
