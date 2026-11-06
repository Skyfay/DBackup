/**
 * What the configuration backup goes through, its destination, the saved logins of that
 * destination and its key, only a platform admin changes, reveals or deletes. The server refuses
 * everyone else with these sentences, see `src/lib/server/config-backup-target-guard.ts`, and the
 * pages lock the same buttons with them.
 */

export const CONFIG_BACKUP_DESTINATION_LOCKED = "This destination holds the configuration backup. Only a platform admin changes it.";
export const CONFIG_BACKUP_LOGIN_LOCKED = "This saved login opens the destination of the configuration backup. Only a platform admin reveals or changes it.";
export const CONFIG_BACKUP_LOGIN_APPLY_LOCKED = "This saved login opens the destination of the configuration backup. Only a platform admin signs in with it on another connection or in a connection form.";
export const CONFIG_BACKUP_KEY_LOCKED = "This key encrypts the configuration backup. Only a platform admin reveals, exports or deletes it.";
