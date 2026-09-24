import prisma from "@/lib/prisma";
import { runBulk, type BulkResult } from "@/lib/core/bulk";
import { logger } from "@/lib/logging/logger";
import { NotFoundError, ServiceError, ValidationError } from "@/lib/logging/errors";
import { RetentionConfigurationSchema, type RetentionConfiguration } from "@/lib/core/retention";

const log = logger.child({ service: "RetentionPolicyService" });

/**
 * Validates a configuration before it is stored.
 *
 * A retention policy is the input to file deletion, so a malformed one is not a cosmetic
 * problem. Rejecting it here keeps a value written through the API from reaching the
 * bucketing logic.
 */
function validateConfig(config: RetentionConfiguration): RetentionConfiguration {
  try {
    return RetentionConfigurationSchema.parse(config);
  } catch (e) {
    throw new ValidationError("Retention policy validation failed", {
      field: "config",
      cause: e instanceof Error ? e : undefined,
    });
  }
}

/** Every policy with how many destinations of jobs follow it. */
export async function getRetentionPolicies() {
  return prisma.retentionPolicy.findMany({
    include: { _count: { select: { jobDestinations: true } } },
    orderBy: { name: "asc" },
  });
}

export async function getRetentionPolicy(id: string) {
  const policy = await prisma.retentionPolicy.findUnique({ where: { id } });
  if (!policy) throw new NotFoundError("RetentionPolicy", id);
}

export async function createRetentionPolicy(input: {
  name: string;
  description?: string;
  config: RetentionConfiguration;
  isDefault?: boolean;
}) {
  const existing = await prisma.retentionPolicy.findUnique({
    where: { name: input.name },
  });
  if (existing) {
    throw new ServiceError("RetentionPolicyService", "createRetentionPolicy", `A retention policy named "${input.name}" already exists.`);
  }

  const config = validateConfig(input.config);

  if (input.isDefault) {
    await prisma.retentionPolicy.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
  }

  const policy = await prisma.retentionPolicy.create({
    data: {
      name: input.name,
      description: input.description,
      config: JSON.stringify(config),
      isDefault: input.isDefault ?? false,
    },
  });

  log.info("Retention policy created", { id: policy.id, name: policy.name });
  return policy;
}

export async function updateRetentionPolicy(
  id: string,
  input: {
    name?: string;
    description?: string;
    config?: RetentionConfiguration;
    isDefault?: boolean;
  }
) {
  // Validated before anything is written, so a rejected config cannot leave the
  // isDefault flag already cleared below.
  const config = input.config !== undefined ? validateConfig(input.config) : undefined;

  const policy = await prisma.retentionPolicy.findUnique({ where: { id } });
  if (!policy) throw new NotFoundError("RetentionPolicy", id);

  if (input.name && input.name !== policy.name) {
    const existing = await prisma.retentionPolicy.findUnique({
      where: { name: input.name },
    });
    if (existing) {
      throw new ServiceError("RetentionPolicyService", "updateRetentionPolicy", `A retention policy named "${input.name}" already exists.`);
    }
  }

  if (input.isDefault) {
    await prisma.retentionPolicy.updateMany({ where: { isDefault: true, id: { not: id } }, data: { isDefault: false } });
  }

  const updated = await prisma.retentionPolicy.update({
    where: { id },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(config !== undefined && {
        config: JSON.stringify(config),
      }),
      ...(input.isDefault !== undefined && { isDefault: input.isDefault }),
    },
  });

  log.info("Retention policy updated", { id });
  return updated;
}

export async function setDefaultRetentionPolicy(id: string) {
  const policy = await prisma.retentionPolicy.findUnique({ where: { id } });
  if (!policy) throw new NotFoundError("RetentionPolicy", id);

  await prisma.retentionPolicy.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
  const updated = await prisma.retentionPolicy.update({ where: { id }, data: { isDefault: true } });

  log.info("Default retention policy set", { id });
  return updated;
}

export async function unsetDefaultRetentionPolicy() {
  await prisma.retentionPolicy.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
  log.info("Default retention policy cleared");
}

export async function deleteRetentionPolicy(id: string) {
  const policy = await prisma.retentionPolicy.findUnique({
    where: { id },
    include: {
      jobDestinations: { select: { id: true } },
      adapterConfigs: { select: { id: true } },
    },
  });
  if (!policy) throw new NotFoundError("RetentionPolicy", id);

  const usageCount =
    policy.jobDestinations.length + policy.adapterConfigs.length;
  if (usageCount > 0) {
    throw new ServiceError("RetentionPolicyService", "deleteRetentionPolicy", `Cannot delete: policy is used by ${usageCount} destination(s). Remove references first.`);
  }

  await prisma.retentionPolicy.delete({ where: { id } });
  log.info("Retention policy deleted", { id });
}

export function parseRetentionPolicyConfig(
  config: string
): RetentionConfiguration {
  try {
    return JSON.parse(config) as RetentionConfiguration;
  } catch {
    return { mode: "NONE" };
  }
}

/**
 * Deletes several retention policies, reporting per-entry outcomes.
 *
 * Each entry goes through the single-entry guard above, so a retention policies that is still in use
 * is refused with its own reason while the rest of the batch continues.
 */
export async function deleteRetentionPolicyMany(ids: string[]): Promise<BulkResult> {
  const rows = await prisma.retentionPolicy.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const names = new Map(rows.map((row) => [row.id, row.name]));

  return runBulk(ids, (id) => deleteRetentionPolicy(id).then(() => undefined), (id) => names.get(id));
}
