import prisma from "@/lib/prisma";
import { AppConfigurationBackup, RestoreOptions } from "@/lib/types/config-backup";
import { encryptConfig, encrypt } from "@/lib/crypto";
import { logger } from "@/lib/logging/logger";

const svcLog = logger.child({ service: "ConfigService" });

/**
 * Restores configuration into the database from a parsed backup object.
 * Handles FK remapping when entities exist with the same natural key but different IDs.
 *
 * @param data The backup object
 * @param _strategy 'OVERWRITE' (Currently only strategy supported)
 * @param options Select which parts to restore
 */
export async function importConfiguration(
  data: AppConfigurationBackup,
  _strategy: 'OVERWRITE',
  options?: RestoreOptions
): Promise<void> {
  if (!data.metadata || !data.metadata.version) {
    throw new Error("Invalid configuration backup: Missing metadata");
  }

  // Default options (Enable all if not specified)
  const opts = options || {
    settings: true,
    adapters: true,
    jobs: true,
    users: true,
    sso: true,
    profiles: true,
    statistics: false,
  };

  // TODO: Add version compatibility check here if needed in future
  svcLog.info("Restoring configuration", { version: data.metadata.version });

  await prisma.$transaction(async (tx) => {
    // 1. Restore Settings
    if (opts.settings) {
      for (const setting of data.settings) {
        await tx.systemSetting.upsert({
          where: { key: setting.key },
          create: setting,
          update: setting,
        });
      }
    }

    // 2. Restore Credential Profiles (MUST be before Adapters due to FK constraint)
    // Build mapping from backup credential ID → actual credential ID for FK remapping in adapters
    const credentialIdMap = new Map<string, string>();
    if (opts.profiles && data.credentialProfiles && data.credentialProfiles.length > 0) {
      for (const profile of data.credentialProfiles) {
        // Skip profiles that were exported without secrets (data is empty string)
        if (!profile.data) {
          svcLog.warn("Skipping credential profile - secret data missing in export", { profileId: profile.id, name: profile.name });
          continue;
        }

        // Re-encrypt data with CURRENT system key
        const encryptedData = encrypt(profile.data);
        const profileData = { ...profile, data: encryptedData };

        // Check if a profile with the same name but different ID exists
        const existingByName = await tx.credentialProfile.findUnique({ where: { name: profile.name } });
        if (existingByName && existingByName.id !== profile.id) {
          const { id: _id, ...updateFields } = profileData;
          await tx.credentialProfile.update({
            where: { id: existingByName.id },
            data: updateFields,
          });
          credentialIdMap.set(profile.id, existingByName.id);
        } else {
          await tx.credentialProfile.upsert({
            where: { id: profile.id },
            create: profileData,
            update: profileData,
          });
        }
      }
    }

    // 3. Restore Adapters
    // Build mapping from backup adapter ID → actual adapter ID for FK remapping
    const adapterIdMap = new Map<string, string>();
    if (opts.adapters) {
      for (const adapter of data.adapters) {
        let configObj: any = {};
        try {
          configObj = JSON.parse(adapter.config);
        } catch { /* empty */ }

        // Re-encrypt config with CURRENT system key
        configObj = encryptConfig(configObj);

        const adapterData = { ...adapter, config: JSON.stringify(configObj) };

        // Remap credential profile IDs if they were merged
        if (adapterData.primaryCredentialId && credentialIdMap.has(adapterData.primaryCredentialId)) {
          adapterData.primaryCredentialId = credentialIdMap.get(adapterData.primaryCredentialId)!;
        }
        if (adapterData.sshCredentialId && credentialIdMap.has(adapterData.sshCredentialId)) {
          adapterData.sshCredentialId = credentialIdMap.get(adapterData.sshCredentialId)!;
        }

        // Null out credential references that don't exist on this system
        if (adapterData.primaryCredentialId) {
          const credExists = await tx.credentialProfile.findUnique({ where: { id: adapterData.primaryCredentialId }, select: { id: true } });
          if (!credExists) {
            svcLog.warn("Removing invalid primaryCredentialId from adapter", { adapterId: adapter.id, primaryCredentialId: adapterData.primaryCredentialId });
            adapterData.primaryCredentialId = null;
          }
        }
        if (adapterData.sshCredentialId) {
          const credExists = await tx.credentialProfile.findUnique({ where: { id: adapterData.sshCredentialId }, select: { id: true } });
          if (!credExists) {
            svcLog.warn("Removing invalid sshCredentialId from adapter", { adapterId: adapter.id, sshCredentialId: adapterData.sshCredentialId });
            adapterData.sshCredentialId = null;
          }
        }

        // Check if an adapter with the same name and type already exists
        const existingByName = await tx.adapterConfig.findFirst({
          where: { name: adapter.name, type: adapter.type },
        });
        if (existingByName && existingByName.id !== adapter.id) {
          // Update existing adapter in-place
          const { id: _id, ...updateFields } = adapterData;
          await tx.adapterConfig.update({
            where: { id: existingByName.id },
            data: updateFields,
          });
          adapterIdMap.set(adapter.id, existingByName.id);
        } else {
          await tx.adapterConfig.upsert({
            where: { id: adapter.id },
            create: adapterData,
            update: adapterData,
          });
        }
      }
    }

    // 4. Restore Encryption Profiles (Metadata only)
    // Build mapping from backup profile ID → actual profile ID for FK remapping
    const profileIdMap = new Map<string, string>();
    if (opts.profiles) {
      for (const profile of data.encryptionProfiles) {
        // Check if a profile with the same name but different ID exists
        const existingByName = await tx.encryptionProfile.findFirst({ where: { name: profile.name } });

        if (existingByName && existingByName.id !== profile.id) {
          // Update existing profile in-place
          await tx.encryptionProfile.update({
            where: { id: existingByName.id },
            data: {
              name: profile.name,
              description: profile.description,
              updatedAt: new Date(),
            },
          });
          profileIdMap.set(profile.id, existingByName.id);
        } else {
          // Check if exists by ID
          const exists = await tx.encryptionProfile.findUnique({ where: { id: profile.id } });
          if (exists) {
            await tx.encryptionProfile.update({
              where: { id: profile.id },
              data: {
                name: profile.name,
                description: profile.description,
                updatedAt: new Date(),
              }
            });
          } else {
            // @ts-expect-error Types might miss secretKey depending on Omit usage
            if (profile.secretKey) {
              // Re-encrypt with CURRENT system key
              // @ts-expect-error Types might miss secretKey
              const encryptedKey = encrypt(profile.secretKey);
              await tx.encryptionProfile.create({
                data: {
                  ...profile,
                  secretKey: encryptedKey
                }
              });
            } else {
              svcLog.warn("Skipping encryption profile - secret key missing in export", { profileId: profile.id, name: profile.name });
            }
          }
        }
      }
    }

    // 5. Restore Jobs
    if (opts.jobs) {
      for (const jobItem of data.jobs) {
        const job = { ...jobItem };

        // Remap sourceId if the adapter was merged
        if (job.sourceId && adapterIdMap.has(job.sourceId)) {
          job.sourceId = adapterIdMap.get(job.sourceId)!;
        }

        // Remap encryptionProfileId if the profile was merged
        if (job.encryptionProfileId && profileIdMap.has(job.encryptionProfileId)) {
          job.encryptionProfileId = profileIdMap.get(job.encryptionProfileId)!;
        }

        // Check Encryption Profile Dependency
        if (job.encryptionProfileId) {
          const profileExists = await tx.encryptionProfile.findUnique({ where: { id: job.encryptionProfileId } });
          if (!profileExists) {
            svcLog.warn("Removing invalid encryption profile from job", { encryptionProfileId: job.encryptionProfileId, jobName: job.name });
            job.encryptionProfileId = null;
          }
        }

        // Check if a job with the same name but different ID exists
        const existingJob = await tx.job.findFirst({ where: { name: job.name } });
        if (existingJob && existingJob.id !== job.id) {
          const { id: _id, ...updateFields } = job;
          await tx.job.update({
            where: { id: existingJob.id },
            data: updateFields as any,
          });
        } else {
          await tx.job.upsert({
            where: { id: job.id },
            create: job as any,
            update: job as any,
          });
        }
      }

      // 4b. Restore Job Destinations
      if (data.jobDestinations && data.jobDestinations.length > 0) {
        for (const dest of data.jobDestinations) {
          const remapped = { ...dest };
          // Remap configId if the adapter was merged
          if (remapped.configId && adapterIdMap.has(remapped.configId)) {
            remapped.configId = adapterIdMap.get(remapped.configId)!;
          }
          await tx.jobDestination.upsert({
            where: { id: remapped.id },
            create: remapped,
            update: remapped,
          });
        }
      }

      // 4c. Restore Job Notification Assignments (M:M)
      if (data.jobNotifications) {
        for (const [jobId, notifIds] of Object.entries(data.jobNotifications)) {
          // Remap notification adapter IDs
          const remappedNotifIds = notifIds.map(id => adapterIdMap.get(id) ?? id);
          await tx.job.update({
            where: { id: jobId },
            data: {
              notifications: {
                set: remappedNotifIds.map(id => ({ id }))
              }
            }
          });
        }
      }
    }

    // 6. Restore Groups
    // Build mappings from backup IDs → actual IDs for FK remapping
    const groupIdMap = new Map<string, string>();
    const userIdMap = new Map<string, string>();
    if (opts.users) {
      for (const group of data.groups) {
        // Check if a group with the same name but different ID already exists
        const existingByName = await tx.group.findUnique({ where: { name: group.name } });
        if (existingByName && existingByName.id !== group.id) {
          // Update the existing group in-place to avoid unique constraint violation
          await tx.group.update({
            where: { id: existingByName.id },
            data: { permissions: group.permissions, updatedAt: group.updatedAt },
          });
          groupIdMap.set(group.id, existingByName.id);
        } else {
          await tx.group.upsert({
            where: { id: group.id },
            create: group,
            update: group,
          });
        }
      }

      // 7. Restore Users
      for (const user of data.users) {
        const { accounts, ...userFields } = user;

        // Remap groupId if the group was merged into an existing one
        if (userFields.groupId && groupIdMap.has(userFields.groupId)) {
          userFields.groupId = groupIdMap.get(userFields.groupId)!;
        }

        // Check if a user with the same email but different ID already exists
        const existingUser = await tx.user.findUnique({ where: { email: user.email } });
        if (existingUser && existingUser.id !== user.id) {
          const { id: _id, email: _email, ...updateFields } = userFields;
          await tx.user.update({
            where: { id: existingUser.id },
            data: updateFields,
          });
          userIdMap.set(user.id, existingUser.id);
        } else {
          await tx.user.upsert({
            where: { id: user.id },
            create: userFields,
            update: userFields,
          });
        }

        // Determine the actual userId for child records
        const actualUserId = userIdMap.get(user.id) ?? user.id;

        if (accounts && Array.isArray(accounts)) {
          for (const account of accounts) {
            const remappedAccount = { ...account, userId: actualUserId };
            await tx.account.upsert({
              where: { id: account.id },
              create: remappedAccount,
              update: remappedAccount
            });
          }
        }
      }

      // 7b. Restore API Keys
      if (data.apiKeys && data.apiKeys.length > 0) {
        for (const key of data.apiKeys) {
          // Skip keys with stripped hashedKey (no-secret exports)
          if (!key.hashedKey) continue;
          const remappedKey = { ...key };
          if (remappedKey.userId && userIdMap.has(remappedKey.userId)) {
            remappedKey.userId = userIdMap.get(remappedKey.userId)!;
          }
          await tx.apiKey.upsert({
            where: { id: remappedKey.id },
            create: remappedKey,
            update: remappedKey,
          });
        }
      }
    }

    // 8. Restore SSO Providers
    if (opts.sso) {
      for (const provider of data.ssoProviders) {
        // Re-encrypt secrets with current system key before storing
        const providerData = { ...provider };
        if (providerData.clientId) {
          try { providerData.clientId = encrypt(providerData.clientId); } catch { /* already encrypted or empty */ }
        }
        if (providerData.clientSecret) {
          try { providerData.clientSecret = encrypt(providerData.clientSecret); } catch { /* already encrypted or empty */ }
        }
        if (providerData.oidcConfig) {
          try {
            const oidcConfig = JSON.parse(providerData.oidcConfig);
            if (oidcConfig.clientId) oidcConfig.clientId = encrypt(oidcConfig.clientId);
            if (oidcConfig.clientSecret) oidcConfig.clientSecret = encrypt(oidcConfig.clientSecret);
            providerData.oidcConfig = JSON.stringify(oidcConfig);
          } catch { /* parse error, keep as-is */ }
        }

        // The group new people start in may have been merged into a group of the same name.
        if (providerData.defaultGroupId && groupIdMap.has(providerData.defaultGroupId)) {
          providerData.defaultGroupId = groupIdMap.get(providerData.defaultGroupId)!;
        }

        // Check if a provider with the same providerId but different ID exists
        const existingSso = await tx.ssoProvider.findUnique({ where: { providerId: providerData.providerId } });
        if (existingSso && existingSso.id !== providerData.id) {
          const { id: _id, ...ssoUpdateFields } = providerData;
          await tx.ssoProvider.update({
            where: { id: existingSso.id },
            data: ssoUpdateFields,
          });
        } else {
          await tx.ssoProvider.upsert({
            where: { id: providerData.id },
            create: providerData,
            update: providerData,
          });
        }
      }
    }

    // 9. Restore Statistics (optional)
    if (opts.statistics && data.statistics) {
      if (data.statistics.storageSnapshots) {
        for (const snapshot of data.statistics.storageSnapshots) {
          await tx.storageSnapshot.upsert({
            where: { id: snapshot.id },
            create: snapshot,
            update: snapshot,
          });
        }
      }
      if (data.statistics.executions) {
        for (const execution of data.statistics.executions) {
          const remapped = { ...execution };
          // Verify jobId FK exists, null out if not
          if (remapped.jobId) {
            const jobExists = await tx.job.findUnique({ where: { id: remapped.jobId }, select: { id: true } });
            if (!jobExists) remapped.jobId = null;
          }
          await tx.execution.upsert({
            where: { id: remapped.id },
            create: remapped as any,
            update: remapped as any,
          });
        }
      }
      if (data.statistics.auditLogs) {
        for (const auditLog of data.statistics.auditLogs) {
          const remapped = { ...auditLog };
          // Remap userId if the user was merged into an existing one
          if (remapped.userId && userIdMap.has(remapped.userId)) {
            remapped.userId = userIdMap.get(remapped.userId)!;
          }
          // Verify userId FK exists, null out if not (userId is nullable)
          if (remapped.userId) {
            const userExists = await tx.user.findUnique({ where: { id: remapped.userId }, select: { id: true } });
            if (!userExists) remapped.userId = null;
          }
          await tx.auditLog.upsert({
            where: { id: remapped.id },
            create: remapped,
            update: remapped,
          });
        }
      }
      if (data.statistics.notificationLogs) {
        for (const notifLog of data.statistics.notificationLogs) {
          await tx.notificationLog.upsert({
            where: { id: notifLog.id },
            create: notifLog,
            update: notifLog,
          });
        }
      }
    }
  });
}
