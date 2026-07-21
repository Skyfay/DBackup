import prisma from "@/lib/prisma";
import { logger } from "@/lib/logging/logger";
import { NotFoundError, ServiceError } from "@/lib/logging/errors";

const log = logger.child({ service: "ExcludePatternPresetService" });

export async function getExcludePatternPresets() {
  return prisma.excludePatternPreset.findMany({ orderBy: { name: "asc" } });
}

export async function getExcludePatternPreset(id: string) {
  const preset = await prisma.excludePatternPreset.findUnique({ where: { id } });
  if (!preset) throw new NotFoundError("ExcludePatternPreset", id);
  return preset;
}

export async function createExcludePatternPreset(input: {
  name: string;
  description?: string;
  patterns: string[];
}) {
  const existing = await prisma.excludePatternPreset.findUnique({
    where: { name: input.name },
  });
  if (existing) {
    throw new ServiceError("ExcludePatternPresetService", "createExcludePatternPreset", `An exclude pattern preset named "${input.name}" already exists.`);
  }

  const preset = await prisma.excludePatternPreset.create({
    data: {
      name: input.name,
      description: input.description,
      patterns: JSON.stringify(input.patterns),
    },
  });

  log.info("Exclude pattern preset created", { id: preset.id, name: preset.name });
  return preset;
}

export async function updateExcludePatternPreset(
  id: string,
  input: {
    name?: string;
    description?: string;
    patterns?: string[];
  }
) {
  const preset = await prisma.excludePatternPreset.findUnique({ where: { id } });
  if (!preset) throw new NotFoundError("ExcludePatternPreset", id);

  if (input.name && input.name !== preset.name) {
    const existing = await prisma.excludePatternPreset.findUnique({
      where: { name: input.name },
    });
    if (existing) {
      throw new ServiceError("ExcludePatternPresetService", "updateExcludePatternPreset", `An exclude pattern preset named "${input.name}" already exists.`);
    }
  }

  const updated = await prisma.excludePatternPreset.update({
    where: { id },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.patterns !== undefined && { patterns: JSON.stringify(input.patterns) }),
    },
  });

  log.info("Exclude pattern preset updated", { id });
  return updated;
}

/**
 * Unlike NamingTemplate, deletion is never blocked by usage - a removed preset just drops out of
 * any job sources' excludePatternPresets link (a many-to-many, cascaded by the DB), falling back
 * to only their own job-specific patterns. Safe direction: losing the link means fewer exclusions
 * apply next run (backs up more, not less), unlike losing a naming pattern or schedule.
 */
export async function deleteExcludePatternPreset(id: string) {
  const preset = await prisma.excludePatternPreset.findUnique({ where: { id } });
  if (!preset) throw new NotFoundError("ExcludePatternPreset", id);

  await prisma.excludePatternPreset.delete({ where: { id } });
  log.info("Exclude pattern preset deleted", { id });
}

export function parseExcludePatternPresetPatterns(patterns: string): string[] {
  try {
    const parsed = JSON.parse(patterns);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}
