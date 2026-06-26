import prisma from "@/lib/prisma";
import { logger } from "@/lib/logging/logger";
import { NotFoundError, ServiceError } from "@/lib/logging/errors";

const log = logger.child({ service: "NotificationTemplateService" });

export interface NotificationTemplateChannelInput {
  configId: string;
  events: string; // Pipe-separated: "SUCCESS|PARTIAL|FAILED"
}

export async function getNotificationTemplates() {
  return prisma.notificationTemplate.findMany({
    include: {
      channels: { include: { config: true } },
      _count: { select: { jobs: true } },
    },
    orderBy: { name: "asc" },
  });
}

export async function getNotificationTemplateById(id: string) {
  const template = await prisma.notificationTemplate.findUnique({
    where: { id },
    include: { channels: { include: { config: true } } },
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
    include: { channels: { include: { config: true } } },
  });

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
      include: { channels: { include: { config: true } } },
    });
  });

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
    include: { channels: { include: { config: true } } },
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
  log.info("Notification template deleted", { id });
}
