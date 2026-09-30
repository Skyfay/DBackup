import { AppConfigurationBackup, RestoreOptions } from "@/lib/types/config-backup";
import { importConfiguration, type ImportResult } from "./import";
import { parseBackupFile } from "./parse";
import { restoreFromStorage } from "./restore-pipeline";

/**
 * Facade for config backup/restore operations.
 * Implementation is split across `src/services/config/`:
 *  - import.ts          → importConfiguration() (DB transaction with FK remapping)
 *  - parse.ts           → parseBackupFile() helper
 *  - restore-pipeline.ts → restoreFromStorage() background pipeline
 */
export class ConfigService {
  parseBackupFile(filePath: string, metaFilePath?: string, rawKeyHex?: string): Promise<AppConfigurationBackup> {
    return parseBackupFile(filePath, metaFilePath, rawKeyHex);
  }

  import(data: AppConfigurationBackup, strategy: 'OVERWRITE', options?: RestoreOptions): Promise<ImportResult> {
    return importConfiguration(data, strategy, options);
  }

  restoreFromStorage(
    storageConfigId: string,
    file: string,
    decryptionProfileId?: string,
    options?: RestoreOptions,
  ): Promise<string> {
    return restoreFromStorage(storageConfigId, file, decryptionProfileId, options);
  }
}

// Re-export individual functions for direct use (preferred for new code)
export { importConfiguration, parseBackupFile, restoreFromStorage };
export type { ImportResult };
