-- The settings of a tenant and its Recently deleted have rights of their own since the tenant
-- groups. Groups that could see or change the settings got them then, the API keys did not, so a key
-- that could delete for good lost it. A key keeps what it could do, like the groups.
UPDATE "ApiKey" SET "permissions" = json_insert("permissions", '$[#]', 'tenant-settings:read')
WHERE json_valid("permissions")
  AND EXISTS (SELECT 1 FROM json_each("ApiKey"."permissions") WHERE value = 'settings:read')
  AND NOT EXISTS (SELECT 1 FROM json_each("ApiKey"."permissions") WHERE value = 'tenant-settings:read');
UPDATE "ApiKey" SET "permissions" = json_insert("permissions", '$[#]', 'tenant-settings:write')
WHERE json_valid("permissions")
  AND EXISTS (SELECT 1 FROM json_each("ApiKey"."permissions") WHERE value = 'settings:write')
  AND NOT EXISTS (SELECT 1 FROM json_each("ApiKey"."permissions") WHERE value = 'tenant-settings:write');

-- The tenant migrations wrote their times as text, which SQLite sorts after every time the app
-- writes in milliseconds. Those rows get milliseconds too.
UPDATE "Tenant" SET "createdAt" = CAST(strftime('%s', "createdAt") AS INTEGER) * 1000 WHERE typeof("createdAt") = 'text';
UPDATE "Tenant" SET "updatedAt" = CAST(strftime('%s', "updatedAt") AS INTEGER) * 1000 WHERE typeof("updatedAt") = 'text';
UPDATE "TenantMembership" SET "createdAt" = CAST(strftime('%s', "createdAt") AS INTEGER) * 1000 WHERE typeof("createdAt") = 'text';
UPDATE "Group" SET "createdAt" = CAST(strftime('%s', "createdAt") AS INTEGER) * 1000 WHERE typeof("createdAt") = 'text';
UPDATE "Group" SET "updatedAt" = CAST(strftime('%s', "updatedAt") AS INTEGER) * 1000 WHERE typeof("updatedAt") = 'text';
