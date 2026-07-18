
export const PERMISSIONS = {
  USERS: {
    READ: "users:read",
    WRITE: "users:write",
  },
  GROUPS: {
    READ: "groups:read",
    WRITE: "groups:write",
  },
  SOURCES: {
    VIEW: "sources:view",
    READ: "sources:read",
    WRITE: "sources:write",
  },
  DESTINATIONS: {
    READ: "destinations:read",
    WRITE: "destinations:write",
  },
  JOBS: {
    READ: "jobs:read",
    WRITE: "jobs:write",
    EXECUTE: "jobs:execute",
  },
  STORAGE: {
    READ: "storage:read",
    DOWNLOAD: "storage:download",
    RESTORE: "storage:restore",
    DELETE: "storage:delete",
  },
  HISTORY: {
    READ: "history:read",
  },
  AUDIT: {
    READ: "audit:read",
  },
  NOTIFICATIONS: {
    READ: "notifications:read",
    WRITE: "notifications:write",
  },
  VAULT: {
    READ: "vault:read",
    WRITE: "vault:write",
  },
  CREDENTIALS: {
    READ: "credentials:read",
    WRITE: "credentials:write",
    DELETE: "credentials:delete",
    REVEAL: "credentials:reveal",
  },
  PROFILE: {
    UPDATE_NAME: "profile:update_name",
    UPDATE_EMAIL: "profile:update_email",
    UPDATE_PASSWORD: "profile:update_password",
    MANAGE_2FA: "profile:manage_2fa",
    MANAGE_PASSKEYS: "profile:manage_passkeys",
    MANAGE_SSO: "profile:manage_sso",
  },
  SETTINGS: {
    READ: "settings:read",
    WRITE: "settings:write",
  },
  API_KEYS: {
    READ: "api-keys:read",
    WRITE: "api-keys:write",
  },
  TEMPLATES: {
    READ: "templates:read",
    WRITE: "templates:write",
  },
} as const;

export type Permission =
  | typeof PERMISSIONS.USERS.READ
  | typeof PERMISSIONS.USERS.WRITE
  | typeof PERMISSIONS.GROUPS.READ
  | typeof PERMISSIONS.GROUPS.WRITE
  | typeof PERMISSIONS.SOURCES.VIEW
  | typeof PERMISSIONS.SOURCES.READ
  | typeof PERMISSIONS.SOURCES.WRITE
  | typeof PERMISSIONS.DESTINATIONS.READ
  | typeof PERMISSIONS.DESTINATIONS.WRITE
  | typeof PERMISSIONS.JOBS.READ
  | typeof PERMISSIONS.JOBS.WRITE
  | typeof PERMISSIONS.JOBS.EXECUTE
  | typeof PERMISSIONS.STORAGE.READ
  | typeof PERMISSIONS.STORAGE.DOWNLOAD
  | typeof PERMISSIONS.STORAGE.RESTORE
  | typeof PERMISSIONS.STORAGE.DELETE
  | typeof PERMISSIONS.HISTORY.READ
  | typeof PERMISSIONS.AUDIT.READ
  | typeof PERMISSIONS.NOTIFICATIONS.READ
  | typeof PERMISSIONS.NOTIFICATIONS.WRITE
  | typeof PERMISSIONS.VAULT.READ
  | typeof PERMISSIONS.VAULT.WRITE
  | typeof PERMISSIONS.CREDENTIALS.READ
  | typeof PERMISSIONS.CREDENTIALS.WRITE
  | typeof PERMISSIONS.CREDENTIALS.DELETE
  | typeof PERMISSIONS.CREDENTIALS.REVEAL
  | typeof PERMISSIONS.PROFILE.UPDATE_NAME
  | typeof PERMISSIONS.PROFILE.UPDATE_EMAIL
  | typeof PERMISSIONS.PROFILE.UPDATE_PASSWORD
  | typeof PERMISSIONS.PROFILE.MANAGE_2FA
  | typeof PERMISSIONS.PROFILE.MANAGE_PASSKEYS
  | typeof PERMISSIONS.PROFILE.MANAGE_SSO
  | typeof PERMISSIONS.SETTINGS.READ
  | typeof PERMISSIONS.SETTINGS.WRITE
  | typeof PERMISSIONS.API_KEYS.READ
  | typeof PERMISSIONS.API_KEYS.WRITE
  | typeof PERMISSIONS.TEMPLATES.READ
  | typeof PERMISSIONS.TEMPLATES.WRITE;

export const AVAILABLE_PERMISSIONS = [
  // Users & Groups
  { id: PERMISSIONS.USERS.READ, label: "View Users", category: "Users" },
  { id: PERMISSIONS.USERS.WRITE, label: "Manage Users", category: "Users" },
  { id: PERMISSIONS.GROUPS.READ, label: "View Groups", category: "Groups" },
  { id: PERMISSIONS.GROUPS.WRITE, label: "Manage Groups", category: "Groups" },

  // Resources
  { id: PERMISSIONS.SOURCES.VIEW, label: "View Sources", category: "Sources" },
  { id: PERMISSIONS.SOURCES.READ, label: "Browse Database Explorer (Tables & Data)", category: "Sources" },
  { id: PERMISSIONS.SOURCES.WRITE, label: "Manage Sources (Create/Edit/Delete)", category: "Sources" },
  { id: PERMISSIONS.DESTINATIONS.READ, label: "View Destinations", category: "Destinations" },
  { id: PERMISSIONS.DESTINATIONS.WRITE, label: "Manage Destinations (Create/Edit/Delete)", category: "Destinations" },

  // Operations & Jobs
  { id: PERMISSIONS.JOBS.READ, label: "View Jobs", category: "Jobs" },
  { id: PERMISSIONS.JOBS.WRITE, label: "Manage Jobs (Create/Edit/Delete)", category: "Jobs" },
  { id: PERMISSIONS.JOBS.EXECUTE, label: "Execute Jobs Manually", category: "Jobs" },

  // Storage & History
  { id: PERMISSIONS.STORAGE.READ, label: "Access Storage Explorer", category: "Storage" },
  { id: PERMISSIONS.STORAGE.DOWNLOAD, label: "Download Backups", category: "Storage" },
  { id: PERMISSIONS.STORAGE.RESTORE, label: "Restore Backups", category: "Storage" },
  { id: PERMISSIONS.STORAGE.DELETE, label: "Delete Backups", category: "Storage" },
  { id: PERMISSIONS.HISTORY.READ, label: "View Execution History", category: "History" },
  { id: PERMISSIONS.AUDIT.READ, label: "View Audit Logs", category: "Audit" },

  // Notifications
  { id: PERMISSIONS.NOTIFICATIONS.READ, label: "View Notifications", category: "Notifications" },
  { id: PERMISSIONS.NOTIFICATIONS.WRITE, label: "Manage Notifications", category: "Notifications" },

  // Vault
  { id: PERMISSIONS.VAULT.READ, label: "View Vault (Encryption Profiles)", category: "Vault" },
  { id: PERMISSIONS.VAULT.WRITE, label: "Manage Vault (Create/Delete Keys)", category: "Vault" },

  // Credentials
  { id: PERMISSIONS.CREDENTIALS.READ, label: "View Credential Profiles", category: "Credentials" },
  { id: PERMISSIONS.CREDENTIALS.WRITE, label: "Manage Credential Profiles (Create/Edit)", category: "Credentials" },
  { id: PERMISSIONS.CREDENTIALS.DELETE, label: "Delete Credential Profiles", category: "Credentials" },
  { id: PERMISSIONS.CREDENTIALS.REVEAL, label: "Reveal Credential Secrets", category: "Credentials" },

  // Profile & Security
  { id: PERMISSIONS.PROFILE.UPDATE_NAME, label: "Update Own Name", category: "Profile" },
  { id: PERMISSIONS.PROFILE.UPDATE_EMAIL, label: "Update Own Email", category: "Profile" },
  { id: PERMISSIONS.PROFILE.UPDATE_PASSWORD, label: "Update Own Password", category: "Profile" },
  { id: PERMISSIONS.PROFILE.MANAGE_2FA, label: "Manage 2FA", category: "Profile" },
  { id: PERMISSIONS.PROFILE.MANAGE_PASSKEYS, label: "Manage Passkeys", category: "Profile" },
  { id: PERMISSIONS.PROFILE.MANAGE_SSO, label: "Manage SSO Connections", category: "Profile" },

  // Settings
  { id: PERMISSIONS.SETTINGS.READ, label: "View System Settings", category: "Settings" },
  { id: PERMISSIONS.SETTINGS.WRITE, label: "Manage System Settings", category: "Settings" },

  // API Keys
  { id: PERMISSIONS.API_KEYS.READ, label: "View API Keys", category: "API Keys" },
  { id: PERMISSIONS.API_KEYS.WRITE, label: "Manage API Keys (Create/Delete/Rotate)", category: "API Keys" },

  // Templates
  { id: PERMISSIONS.TEMPLATES.READ, label: "View Templates", category: "Templates" },
  { id: PERMISSIONS.TEMPLATES.WRITE, label: "Manage Templates (Create/Edit/Delete)", category: "Templates" },
];
