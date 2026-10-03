import prisma from "@/lib/prisma";
import { AppConfigurationBackup, RestoreOptions } from "@/lib/types/config-backup";
import { logger } from "@/lib/logging/logger";
import { createImportContext, type ImportResult } from "./import-context";
import { importAdapters, importCredentialProfiles, importEncryptionProfiles, importSettings } from "./import-connections";
import { importStatistics } from "./import-history";
import { importJobs } from "./import-jobs";
import { importSsoProviders, importUsers } from "./import-users";

export type { ImportResult } from "./import-context";

const svcLog = logger.child({ service: "ConfigService" });

/** Every part but the history, when the caller picks none. */
const EVERY_PART: RestoreOptions = {
  settings: true,
  adapters: true,
  jobs: true,
  users: true,
  sso: true,
  profiles: true,
  statistics: false,
};

/**
 * Restores configuration into the database from a parsed backup object, in the order the links
 * need: logins before the connections that sign in with them, connections and keys before jobs,
 * groups before users. A record that merges into one of the same name keeps the id it has here and
 * every link follows it. A link to what is neither in the file nor here is dropped, and the result
 * says what that changed.
 *
 * @param data The backup object
 * @param _strategy 'OVERWRITE' (Currently only strategy supported)
 * @param options Select which parts to restore
 */
export async function importConfiguration(
  data: AppConfigurationBackup,
  _strategy: 'OVERWRITE',
  options?: RestoreOptions
): Promise<ImportResult> {
  if (!data.metadata || !data.metadata.version) {
    throw new Error("Invalid configuration backup: Missing metadata");
  }

  const opts = options || EVERY_PART;
  svcLog.info("Restoring configuration", { version: data.metadata.version });

  return prisma.$transaction(async (tx) => {
    const ctx = createImportContext(tx, data, opts);
    if (opts.settings) await importSettings(ctx);
    if (opts.profiles) await importCredentialProfiles(ctx);
    if (opts.adapters) await importAdapters(ctx);
    if (opts.profiles) await importEncryptionProfiles(ctx);
    if (opts.jobs) await importJobs(ctx);
    if (opts.users) await importUsers(ctx);
    if (opts.sso) await importSsoProviders(ctx);
    if (opts.statistics) await importStatistics(ctx);

    if (ctx.notes.length > 0) svcLog.warn("Configuration restored with notes", { notes: ctx.notes });
    return { notes: ctx.notes };
  });
}
