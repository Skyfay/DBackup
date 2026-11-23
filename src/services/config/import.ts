import prisma from "@/lib/prisma";
import { runAsTenant } from "@/lib/tenant/context";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { AppConfigurationBackup, RestoreOptions } from "@/lib/types/config-backup";
import { logger } from "@/lib/logging/logger";
import { ValidationError } from "@/lib/logging/errors";
import { assertFlatRecords, LEAVES_NO_ACCOUNT } from "./import-shape";
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
 * @param result `requireAccount` for a restore that has to leave an account, the one of the sign-up page
 * @throws ValidationError for a record that holds more than columns, and with `requireAccount` when no account is left
 */
export async function importConfiguration(
  data: AppConfigurationBackup,
  _strategy: 'OVERWRITE',
  options?: RestoreOptions,
  result: { requireAccount?: boolean } = {}
): Promise<ImportResult> {
  if (!data.metadata || !data.metadata.version) {
    throw new Error("Invalid configuration backup: Missing metadata");
  }

  // Before anything is written: a record of the file never reaches the database as a nested write.
  assertFlatRecords(data);
  const opts = options || EVERY_PART;
  svcLog.info("Restoring configuration", { version: data.metadata.version });

  // A file of an earlier version holds one installation, which is the home tenant here.
  return runAsTenant(HOME_TENANT_ID, () => prisma.$transaction(async (tx) => {
    const ctx = createImportContext(tx, data, opts);
    if (opts.settings) await importSettings(ctx);
    if (opts.profiles) await importCredentialProfiles(ctx);
    if (opts.adapters) await importAdapters(ctx);
    if (opts.profiles) await importEncryptionProfiles(ctx);
    if (opts.jobs) await importJobs(ctx);
    if (opts.users) await importUsers(ctx);
    if (opts.sso) await importSsoProviders(ctx);
    if (opts.statistics) await importStatistics(ctx);
    // Decided on what the restore leaves behind, never on what the file said it holds. The throw takes everything back.
    if (result.requireAccount && (await tx.user.count()) === 0) throw new ValidationError(LEAVES_NO_ACCOUNT);

    if (ctx.notes.length > 0) svcLog.warn("Configuration restored with notes", { notes: ctx.notes });
    return { notes: ctx.notes };
  }));
}
