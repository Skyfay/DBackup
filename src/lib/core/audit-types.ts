export const AUDIT_ACTIONS = {
  LOGIN: "LOGIN",
  LOGOUT: "LOGOUT",
  CREATE: "CREATE",
  UPDATE: "UPDATE",
  DELETE: "DELETE",
  EXECUTE: "EXECUTE", // For running jobs manually
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
} as const;

export type AuditResource = typeof AUDIT_RESOURCES[keyof typeof AUDIT_RESOURCES];
