import { AdapterConfig, Job, SystemSetting, User, Group, SsoProvider, EncryptionProfile, Account } from "@prisma/client";

export interface AppConfigurationBackup {
  metadata: {
    version: string;      // App Version (e.g. from package.json)
    exportedAt: string;   // ISO Date
    includeSecrets: boolean;
    sourceType: 'SYSTEM' | 'MANUAL';
  };
  settings: SystemSetting[];
  adapters: AdapterConfig[];
  jobs: Job[];
  users: (User & { accounts: Account[] })[];
  groups: Group[];
  // Permissions are stored as JSON strings in the Group model in the current schema.
  // Ideally, if we had a Permission model it would be included,
  // but looking at schema.prisma 'Group.permissions' is a string.
  // We export exactly what comes out of Prisma for 'groups'.

  ssoProviders: SsoProvider[];

  encryptionProfiles: Omit<EncryptionProfile, 'secretKey'>[];
  // We do NOT export the secretKey of EncryptionProfiles in this array in a way that depends on the OLD system key.
  // If we export them, we might need a strategy for migration.
  // For V1 of this feature, we might SKIP exporting Encryption Profile PRIVATE keys
  // to avoid complex key-wrapping logic. The user should have their Recovery Kit.
  // Or, we export them re-encrypted with a temporary key if we were doing a full migration wizard.
  // Safe bet: Export metadata only. User must manually re-enter or restore keys if needed.
}

export interface RestoreOptions {
    settings: boolean;
    adapters: boolean;
    jobs: boolean;
    users: boolean; // Includes Users and Groups
    sso: boolean;
    profiles: boolean;
}
