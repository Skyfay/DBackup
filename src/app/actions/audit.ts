"use server";

import { checkPermission } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";
import { auditService, AuditLogFilter } from "@/services/audit-service";
import { logger } from "@/lib/logger";
import { wrapError, getErrorMessage } from "@/lib/errors";

const log = logger.child({ action: "audit" });

export async function getAuditLogs(
  page: number = 1,
  limit: number = 20,
  filters: Omit<AuditLogFilter, "page" | "limit"> = {}
) {
  try {
    await checkPermission(PERMISSIONS.AUDIT.READ);

    const result = await auditService.getLogs({
      page,
      limit,
      ...filters,
    });

    return { success: true, data: result };
  } catch (error: unknown) {
    log.error("Error fetching audit logs", {}, wrapError(error));
    return {
      success: false,
      error: getErrorMessage(error) || "Failed to fetch audit logs"
    };
  }
}

export async function getAuditFilterStats(
    filters: Omit<AuditLogFilter, "page" | "limit"> = {}
) {
    try {
        await checkPermission(PERMISSIONS.AUDIT.READ); // Same permission
        const stats = await auditService.getFilterStats(filters);
        return { success: true, data: stats };
    } catch (error: unknown) {
        return { success: false, error: getErrorMessage(error) };
    }
}
