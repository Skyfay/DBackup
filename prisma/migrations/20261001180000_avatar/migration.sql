-- CreateTable
CREATE TABLE "Avatar" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BLOB NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Avatar_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
