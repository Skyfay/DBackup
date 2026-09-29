import prisma from "@/lib/prisma";
import { runBulk, type BulkResult } from "@/lib/core/bulk";
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
  groups?: string[];
  excludedGroupPatterns?: string[];
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
      groups: JSON.stringify(input.groups ?? []),
      excludedGroupPatterns: JSON.stringify(input.excludedGroupPatterns ?? []),
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
    groups?: string[];
    excludedGroupPatterns?: string[];
    isDefault?: boolean;
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
      ...(input.groups !== undefined && { groups: JSON.stringify(input.groups) }),
      ...(input.excludedGroupPatterns !== undefined && { excludedGroupPatterns: JSON.stringify(input.excludedGroupPatterns) }),
      // Unlike a naming template, several presets can be default at once: their patterns are
      // unioned, so marking one does not have to unmark the others.
      ...(input.isDefault !== undefined && { isDefault: input.isDefault }),
    },
  });

  log.info("Exclude pattern preset updated", { id });
  return updated;
}

/** Presets pre-selected on a newly added directory source. */
export async function getDefaultExcludePatternPresets() {
  return prisma.excludePatternPreset.findMany({ where: { isDefault: true }, orderBy: { name: "asc" } });
}

/**
 * Unlike NamingTemplate, deletion is never blocked by usage - a removed preset just drops out of
 * any job sources' excludePatternPresets link (a many-to-many, cascaded by the DB), falling back
 * to only their own job-specific patterns. Safe direction: losing the link means fewer exclusions
 * apply next run (backs up more, not less), unlike losing a naming pattern or schedule. Returns the
 * name the preset had, for the audit log.
 */
export async function deleteExcludePatternPreset(id: string): Promise<{ name: string }> {
  const preset = await prisma.excludePatternPreset.findUnique({ where: { id } });
  if (!preset) throw new NotFoundError("ExcludePatternPreset", id);

  // A system preset ships with the product and stays available; its patterns can be edited,
  // and it can be unstarred or simply left unselected, so there is no need to remove it.
  if (preset.isSystem) {
    throw new ServiceError(
      "ExcludePatternPresetService",
      "deleteExcludePatternPreset",
      `"${preset.name}" is a built-in preset and cannot be deleted. Edit its patterns or remove its default star instead.`
    );
  }

  await prisma.excludePatternPreset.delete({ where: { id } });
  log.info("Exclude pattern preset deleted", { id });
  return { name: preset.name };
}

export function parseExcludePatternPresetPatterns(patterns: string): string[] {
  try {
    const parsed = JSON.parse(patterns);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Deletes several exclude pattern presets, reporting per-entry outcomes.
 *
 * Each entry goes through the single-entry guard above, so a exclude pattern presets that is still in use
 * is refused with its own reason while the rest of the batch continues.
 */
export async function deleteExcludePatternPresetMany(ids: string[]): Promise<BulkResult> {
  const rows = await prisma.excludePatternPreset.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const names = new Map(rows.map((row) => [row.id, row.name]));

  return runBulk(ids, (id) => deleteExcludePatternPreset(id).then(() => undefined), (id) => names.get(id));
}
