-- Put the chain position into the built-in "Standard" naming template.
--
-- {chain} resolves to the position inside an incremental chain (full-000, inc-001) and to
-- nothing at all for every other job - together with the separator in front of it, so a
-- non-incremental backup keeps a clean name. Without the token the upload step prepends the
-- position instead, so this changes where it appears, never whether it appears.
--
-- Only the system row is touched, and only while it still carries the pattern this project
-- shipped it with: an installation whose Standard template was changed by hand keeps its
-- own value, and user-created templates are never rewritten.
UPDATE "NamingTemplate"
SET "pattern" = '{job_name}_yyyy-MM-dd_HH-mm-ss_{chain}',
    "description" = 'Default naming pattern: {job_name}_date_time, plus the chain position on incremental jobs.',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'naming-standard'
  AND "pattern" = '{job_name}_yyyy-MM-dd_HH-mm-ss';
