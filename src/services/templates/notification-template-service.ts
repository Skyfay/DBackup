import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { runBulk, type BulkResult } from "@/lib/core/bulk";
import { logger } from "@/lib/logging/logger";
import { NotFoundError, ServiceError } from "@/lib/logging/errors";
import { invalidateDashboardCache } from "@/services/dashboard/cache";

const log = logger.child({ service: "NotificationTemplateService" });

export interface NotificationTemplateChannelInput {
  configId: string;
  events: string; // Pipe-separated: "SUCCESS|PARTIAL|FAILED"
}

/** A channel of a template as it may leave this service: which connection it is, never its config. */
export interface TemplateChannelConnection {
  id: string;
  name: string;
  adapterId: string;
}

/**
 * The channels of every template this service returns. The results reach the browser through the
 * Server Actions, so the config of a channel stays out, which holds webhook URLs, tokens and
 * passwords, even in their encrypted form.
 */
const withChannels = {
  channels: { include: { config: { select: { id: true, name: true, adapterId: true } } } },
} satisfies Prisma.NotificationTemplateInclude;

export async function getNotificationTemplates() {
  return prisma.notificationTemplate.findMany({
    include: {
      ...withChannels,
      _count: { select: { jobs: true } },
    },
    orderBy: { name: "asc" },
  });
}

export async function getNotificationTemplateById(id: string) {
  const template = await prisma.notificationTemplate.findUnique({
    where: { id },
    include: withChannels,
  });
  if (!template) throw new NotFoundError("NotificationTemplate", id);
  return template;
}

export async function createNotificationTemplate(input: {
  name: string;
  description?: string;
  channels: NotificationTemplateChannelInput[];
  isDefault?: boolean;
}) {
  const existing = await prisma.notificationTemplate.findUnique({
    where: { name: input.name },
  });
  if (existing) {
    throw new ServiceError(
      "NotificationTemplateService",
      "createNotificationTemplate",
      `A notification template named "${input.name}" already exists.`
    );
  }

  if (input.isDefault) {
    await prisma.notificationTemplate.updateMany({
      where: { isDefault: true },
      data: { isDefault: false },
    });
  }

  const template = await prisma.notificationTemplate.create({
    data: {
      name: input.name,
      description: input.description,
      isDefault: input.isDefault ?? false,
      channels: {
        create: input.channels.map((ch) => ({
          configId: ch.configId,
          events: ch.events || "SUCCESS|PARTIAL|FAILED",
        })),
      },
    },
    include: withChannels,
  });

  // The Connections page counts the templates sending through each channel.
  invalidateDashboardCache();
  log.info("Notification template created", { id: template.id, name: template.name });
  return template;
}

export async function updateNotificationTemplate(
  id: string,
  input: {
    name?: string;
    description?: string;
    channels?: NotificationTemplateChannelInput[];
    isDefault?: boolean;
  }
) {
  const template = await prisma.notificationTemplate.findUnique({ where: { id } });
  if (!template) throw new NotFoundError("NotificationTemplate", id);
  if (template.isSystem) {
    throw new ServiceError(
      "NotificationTemplateService",
      "updateNotificationTemplate",
      "Cannot modify a system template."
    );
  }

  if (input.name && input.name !== template.name) {
    const existing = await prisma.notificationTemplate.findUnique({
      where: { name: input.name },
    });
    if (existing) {
      throw new ServiceError(
        "NotificationTemplateService",
        "updateNotificationTemplate",
        `A notification template named "${input.name}" already exists.`
      );
    }
  }

  if (input.isDefault) {
    await prisma.notificationTemplate.updateMany({
      where: { isDefault: true, id: { not: id } },
      data: { isDefault: false },
    });
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (input.channels !== undefined) {
      await tx.notificationTemplateChannel.deleteMany({ where: { templateId: id } });
      if (input.channels.length > 0) {
        await tx.notificationTemplateChannel.createMany({
          data: input.channels.map((ch) => ({
            templateId: id,
            configId: ch.configId,
            events: ch.events || "SUCCESS|PARTIAL|FAILED",
          })),
        });
      }
    }

    return tx.notificationTemplate.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.isDefault !== undefined && { isDefault: input.isDefault }),
      },
      include: withChannels,
    });
  });

  invalidateDashboardCache();
  log.info("Notification template updated", { id });
  return updated;
}

export async function setDefaultNotificationTemplate(id: string) {
  const template = await prisma.notificationTemplate.findUnique({ where: { id } });
  if (!template) throw new NotFoundError("NotificationTemplate", id);

  await prisma.notificationTemplate.updateMany({
    where: { isDefault: true },
    data: { isDefault: false },
  });
  const updated = await prisma.notificationTemplate.update({
    where: { id },
    data: { isDefault: true },
    include: withChannels,
  });

  log.info("Default notification template set", { id });
  return updated;
}

export async function unsetDefaultNotificationTemplate() {
  await prisma.notificationTemplate.updateMany({
    where: { isDefault: true },
    data: { isDefault: false },
  });
  log.info("Default notification template cleared");
}

export async function deleteNotificationTemplate(id: string) {
  const template = await prisma.notificationTemplate.findUnique({
    where: { id },
    include: { jobs: { select: { id: true } } },
  });
  if (!template) throw new NotFoundError("NotificationTemplate", id);
  if (template.isSystem) {
    throw new ServiceError(
      "NotificationTemplateService",
      "deleteNotificationTemplate",
      "Cannot delete a system template."
    );
  }

  if (template.jobs.length > 0) {
    throw new ServiceError(
      "NotificationTemplateService",
      "deleteNotificationTemplate",
      `Cannot delete: template is used by ${template.jobs.length} job(s). Remove references first.`
    );
  }

  await prisma.notificationTemplate.delete({ where: { id } });
  invalidateDashboardCache();
  log.info("Notification template deleted", { id });
}

/**
 * Deletes several notification templates, reporting per-entry outcomes.
 *
 * Each entry goes through the single-entry guard above, so a notification templates that is still in use
 * is refused with its own reason while the rest of the batch continues.
 */
export async function deleteNotificationTemplateMany(ids: string[]): Promise<BulkResult> {
  const rows = await prisma.notificationTemplate.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const names = new Map(rows.map((row) => [row.id, row.name]));

  return runBulk(ids, (id) => deleteNotificationTemplate(id).then(() => undefined), (id) => names.get(id));
}
