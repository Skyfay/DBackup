/**
 * Notification Log Service
 *
 * Records every notification sent through any adapter (per-job or system).
 * Provides query methods for the History → Notification Logs tab.
 */

import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";

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
  /** One value or several, matched as any-of. */
  adapterId?: string | string[];
  eventType?: string | string[];
  status?: string | string[];
  executionId?: string;
  /** Free text, matched against the notification title. */
  search?: string;
}

export const NOTIFICATION_LOG_MAX_PAGE_SIZE = 100;
export const NOTIFICATION_LOG_DEFAULT_PAGE_SIZE = 50;

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

/** A single value stays an equality match, several become an any-of match. */
function toList(value: string | string[] | undefined): string | { in: string[] } | undefined {
  if (value === undefined) return undefined;
  const list = (Array.isArray(value) ? value : [value]).map((v) => v.trim()).filter(Boolean);
  if (list.length === 0) return undefined;
  return list.length === 1 ? list[0] : { in: list };
}

function normalizePageSize(value: number | undefined): number {
  if (!value || !Number.isFinite(value) || value < 1) return NOTIFICATION_LOG_DEFAULT_PAGE_SIZE;
  return Math.min(Math.floor(value), NOTIFICATION_LOG_MAX_PAGE_SIZE);
}

/** Prisma `where` for a query. Exported for tests. */
export function buildNotificationLogWhere(query: NotificationLogQuery): Prisma.NotificationLogWhereInput {
  const { adapterId, eventType, status, executionId, search } = query;
  const where: Prisma.NotificationLogWhereInput = {};
  const adapterIds = toList(adapterId);
  if (adapterIds) where.adapterId = adapterIds;
  const eventTypes = toList(eventType);
  if (eventTypes) where.eventType = eventTypes;
  const statuses = toList(status);
  if (statuses) where.status = statuses;
  if (executionId) where.executionId = executionId;
  const term = search?.trim();
  if (term) where.title = { contains: term };
  return where;
}

/** Counts per value for the faceted filters on the Notification Logs tab. */
export interface NotificationLogFacets {
  adapterId: Record<string, number>;
  status: Record<string, number>;
}

/** Per-option counts. Each column honours every other active filter but not its own. */
export async function getNotificationLogFacets(query: NotificationLogQuery = {}): Promise<NotificationLogFacets> {
  const count = async (column: "adapterId" | "status") => {
    const where = buildNotificationLogWhere({ ...query, [column]: undefined });
    const groups = await prisma.notificationLog.groupBy({ by: [column], where, _count: { _all: true } });
    const result: Record<string, number> = {};
    for (const g of groups) result[g[column]] = g._count._all;
    return result;
  };
  const [adapterId, status] = await Promise.all([count("adapterId"), count("status")]);
  return { adapterId, status };
}

/**
 * Fetch notification logs with pagination and optional filters.
 */
export async function getNotificationLogs(query: NotificationLogQuery = {}) {
  const page = query.page && query.page > 0 ? Math.floor(query.page) : 1;
  const pageSize = normalizePageSize(query.pageSize);
  const where = buildNotificationLogWhere(query);

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
