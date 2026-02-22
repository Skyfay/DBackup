/**
 * Notification Log Service
 *
 * Records every notification sent through any adapter (per-job or system).
 * Provides query methods for the History → Notification Logs tab.
 */

import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { wrapError } from "@/lib/errors";

const log = logger.child({ service: "NotificationLogService" });

// ── Types ──────────────────────────────────────────────────────

export interface NotificationLogEntry {
  eventType: string;
  channelId?: string;
  channelName: string;
  adapterId: string;
  status: "Success" | "Failed";
  title: string;
  message: string;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  color?: string;
  renderedHtml?: string;
  renderedPayload?: string;
  error?: string;
  executionId?: string;
}

export interface NotificationLogQuery {
  page?: number;
  pageSize?: number;
  adapterId?: string;
  eventType?: string;
  status?: string;
}

// ── Write ──────────────────────────────────────────────────────

/**
 * Record a sent (or failed) notification in the log.
 * This should be called from notification dispatch points (runner, system-notification-service).
 */
export async function recordNotificationLog(
  entry: NotificationLogEntry
): Promise<void> {
  try {
    await prisma.notificationLog.create({
      data: {
        eventType: entry.eventType,
        channelId: entry.channelId,
        channelName: entry.channelName,
        adapterId: entry.adapterId,
        status: entry.status,
        title: entry.title,
        message: entry.message,
        fields: entry.fields ? JSON.stringify(entry.fields) : null,
        color: entry.color ?? null,
        renderedHtml: entry.renderedHtml ?? null,
        renderedPayload: entry.renderedPayload ?? null,
        error: entry.error ?? null,
        executionId: entry.executionId ?? null,
      },
    });
  } catch (err) {
    // Never block the caller – log and swallow
    log.error("Failed to record notification log", {}, wrapError(err));
  }
}

// ── Read ───────────────────────────────────────────────────────

/**
 * Fetch notification logs with pagination and optional filters.
 */
export async function getNotificationLogs(query: NotificationLogQuery = {}) {
  const { page = 1, pageSize = 50, adapterId, eventType, status } = query;

  const where: Record<string, unknown> = {};
  if (adapterId) where.adapterId = adapterId;
  if (eventType) where.eventType = eventType;
  if (status) where.status = status;

  const [data, total] = await Promise.all([
    prisma.notificationLog.findMany({
      where,
      orderBy: { sentAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.notificationLog.count({ where }),
  ]);

  return { data, total, page, pageSize };
}

/**
 * Fetch a single notification log entry by ID.
 */
export async function getNotificationLogById(id: string) {
  return prisma.notificationLog.findUnique({ where: { id } });
}
