export const AUDIT_ACTIONS = {
  LOGIN: "LOGIN",
  LOGIN_FAILED: "LOGIN_FAILED", // A sign-in that was turned down
  LOGOUT: "LOGOUT",
  CREATE: "CREATE",
  UPDATE: "UPDATE",
  DELETE: "DELETE",
  EXECUTE: "EXECUTE", // For running jobs manually
  RESTORE: "RESTORE", // Restoring a backup, some of its files or the configuration
  EXPORT: "EXPORT", // For sensitive data exports (e.g., recovery kit)
} as const;

export type AuditAction = typeof AUDIT_ACTIONS[keyof typeof AUDIT_ACTIONS];

export const AUDIT_RESOURCES = {
  AUTH: "AUTH",
  USER: "USER",
  GROUP: "GROUP",
  SOURCE: "SOURCE",
  DESTINATION: "DESTINATION",
  JOB: "JOB",
  SYSTEM: "SYSTEM",
  ADAPTER: "ADAPTER",
  VAULT: "VAULT", // Encryption profiles / recovery kits
  CREDENTIAL: "CREDENTIAL", // Credential profiles (DB/SSH/storage credentials)
  API_KEY: "API_KEY",
  TEMPLATE: "TEMPLATE", // Retention policies, naming templates, schedule presets, exclude pattern presets
  BACKUP: "BACKUP", // One backup at a destination: downloaded, restored, locked or deleted
  SSO_PROVIDER: "SSO_PROVIDER", // A way to sign in through an identity provider
} as const;

export type AuditResource = typeof AUDIT_RESOURCES[keyof typeof AUDIT_RESOURCES];

/**
 * One field of a record before and after a change, as an entry keeps it in `details.changes`.
 * A secret never goes in with its value: it is marked `secret` and both values stay null.
 */
export interface AuditChange {
  field: string;
  from: string | null;
  to: string | null;
  secret?: true;
}
