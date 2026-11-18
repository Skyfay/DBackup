-- The SSO plugin of better-auth reads the scopes of a provider from `scopes`, a list. DBackup wrote a
-- string under `scope`, which the plugin ignored, so it asked for its own default with
-- `offline_access`, which Google refuses (#198). Every provider without a list gets the scopes DBackup
-- asks for, see src/lib/auth/oidc-scopes.ts. A list someone set by hand stays.
UPDATE "SsoProvider"
SET "oidcConfig" = json_remove(json_set("oidcConfig", '$.scopes', json('["openid","profile","email"]')), '$.scope')
WHERE "oidcConfig" IS NOT NULL AND json_valid("oidcConfig") AND json_type("oidcConfig", '$.scopes') IS NOT 'array';
