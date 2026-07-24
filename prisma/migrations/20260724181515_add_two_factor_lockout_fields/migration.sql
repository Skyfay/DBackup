-- Fix: the better-auth >= 1.6 two-factor plugin writes "failedVerificationCount" and
-- "lockedUntil" on the TwoFactor model to rate limit failed TOTP/backup code attempts.
-- Both columns were missing, so enabling 2FA and verifying codes failed with a Prisma
-- validation error ("Unknown argument `failedVerificationCount`").
-- Plain ADD COLUMN instead of a table rebuild to keep existing 2FA rows untouched.
ALTER TABLE "TwoFactor" ADD COLUMN "failedVerificationCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TwoFactor" ADD COLUMN "lockedUntil" DATETIME;
