import prisma from "@/lib/prisma";
import { AppConfigurationBackup } from "@/lib/types/config-backup";
import { decryptConfig, encryptConfig, stripSecrets } from "@/lib/crypto";
import packageJson from "../../package.json";
import { Prisma } from "@prisma/client";

export class ConfigService {
  /**
   * Generates the configuration object.
   * @param includeSecrets If true, decrypts DB passwords and includes them.
   */
  async export(includeSecrets: boolean): Promise<AppConfigurationBackup> {
    const settings = await prisma.systemSetting.findMany();
    const adapters = await prisma.adapterConfig.findMany();
    const jobs = await prisma.job.findMany();
    const users = await prisma.user.findMany();
    const groups = await prisma.group.findMany();
    const ssoProviders = await prisma.ssoProvider.findMany();
    const encryptionProfiles = await prisma.encryptionProfile.findMany();

    // Process Adapters
    const processedAdapters = adapters.map((adapter) => {
      let configObj: any = {};
      try {
        configObj = JSON.parse(adapter.config);
      } catch (e) {
        console.warn(`Failed to parse config for adapter ${adapter.id}`, e);
      }

      // 1. Decrypt to get plaintext
      configObj = decryptConfig(configObj);

      // 2. If secrets not requested, strip them
      if (!includeSecrets) {
        configObj = stripSecrets(configObj);
      }

      return {
        ...adapter,
        config: JSON.stringify(configObj),
      };
    });

    // Process SSO Providers
    const processedSsoProviders = ssoProviders.map((provider) => {
      let clientSecret = provider.clientSecret;
      let oidcConfigStr = provider.oidcConfig;

      if (!includeSecrets) {
        // Strip secrets
        if (clientSecret) clientSecret = "";

        if (oidcConfigStr) {
          try {
            const oidcConfig = JSON.parse(oidcConfigStr);
            // Manually strip known secrets from OIDC config
            if (oidcConfig.clientSecret) oidcConfig.clientSecret = "";
            oidcConfigStr = JSON.stringify(oidcConfig);
          } catch (e) {
             // Ignore parse error
          }
        }
      }

      return {
        ...provider,
        clientSecret,
        oidcConfig: oidcConfigStr,
      };
    });

    // Process Encryption Profiles (NEVER export raw secretKey in this flow)
    // We only export metadata. The user must use their Recovery Kit or re-enter keys.
    const processedProfiles = encryptionProfiles.map((p) => {
      const { secretKey, ...rest } = p;
      return rest;
    });

    return {
      metadata: {
        version: packageJson.version,
        exportedAt: new Date().toISOString(),
        includeSecrets,
        sourceType: "SYSTEM",
      },
      settings,
      adapters: processedAdapters,
      jobs,
      users,
      groups,
      ssoProviders: processedSsoProviders,
      encryptionProfiles: processedProfiles,
    };
  }

  /**
   * Restores configuration.
   * @param data The backup object
   * @param strategy 'OVERWRITE' (Currently only strategy supported)
   */
  async import(data: AppConfigurationBackup, strategy: 'OVERWRITE'): Promise<void> {
    if (!data.metadata || !data.metadata.version) {
      throw new Error("Invalid configuration backup: Missing metadata");
    }

    // TODO: Add version compatibility check here if needed in future
    console.log(`Restoring configuration from version ${data.metadata.version}`);

    await prisma.$transaction(async (tx) => {
      // 1. Restore Settings
      for (const setting of data.settings) {
        await tx.systemSetting.upsert({
          where: { key: setting.key },
          create: setting,
          update: setting,
        });
      }

      // 2. Restore Adapters
      for (const adapter of data.adapters) {
        let configObj: any = {};
        try {
          configObj = JSON.parse(adapter.config);
        } catch { /* empty */ }

        // Re-encrypt config with CURRENT system key
        configObj = encryptConfig(configObj);

        await tx.adapterConfig.upsert({
          where: { id: adapter.id },
          create: { ...adapter, config: JSON.stringify(configObj) },
          update: { ...adapter, config: JSON.stringify(configObj) },
        });
      }

      // 3. Restore Encryption Profiles (Metadata only)
      // If profile exists, we don't touch it to avoid overwriting valid keys with missing ones.
      // If it doesn't exist, we create it but without secretKey (will need manual fix or we skip?)
      // Prisma requires secretKey. If we don't have it, we CANNOT create the profile.
      // So we only update metadata if it exists, or skip.
      for (const profile of data.encryptionProfiles) {
         // Check if exists
         const exists = await tx.encryptionProfile.findUnique({ where: { id: profile.id }});
         if (exists) {
            await tx.encryptionProfile.update({
                where: { id: profile.id },
                data: {
                    name: profile.name,
                    description: profile.description,
                    updatedAt: new Date(), // touch update
                }
            });
         } else {
             console.warn(`Skipping Encryption Profile ${profile.name} (${profile.id}) - Secret Key missing in export`);
         }
      }

      // 4. Restore Jobs
      for (const jobItem of data.jobs) {
        const job = { ...jobItem };

        // We need to ensure foreign keys exist.
        // Adapters are restored first. EncryptionProfile might be missing if skipped above.

        if (job.encryptionProfileId) {
            const profileExists = await tx.encryptionProfile.findUnique({ where: { id: job.encryptionProfileId }});
            if (!profileExists) {
                 console.warn(`Removing invalid Encryption Profile ID ${job.encryptionProfileId} from Job ${job.name}`);
                 job.encryptionProfileId = null;
            }
        }

        // Also check if storage/source adapters exist?
        // They should have been restored in step 2.

        await tx.job.upsert({
          where: { id: job.id },
          create: job as any,
          update: job as any,
        });
      }

      // 5. Restore Groups
      for (const group of data.groups) {
        await tx.group.upsert({
          where: { id: group.id },
          create: group,
          update: group,
        });
      }

      // 6. Restore Users
      for (const user of data.users) {
        await tx.user.upsert({
          where: { id: user.id },
          create: user,
          update: user,
        });
      }

      // 7. Restore SSO Providers
      for (const provider of data.ssoProviders) {
        await tx.ssoProvider.upsert({
          where: { id: provider.id },
          create: provider,
          update: provider,
        });
      }
    });
  }
}
