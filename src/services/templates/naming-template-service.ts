import prisma from "@/lib/prisma";
import { runBulk, type BulkResult } from "@/lib/core/bulk";
import { logger } from "@/lib/logging/logger";
import { NotFoundError, ServiceError } from "@/lib/logging/errors";

const log = logger.child({ service: "NamingTemplateService" });

/** Every naming template with how many jobs name their backups by it. */
export async function getNamingTemplates() {
  return prisma.namingTemplate.findMany({ include: { _count: { select: { jobs: true } } }, orderBy: { name: "asc" } });
}

export async function getNamingTemplate(id: string) {
  const template = await prisma.namingTemplate.findUnique({ where: { id } });
  if (!template) throw new NotFoundError("NamingTemplate", id);
  return template;
}

export async function getDefaultNamingTemplate() {
  return prisma.namingTemplate.findFirst({ where: { isDefault: true } });
}

export async function createNamingTemplate(input: {
  name: string;
  description?: string;
  pattern: string;
  isDefault?: boolean;
}) {
  const existing = await prisma.namingTemplate.findUnique({
    where: { name: input.name },
  });
  if (existing) {
    throw new ServiceError("NamingTemplateService", "createNamingTemplate", `A naming template named "${input.name}" already exists.`);
  }

  if (input.isDefault) {
    await prisma.namingTemplate.updateMany({
      where: { isDefault: true },
      data: { isDefault: false },
    });
  }

  const template = await prisma.namingTemplate.create({
    data: {
      name: input.name,
      description: input.description,
      pattern: input.pattern,
      isDefault: input.isDefault ?? false,
      isSystem: false,
    },
  });

  log.info("Naming template created", { id: template.id, name: template.name });
  return template;
}

export async function updateNamingTemplate(
  id: string,
  input: {
    name?: string;
    description?: string;
    pattern?: string;
    isDefault?: boolean;
  }
) {
  const template = await prisma.namingTemplate.findUnique({ where: { id } });
  if (!template) throw new NotFoundError("NamingTemplate", id);
  if (template.isSystem && (input.name !== undefined || input.pattern !== undefined || input.description !== undefined)) {
    throw new ServiceError("NamingTemplateService", "updateNamingTemplate", "System templates cannot be modified.");
  }

  if (input.name && input.name !== template.name) {
    const existing = await prisma.namingTemplate.findUnique({
      where: { name: input.name },
    });
    if (existing) {
      throw new ServiceError("NamingTemplateService", "updateNamingTemplate", `A naming template named "${input.name}" already exists.`);
    }
  }

  if (input.isDefault) {
    await prisma.namingTemplate.updateMany({
      where: { isDefault: true, id: { not: id } },
      data: { isDefault: false },
    });
  }

  const updated = await prisma.namingTemplate.update({
    where: { id },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.pattern !== undefined && { pattern: input.pattern }),
      ...(input.isDefault !== undefined && { isDefault: input.isDefault }),
    },
  });

  log.info("Naming template updated", { id });
  return updated;
}

export async function deleteNamingTemplate(id: string) {
  const template = await prisma.namingTemplate.findUnique({
    where: { id },
    include: { jobs: { select: { id: true } } },
  });
  if (!template) throw new NotFoundError("NamingTemplate", id);
  if (template.isSystem) {
    throw new ServiceError("NamingTemplateService", "deleteNamingTemplate", "System templates cannot be deleted.");
  }
  if (template.isDefault) {
    throw new ServiceError("NamingTemplateService", "deleteNamingTemplate", "Cannot delete the default naming template. Set another template as default first.");
  }
  if (template.jobs.length > 0) {
    throw new ServiceError("NamingTemplateService", "deleteNamingTemplate", `Cannot delete: template is used by ${template.jobs.length} job(s). Update jobs first.`);
  }

  await prisma.namingTemplate.delete({ where: { id } });
  log.info("Naming template deleted", { id });
}

/**
 * Deletes several naming templates, reporting per-entry outcomes.
 *
 * Each entry goes through the single-entry guard above, so a naming templates that is still in use
 * is refused with its own reason while the rest of the batch continues.
 */
export async function deleteNamingTemplateMany(ids: string[]): Promise<BulkResult> {
  const rows = await prisma.namingTemplate.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const names = new Map(rows.map((row) => [row.id, row.name]));

  return runBulk(ids, (id) => deleteNamingTemplate(id).then(() => undefined), (id) => names.get(id));
}
