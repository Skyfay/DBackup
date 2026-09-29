import { headers } from "next/headers";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { clientAddress } from "@/lib/core/client-address";
import type { AuthContext } from "@/lib/auth/access-control";

const log = logger.child({ service: "AuditService" });

/**
 * Where an entry comes from beyond the user: the API key the request came with, and the address
 * and browser of the request. Left out, the address and the browser are read from the request
 * the entry is written in, and stay empty outside one, like in a scheduled task.
 */
export interface AuditOrigin {
  apiKeyId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** The address and browser of the request being handled, nothing outside a request. */
async function requestOrigin(): Promise<{ ipAddress: string | null; userAgent: string | null }> {
  try {
    const list = await headers();
    return { ipAddress: clientAddress(list), userAgent: list.get("user-agent") };
  } catch {
    return { ipAddress: null, userAgent: null };
  }
}

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);

export class AuditService {
  /**
   * Writes an entry. It keeps the name of the user and of the API key as they are now, so the
   * entry still names them after they are deleted or renamed. Never throws: a failed write is
   * logged, the action it records goes on.
   */
  async log(
    userId: string | null,
    action: string,
    resource: string,
    details?: Record<string, unknown>,
    resourceId?: string,
    origin: AuditOrigin = {}
  ) {
    try {
      const fromRequest = origin.ipAddress === undefined || origin.userAgent === undefined ? await requestOrigin() : null;
      const ipAddress = origin.ipAddress ?? text(details?.ipAddress) ?? fromRequest?.ipAddress ?? null;
      const userAgent = origin.userAgent ?? text(details?.userAgent) ?? fromRequest?.userAgent ?? null;
      const apiKeyId = origin.apiKeyId ?? null;

      const [user, apiKey] = await Promise.all([
        userId ? prisma.user.findUnique({ where: { id: userId }, select: { name: true } }) : null,
        apiKeyId ? prisma.apiKey.findUnique({ where: { id: apiKeyId }, select: { name: true } }) : null,
      ]);

      await prisma.auditLog.create({
        data: {
          userId,
          actorName: user?.name ?? null,
          apiKeyId,
          apiKeyName: apiKey?.name ?? null,
          action,
          resource,
          resourceId,
          details: details ? JSON.stringify(details) : undefined,
          ipAddress,
          userAgent,
        },
      });
    } catch (error) {
      // We don't want audit logging to crash the application, but we should log the error
      log.error("Failed to create audit log", { action, resource, userId }, wrapError(error));
    }
  }

  /**
   * Writes an entry for the caller of an API route, naming the API key when the request came with
   * one. The key acts as its owner, so the entry belongs to the owner too.
   */
  async logFor(
    ctx: Pick<AuthContext, "userId" | "authMethod" | "apiKeyId">,
    action: string,
    resource: string,
    details?: Record<string, unknown>,
    resourceId?: string
  ) {
    return this.log(ctx.userId, action, resource, details, resourceId, {
      apiKeyId: ctx.authMethod === "apikey" ? ctx.apiKeyId ?? null : null,
    });
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
