-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL,
    "image" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "dateFormat" TEXT NOT NULL DEFAULT 'P',
    "timeFormat" TEXT NOT NULL DEFAULT 'p',
    "autoRedirectOnJobStart" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    "twoFactorEnabled" BOOLEAN,
    "passkeyTwoFactor" BOOLEAN DEFAULT false,
    "groupId" TEXT,
    CONSTRAINT "User_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_User" ("createdAt", "dateFormat", "email", "emailVerified", "groupId", "id", "image", "name", "passkeyTwoFactor", "timeFormat", "timezone", "twoFactorEnabled", "updatedAt") SELECT "createdAt", "dateFormat", "email", "emailVerified", "groupId", "id", "image", "name", "passkeyTwoFactor", "timeFormat", "timezone", "twoFactorEnabled", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
