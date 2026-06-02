import { AppConfigurationBackup, RestoreOptions } from "@/lib/types/config-backup";
import { exportConfiguration, ExportOptions } from "./export";
import { importConfiguration } from "./import";
import { parseBackupFile } from "./parse";
import { restoreFromStorage } from "./restore-pipeline";

/**
 * Facade for config backup/restore operations.
 * Implementation is split across `src/services/config/`:
 *  - export.ts          → exportConfiguration()
 *  - import.ts          → importConfiguration() (DB transaction with FK remapping)
 *  - parse.ts           → parseBackupFile() + tryDecryptFile() helpers
 *  - restore-pipeline.ts → restoreFromStorage() background pipeline
 */
export class ConfigService {
  export(optionsOrIncludeSecrets: boolean | ExportOptions): Promise<AppConfigurationBackup> {
    return exportConfiguration(optionsOrIncludeSecrets);
  }

  parseBackupFile(filePath: string, metaFilePath?: string, rawKeyHex?: string): Promise<AppConfigurationBackup> {
    return parseBackupFile(filePath, metaFilePath, rawKeyHex);
  }

  import(data: AppConfigurationBackup, strategy: 'OVERWRITE', options?: RestoreOptions): Promise<void> {
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
export { exportConfiguration, importConfiguration, parseBackupFile, restoreFromStorage };
export type { ExportOptions };
