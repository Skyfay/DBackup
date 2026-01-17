
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
  NOTIFICATIONS: {
    READ: "notifications:read",
    WRITE: "notifications:write",
  },
  PROFILE: {
    UPDATE_NAME: "profile:update_name",
    UPDATE_EMAIL: "profile:update_email",
    UPDATE_PASSWORD: "profile:update_password",
    MANAGE_2FA: "profile:manage_2fa",
    MANAGE_PASSKEYS: "profile:manage_passkeys",
  },
} as const;

export type Permission =
  | typeof PERMISSIONS.USERS.READ
  | typeof PERMISSIONS.USERS.WRITE
  | typeof PERMISSIONS.GROUPS.READ
  | typeof PERMISSIONS.GROUPS.WRITE
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
  | typeof PERMISSIONS.NOTIFICATIONS.READ
  | typeof PERMISSIONS.NOTIFICATIONS.WRITE
  | typeof PERMISSIONS.PROFILE.UPDATE_NAME
  | typeof PERMISSIONS.PROFILE.UPDATE_EMAIL
  | typeof PERMISSIONS.PROFILE.UPDATE_PASSWORD
  | typeof PERMISSIONS.PROFILE.MANAGE_2FA
  | typeof PERMISSIONS.PROFILE.MANAGE_PASSKEYS;

export const AVAILABLE_PERMISSIONS = [
  // Users & Groups
  { id: PERMISSIONS.USERS.READ, label: "View Users", category: "Users" },
  { id: PERMISSIONS.USERS.WRITE, label: "Manage Users", category: "Users" },
  { id: PERMISSIONS.GROUPS.READ, label: "View Groups", category: "Groups" },
  { id: PERMISSIONS.GROUPS.WRITE, label: "Manage Groups", category: "Groups" },

  // Resources
  { id: PERMISSIONS.SOURCES.READ, label: "View Sources", category: "Sources" },
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

  // Notifications
  { id: PERMISSIONS.NOTIFICATIONS.READ, label: "View Notifications", category: "Notifications" },
  { id: PERMISSIONS.NOTIFICATIONS.WRITE, label: "Manage Notifications", category: "Notifications" },

  // Profile & Security
  { id: PERMISSIONS.PROFILE.UPDATE_NAME, label: "Update Own Name", category: "Profile" },
  { id: PERMISSIONS.PROFILE.UPDATE_EMAIL, label: "Update Own Email", category: "Profile" },
  { id: PERMISSIONS.PROFILE.UPDATE_PASSWORD, label: "Update Own Password", category: "Profile" },
  { id: PERMISSIONS.PROFILE.MANAGE_2FA, label: "Manage 2FA", category: "Profile" },
  { id: PERMISSIONS.PROFILE.MANAGE_PASSKEYS, label: "Manage Passkeys", category: "Profile" },
];
