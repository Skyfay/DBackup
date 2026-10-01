-- CreateTable
CREATE TABLE "LoginImage" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'login',
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BLOB NOT NULL,
    "updatedAt" DATETIME NOT NULL
);
