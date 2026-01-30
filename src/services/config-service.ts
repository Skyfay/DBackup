import prisma from "@/lib/prisma";
import { AppConfigurationBackup, RestoreOptions } from "@/lib/types/config-backup";
import { decryptConfig, encryptConfig, stripSecrets, decrypt, encrypt } from "@/lib/crypto";
import packageJson from "../../package.json";
import { registry } from "@/lib/core/registry";
import { StorageAdapter } from "@/lib/core/interfaces";
import { createDecryptionStream } from "@/lib/crypto-stream";
import { createGunzip } from "zlib";
import { createReadStream, promises as fs } from "fs";
import path from "path";
import os from "os";
import { Readable } from "stream";
import { getProfileMasterKey, getEncryptionProfiles } from "@/services/encryption-service";

export class ConfigService {
  /**
   * Generates the configuration object.
   * @param includeSecrets If true, decrypts DB passwords and includes them.
   */
  async export(includeSecrets: boolean): Promise<AppConfigurationBackup> {
    const settings = await prisma.systemSetting.findMany();
    const adapters = await prisma.adapterConfig.findMany();
    const jobs = await prisma.job.findMany();
    const users = await prisma.user.findMany({ include: { accounts: true } });
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
          } catch {
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

    // Process Users (Strip secrets from accounts if needed)
    const processedUsers = users.map(user => {
         if (!includeSecrets) {
             const safeAccounts = user.accounts.map(acc => ({
                 ...acc,
                 password: null,
                 accessToken: null,
                 refreshToken: null,
                 idToken: null
             }));
             return { ...user, accounts: safeAccounts };
         }
         return user;
    });

    // Process Encryption Profiles
    const processedProfiles = await Promise.all(encryptionProfiles.map(async (p) => {
        if (includeSecrets) {
             // If secrets are requested, we assume the output transport is secure (e.g. Encrypted Backup).
             // We decrypt the system-encrypted key and export it as plaintext in the JSON.
             // This allows for full restore (including keys) on a new system.
             try {
                const plainKey = decrypt(p.secretKey);
                // Return it so it ends up in the JSON
                return { ...p, secretKey: plainKey };
             } catch {
                 console.error("Failed to decrypt profile key for export", p.id);
                 // eslint-disable-next-line @typescript-eslint/no-unused-vars
                 const { secretKey, ...rest } = p;
                 return rest;
             }
        } else {
             // eslint-disable-next-line @typescript-eslint/no-unused-vars
             const { secretKey, ...rest } = p;
             return rest;
        }
    }));

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
      users: processedUsers,
      groups,
      ssoProviders: processedSsoProviders,
      encryptionProfiles: processedProfiles,
    };
  }

  /**
   * Restores configuration.
   * @param data The backup object
   * @param _strategy 'OVERWRITE' (Currently only strategy supported)
   * @param options Select which parts to restore
   */
  async import(data: AppConfigurationBackup, _strategy: 'OVERWRITE', options?: RestoreOptions): Promise<void> {
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
        profiles: true
    };

    // TODO: Add version compatibility check here if needed in future
    console.log(`Restoring configuration from version ${data.metadata.version}`);

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

      // 2. Restore Adapters
      if (opts.adapters) {
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
      }

      // 3. Restore Encryption Profiles (Metadata only)
      if (opts.profiles) {
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
                // @ts-expect-error Types might miss secretKey depending on Omit usage
                if (profile.secretKey) {
                    // Start fresh with provided key
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
                    console.warn(`Skipping Encryption Profile ${profile.name} (${profile.id}) - Secret Key missing in export`);
                }
            }
        }
      }

      // 4. Restore Jobs
      if (opts.jobs) {
        for (const jobItem of data.jobs) {
            const job = { ...jobItem };

            // Check Encryption Profile Dependency
            if (job.encryptionProfileId) {
                // If profiles were NOT restored, we must check if they exist in DB
                const profileExists = await tx.encryptionProfile.findUnique({ where: { id: job.encryptionProfileId }});
                if (!profileExists) {
                    console.warn(`Removing invalid Encryption Profile ID ${job.encryptionProfileId} from Job ${job.name}`);
                    job.encryptionProfileId = null;
                }
            }

            await tx.job.upsert({
            where: { id: job.id },
            create: job as any,
            update: job as any,
            });
        }
      }

      // 5. Restore Groups
      if (opts.users) {
        for (const group of data.groups) {
            await tx.group.upsert({
            where: { id: group.id },
            create: group,
            update: group,
            });
        }


      // 6. Restore Users
        for (const user of data.users) {
            // Detach accounts to handle separately
            const { accounts, ...userFields } = user;

            await tx.user.upsert({
                where: { id: user.id },
                create: userFields,
                update: userFields,
            });

            if (accounts && Array.isArray(accounts)) {
                 for (const account of accounts) {
                     await tx.account.upsert({
                         where: { id: account.id },
                         create: account,
                         update: account
                     });
                 }
            }
        }
      }

      // 7. Restore SSO Providers
      if (opts.sso) {
        for (const provider of data.ssoProviders) {
            await tx.ssoProvider.upsert({
            where: { id: provider.id },
            create: provider,
            update: provider,
            });
        }
      }
    });
  }


  /**
   * Orchestrates the restoration from a storage provider, including download, decryption, and decompression.
   * Runs as a background task via the Execution log.
   */
  async restoreFromStorage(
    storageConfigId: string,
    file: string,
    decryptionProfileId?: string,
    options?: RestoreOptions
  ): Promise<string> {

    // 1. Create Execution Record
    const execution = await prisma.execution.create({
      data: {
        type: "System Restore",
        status: "Running",
        startedAt: new Date(),
        logs: JSON.stringify([{
            timestamp: new Date().toISOString(),
            level: "info",
            message: "Starting system configuration restore..."
        }]),
        metadata: JSON.stringify({ file, storageConfigId })
      }
    });

    // 2. Start Background Process
    this.runRestorePipeline(execution.id, storageConfigId, file, decryptionProfileId, options)
        .catch(err => console.error("Restore Pipeline Logic Error (uncaught):", err));

    return execution.id;
  }

  private async runRestorePipeline(
      executionId: string,
      storageConfigId: string,
      filePath: string,
      decryptionProfileId?: string,
      options?: RestoreOptions
  ) {
      const logs: any[] = [];
      const log = (msg: string, level = "info") => {
          logs.push({ timestamp: new Date().toISOString(), level, message: msg });
          // Flush logs to DB periodically (or at end/error) for live updates
          // For simplicity here, we assume partial updates or end update.
          // In a real runner, we'd debounce this.
          prisma.execution.update({
              where: { id: executionId },
              data: { logs: JSON.stringify(logs) }
          }).catch(() => {});
      };

      try {
          const tempDir = os.tmpdir();
          const downloadPath = path.join(tempDir, `restore-${executionId}-${path.basename(filePath)}`);

          log(`Initializing restore from ${filePath}`);

          // Fetch Storage Config
          const storageConfig = await prisma.adapterConfig.findUnique({ where: { id: storageConfigId } });
          if (!storageConfig) throw new Error("Storage adapter not found");

          const adapter = registry.get(storageConfig.adapterId) as StorageAdapter;
          const config = decryptConfig(JSON.parse(storageConfig.config));

          // Download
          log("Downloading backup file...");
          await adapter.download(config, filePath, downloadPath);

          // Determine pipeline based on extension or metadata
          // We assume standard ending: .json.gz.enc, .json.gz, .json

          // Check Metadata if available (sidecar)
          let meta: any = null;
          try {
              if (adapter.read) {
                  const metaContent = await adapter.read(config, filePath + ".meta.json");
                  if (metaContent) meta = JSON.parse(metaContent);
              }
          } catch {
              log("Warning: Could not read metadata sidecar. Proceeding with filename detection.", "warn");
          }

          let currentStream: Readable = createReadStream(downloadPath);

          // Decryption
          if (filePath.endsWith(".enc") || (meta && meta.iv && meta.authTag)) {
              log("File detected as encrypted. Preparing decryption...");

              if (!decryptionProfileId) {
                  // Try to find profile ID from meta
                  if (meta && meta.encryptionProfileId) {
                       decryptionProfileId = meta.encryptionProfileId;
                       log(`Using Encryption Profile ID from metadata: ${decryptionProfileId}`);
                  } else {
                       throw new Error("File is encrypted but no Encryption Profile provided and metadata is missing encryptionProfileId.");
                  }
              }

              if (decryptionProfileId) {
                  let key: Buffer;
                  try {
                      // Try finding the profile normally first
                      const profile = await prisma.encryptionProfile.findUnique({ where: { id: decryptionProfileId } });
                      if (!profile) throw new Error("Encryption profile not found");
                      const decryptedKeyHex = decrypt(profile.secretKey);
                      key = Buffer.from(decryptedKeyHex, 'hex');
                  } catch (_err) {
                      log(`Profile ${decryptionProfileId} not found/accessible. Attempting Smart Recovery...`, "warn");

                      // --- SMART RECOVERY LOGIC ---
                      const allProfiles = await getEncryptionProfiles();
                      let foundKey: Buffer | null = null;
                      let matchProfileName = "";

                      const isCompressed = filePath.includes(".gz") || (meta && String(meta.compression).toUpperCase() === 'GZIP');

                      // Helper: Test if candidate key decrypts successfully
                      const checkKeyCandidate = async (candidateKey: Buffer): Promise<boolean> => {
                          return new Promise((resolve) => {
                                if (!meta || !meta.iv || !meta.authTag) { resolve(false); return; }
                                const iv = Buffer.from(meta.iv, 'hex');
                                const authTag = Buffer.from(meta.authTag, 'hex');

                                try {
                                    const decipher = createDecryptionStream(candidateKey, iv, authTag);
                                    const input = createReadStream(downloadPath, { start: 0, end: 1024 }); // Head check

                                    let isValid = true;

                                    if (isCompressed) {
                                        const gunzip = createGunzip();
                                        decipher.on('error', () => { isValid = false; resolve(false); });
                                        gunzip.on('error', () => { isValid = false; resolve(false); });
                                        gunzip.on('data', () => { resolve(true); input.destroy(); }); // Success
                                        input.pipe(decipher).pipe(gunzip);
                                    } else {
                                        decipher.on('error', () => { isValid = false; resolve(false); });
                                        decipher.on('data', (chunk: Buffer) => {
                                            const str = chunk.toString('utf8').trim();
                                            // JSON check
                                            if (str.startsWith('{') || str.startsWith('[')) { resolve(true); }
                                            else { resolve(false); }
                                            input.destroy();
                                        });
                                        input.pipe(decipher);
                                    }

                                    input.on('end', () => { if (isValid) resolve(true); });
                                } catch { resolve(false); }
                          });
                      };

                      for (const profile of allProfiles) {
                          try {
                              const candidateKey = await getProfileMasterKey(profile.id);
                              if (await checkKeyCandidate(candidateKey)) {
                                  foundKey = candidateKey;
                                  matchProfileName = profile.name;
                                  break;
                              }
                          } catch {}
                      }

                      if (foundKey) {
                          log(`Smart Recovery: Unlocked using profile '${matchProfileName}'`, "success");
                          key = foundKey;
                      } else {
                          throw new Error("Encryption profile missing and no other key worked.");
                      }
                  }

                  // If we have meta, use it. If not, we can't reliably decrypt GCM without IV/AuthTag
                  // The runner stores IV/AuthTag in .meta.json. It is NOT prepended to the file in our specific implementation (src/lib/runner/config-runner.ts check needed?)
                  // config-runner writes sidecar. So we MUST have the sidecar content.
                  if (!meta || !meta.iv || !meta.authTag) {
                      throw new Error("Missing encryption metadata (IV/AuthTag). Cannot decrypt.");
                  }

                  const iv = Buffer.from(meta.iv, 'hex');
                  const authTag = Buffer.from(meta.authTag, 'hex');

                  const decipher = createDecryptionStream(key, iv, authTag);
                  currentStream = currentStream.pipe(decipher);
                  log("Decryption stream attached.");
              }
          }

          // Decompression
          if (filePath.includes(".gz") || (meta && meta.compression === 'gzip')) {
              log("File detected as compressed. Attaching gunzip...");
              const gunzip = createGunzip();
              currentStream = currentStream.pipe(gunzip);
          }

          // We need to read the stream into a string/buffer to parse JSON
          // Ideally we stream-parse, but config is small enough to fit in memory
          log("Reading and parsing configuration data...");

          const content = await new Promise<string>((resolve, reject) => {
              const chunks: any[] = [];
              currentStream.on("data", (chunk) => chunks.push(chunk));
              currentStream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
              currentStream.on("error", (err) => reject(err));
          });

          // Parse
          let backupData: AppConfigurationBackup;
          try {
              backupData = JSON.parse(content);
          } catch {
              throw new Error("Failed to parse configuration JSON. File might be currupt or decryption failed.");
          }

          // Validation
          if (!backupData.metadata || backupData.metadata.sourceType !== "SYSTEM") {
               log("Warning: Backup metadata does not explicitly state sourceType='SYSTEM'. Proceeding with caution...", "warn");
          }

          // Execute Import
          log("Applying configuration settings (Database Transaction)...");
          await this.import(backupData, "OVERWRITE", options);

          log("Restoration completed successfully.", "info");

          await prisma.execution.update({
              where: { id: executionId },
              data: {
                  status: "Success",
                  endedAt: new Date(),
                  logs: JSON.stringify(logs)
              }
          });

          // Cleanup
          try {
              await fs.unlink(downloadPath);
          } catch {}

      } catch (err: any) {
          log(`Restoration failed: ${err.message}`, "error");
           await prisma.execution.update({
              where: { id: executionId },
              data: {
                  status: "Failed",
                  endedAt: new Date(),
                  logs: JSON.stringify(logs)
              }
          });
      }
  }
}
