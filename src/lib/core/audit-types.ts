export const AUDIT_ACTIONS = {
  LOGIN: "LOGIN",
  LOGOUT: "LOGOUT",
  CREATE: "CREATE",
  UPDATE: "UPDATE",
  DELETE: "DELETE",
  EXECUTE: "EXECUTE", // For running jobs manually
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
} as const;

export type AuditResource = typeof AUDIT_RESOURCES[keyof typeof AUDIT_RESOURCES];
