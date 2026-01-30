"use server";

import { checkPermission } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";
import { ConfigService } from "@/services/config-service";
import { AppConfigurationBackup } from "@/lib/types/config-backup";

const configService = new ConfigService();

/**
 * Exports the system configuration.
 * @param includeSecrets Whether to include decrypted secrets.
 */
export async function exportConfigAction(includeSecrets: boolean) {
  await checkPermission(PERMISSIONS.SETTINGS.READ); // Reading settings to export

  try {
    const data = await configService.export(includeSecrets);
    return { success: true, data };
  } catch (error) {
    console.error("Export config error:", error);
    return { success: false, error: "Failed to export configuration" };
  }
}

/**
 * Imports a system configuration.
 * @param data The configuration backup object.
 */
export async function importConfigAction(data: AppConfigurationBackup) {
  await checkPermission(PERMISSIONS.SETTINGS.WRITE); // Writing settings to import

  try {
    await configService.import(data, "OVERWRITE");
    return { success: true };
  } catch (error) {
    console.error("Import config error:", error);
    return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to import configuration"
    };
  }
}
