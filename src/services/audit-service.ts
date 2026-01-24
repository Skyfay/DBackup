import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export interface AuditLogFilter {
  page?: number;
  limit?: number;
  userId?: string;
  action?: string;
  resource?: string;
  startDate?: Date;
  endDate?: Date;
  search?: string;
}

export class AuditService {
  /**
   * Create a new audit log entry
   */
  async log(
    userId: string | null,
    action: string,
    resource: string,
    details?: Record<string, any>,
    resourceId?: string
  ) {
    try {
      await prisma.auditLog.create({
        data: {
          userId,
          action,
          resource,
          resourceId,
          details: details ? JSON.stringify(details) : undefined,
        },
      });
    } catch (error) {
      // We don't want audit logging to crash the application, but we should log the error
      console.error("Failed to create audit log:", error);
    }
  }

  /**
   * Retrieve paginated audit logs
   */
  async getLogs(filter: AuditLogFilter = {}) {
    const { page = 1, limit = 20, userId, action, resource, startDate, endDate, search } = filter;
    const skip = (page - 1) * limit;

    const where: Prisma.AuditLogWhereInput = {};

    if (userId) where.userId = userId;
    if (action) where.action = action;
    if (resource) where.resource = resource;

    if (search) {
        where.OR = [
            { resourceId: { contains: search } },
            // Note: Searching detail JSON string is database dependant.
            // For reliable search we stick to resourceId and user info if we can JOIN filter (Prisma supports relation filters)
            { user: { name: { contains: search } } },
            { user: { email: { contains: search } } }
        ];
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) where.createdAt.lte = endDate;
    }

    // Execute query and count in parallel
    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        take: limit,
        skip,
        orderBy: { createdAt: "desc" },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
          },
        },
      }),
      prisma.auditLog.count({ where }),
    ]);

    return {
      logs,
      pagination: {
        total,
        pages: Math.ceil(total / limit),
        page,
        limit,
      },
    };
  }

  /**
   * Get distinct values and counts for filters based on current selection
   */
  async getFilterStats(filter: Omit<AuditLogFilter, "page" | "limit"> = {}) {
     const { userId, startDate, endDate, search } = filter;

     // Base where clause (common filters)
     const baseWhere: Prisma.AuditLogWhereInput = {};
     if (userId) baseWhere.userId = userId;
     if (search) {
        baseWhere.OR = [
            { resourceId: { contains: search } },
            { user: { name: { contains: search } } },
            { user: { email: { contains: search } } }
        ];
     }
     if (startDate || endDate) {
        baseWhere.createdAt = {};
        if (startDate) baseWhere.createdAt.gte = startDate;
        if (endDate) baseWhere.createdAt.lte = endDate;
     }

     // 1. Get Actions (filtered by Resource if set)
     const actionWhere = { ...baseWhere };
     if (filter.resource) actionWhere.resource = filter.resource;
     // Add search filter if present (assuming we add search later)

     const actions = await prisma.auditLog.groupBy({
         by: ['action'],
         where: actionWhere,
         _count: {
             action: true
         }
     });

     // 2. Get Resources (filtered by Action if set)
     const resourceWhere = { ...baseWhere };
     if (filter.action) resourceWhere.action = filter.action;

     const resources = await prisma.auditLog.groupBy({
        by: ['resource'],
        where: resourceWhere,
        _count: {
            resource: true
        }
    });

    return {
        actions: actions.map(a => ({ value: a.action, count: a._count.action })),
        resources: resources.map(r => ({ value: r.resource, count: r._count.resource }))
    };
  }

  /**
   * Clean up old audit logs
   */
  async cleanOldLogs(retentionDays: number) {
    const dateThreshold = new Date();
    dateThreshold.setDate(dateThreshold.getDate() - retentionDays);

    return prisma.auditLog.deleteMany({
      where: {
        createdAt: {
          lt: dateThreshold,
        },
      },
    });
  }
}

export const auditService = new AuditService();
