import prisma from "@/lib/prisma";
import { AppConfigurationBackup, RestoreOptions } from "@/lib/types/config-backup";
import { decryptConfig, encryptConfig, stripSecrets, decrypt, encrypt } from "@/lib/crypto";
import packageJson from "../../package.json";
import { registry } from "@/lib/core/registry";
import { StorageAdapter } from "@/lib/core/interfaces";
import { createDecryptionStream } from "@/lib/crypto-stream";
import { createGunzip } from "zlib";
import { createReadStream, promises as fs } from "fs";
import { getTempDir } from "@/lib/temp-dir";
import path from "path";
import { Readable, Transform } from "stream";
import { getProfileMasterKey, getEncryptionProfiles } from "@/services/encryption-service";
import { pipeline } from "stream/promises";
import { logger } from "@/lib/logger";
import { wrapError } from "@/lib/errors";

const svcLog = logger.child({ service: "ConfigService" });

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
      } catch (e: unknown) {
        svcLog.warn("Failed to parse config for adapter", { adapterId: adapter.id }, wrapError(e));
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
             } catch (e: unknown) {
                 svcLog.error("Failed to decrypt profile key for export", { profileId: p.id }, wrapError(e));
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
   * Parses a raw backup file (potentially encrypted/compressed) into the JSON object.
   * Helper for Offline Config Restore.
   */
  async parseBackupFile(filePath: string, metaFilePath?: string): Promise<AppConfigurationBackup> {
      let iv: Buffer | undefined;
      let authTag: Buffer | undefined;
      let profileId: string | undefined;
      let isCompressed = false;
      let isEncrypted = false;

      // 1. Try to read metadata if provided
      if (metaFilePath && await fs
          .stat(metaFilePath)
          .then(() => true)
          .catch(() => false)) {
          try {
              const metaContent = await fs.readFile(metaFilePath, 'utf-8');
              const meta = JSON.parse(metaContent);

              // 1. Detect Encryption Metadata (Standard vs Flat)
              if (meta.encryption && typeof meta.encryption === 'object' && meta.encryption.enabled) {
                  // Standard Nested Format
                  if (meta.encryption.iv) iv = Buffer.from(meta.encryption.iv, 'hex');
                  if (meta.encryption.authTag) authTag = Buffer.from(meta.encryption.authTag, 'hex');
                  if (meta.encryption.profileId) profileId = meta.encryption.profileId;
                  isEncrypted = true;
              } else {
                  // Legacy Flat Format
                  if (meta.iv) iv = Buffer.from(meta.iv, 'hex');
                  if (meta.authTag) authTag = Buffer.from(meta.authTag, 'hex');
                  profileId = meta.encryptionProfileId;
                  if (meta.encryption && meta.encryption !== 'NONE') isEncrypted = true;
              }

              if (meta.compression === 'GZIP') isCompressed = true;
          } catch (e: unknown) {
              svcLog.warn("Failed to parse metadata file", {}, wrapError(e));
          }
      } else {
          // Fallback: Guess by extension
          if (filePath.endsWith('.gz') || filePath.endsWith('.br')) isCompressed = await this.detectCompression(filePath);
      }

      // Auto-detect extension based fallback if meta failed/missing
       if (!isCompressed && filePath.endsWith('.gz')) isCompressed = true;
       if (!isEncrypted && filePath.endsWith('.enc')) isEncrypted = true;

      const streams: (Readable | Transform)[] = [createReadStream(filePath)];

      if (isEncrypted) {
          if (!iv || !authTag || !profileId) {
             throw new Error("Encrypted backup detected but metadata (IV/AuthTag/Profile) is missing. Please upload the .meta.json file as well.");
          }

           // Get Key
           const key = await getProfileMasterKey(profileId).catch(() => null);

           // Smart Recovery: If key not found (e.g. ID mismatch after new install), try finding ANY profile that works?
           // AES-GCM requires the key to init. If we pick wrong key, setAuthTag matches fine, until final() throws.
           // Implementing a loop here is tricky with streams (can't rewind easily).
           // Strategy: If lookup fails, fail. User works around by editing meta or ensuring profile matches.

           if (!key) {
               // Fallback: Try to find a profile with the same NAME?
               // ... (Skipping complex heuristics for now to keep it deterministic)
               throw new Error(`Encryption Profile ${profileId} not found. Please ensure the relevant Encryption Profile is restored first.`);
           }

           streams.push(createDecryptionStream(key, iv, authTag));
      }

      if (isCompressed) {
          streams.push(createGunzip());
      }

      // Collect stream to buffer
      let jsonString = '';
      const collector = new Transform({
          transform(chunk, encoding, callback) {
              jsonString += chunk.toString();
              callback();
          }
      });
      streams.push(collector);

      try {
        // @ts-expect-error Pipeline argument spread issues
        await pipeline(...streams);
        return JSON.parse(jsonString) as AppConfigurationBackup;
      } catch (e: unknown) {
          const message = e instanceof Error ? e.message : String(e);
          throw new Error(`Failed to process backup file: ${message}`);
      }
  }

  // Helper (Placeholder for real detection if needed, mostly extension is enough)
  private async detectCompression(file: string): Promise<boolean> {
      return file.endsWith('.gz');
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
                    svcLog.warn("Skipping encryption profile - secret key missing in export", { profileId: profile.id, name: profile.name });
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
                    svcLog.warn("Removing invalid encryption profile from job", { encryptionProfileId: job.encryptionProfileId, jobName: job.name });
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
        .catch(err => svcLog.error("Restore pipeline logic error (uncaught)", {}, wrapError(err)));

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
          const tempDir = getTempDir();
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

          // Normalize Metadata for Logic
          const metaEncryption = meta?.encryption && typeof meta.encryption === 'object' ? meta.encryption : null;

          const isEncrypted = filePath.endsWith(".enc") ||
                              (metaEncryption && metaEncryption.enabled) ||
                              (meta && meta.iv);

          // Decryption
          if (isEncrypted) {
              log("File detected as encrypted. Preparing decryption...");

              if (!decryptionProfileId) {
                  // Try to find profile ID from meta
                  if (metaEncryption?.profileId) {
                       decryptionProfileId = metaEncryption.profileId;
                  } else if (meta?.encryptionProfileId) {
                       decryptionProfileId = meta.encryptionProfileId;
                  }

                  if (decryptionProfileId) {
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
                  // The runner stores IV/AuthTag in .meta.json.

                  // Support both Flat (Old) and Nested (New) formats
                  let ivHex = meta?.iv;
                  let authTagHex = meta?.authTag;

                  if (meta?.encryption && typeof meta.encryption === 'object') {
                      if (meta.encryption.iv) ivHex = meta.encryption.iv;
                      if (meta.encryption.authTag) authTagHex = meta.encryption.authTag;
                  }

                  if (!ivHex || !authTagHex) {
                      throw new Error("Missing encryption metadata (IV/AuthTag). Cannot decrypt.");
                  }

                  const iv = Buffer.from(ivHex, 'hex');
                  const authTag = Buffer.from(authTagHex, 'hex');

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

      } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          log(`Restoration failed: ${message}`, "error");
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
