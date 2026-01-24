"use server";

import { checkPermission } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";
import { auditService, AuditLogFilter } from "@/services/audit-service";

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
  } catch (error: any) {
    console.error("Error fetching audit logs:", error);
    return {
      success: false,
      error: error.message || "Failed to fetch audit logs"
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
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}
