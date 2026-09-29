import prisma from "@/lib/prisma";
import { runBulk, type BulkResult } from "@/lib/core/bulk";
import { logger } from "@/lib/logging/logger";
import { NotFoundError, ServiceError } from "@/lib/logging/errors";

const log = logger.child({ service: "SchedulePresetService" });

/** Every preset with how many jobs follow it. */
export async function getSchedulePresets() {
  return prisma.schedulePreset.findMany({
    include: { _count: { select: { jobs: true } } },
    orderBy: { name: "asc" },
  });
}

export async function getSchedulePreset(id: string) {
  const preset = await prisma.schedulePreset.findUnique({ where: { id } });
  if (!preset) throw new NotFoundError("SchedulePreset", id);
  return preset;
}

export async function createSchedulePreset(input: {
  name: string;
  description?: string;
  schedule: string;
}) {
  const existing = await prisma.schedulePreset.findUnique({
    where: { name: input.name },
  });
  if (existing) {
    throw new ServiceError("SchedulePresetService", "createSchedulePreset", `A schedule preset named "${input.name}" already exists.`);
  }

  const preset = await prisma.schedulePreset.create({
    data: {
      name: input.name,
      description: input.description,
      schedule: input.schedule,
    },
  });

  log.info("Schedule preset created", { id: preset.id, name: preset.name });
  return preset;
}

export async function updateSchedulePreset(
  id: string,
  input: {
    name?: string;
    description?: string;
    schedule?: string;
  }
) {
  const preset = await prisma.schedulePreset.findUnique({ where: { id } });
  if (!preset) throw new NotFoundError("SchedulePreset", id);

  if (input.name && input.name !== preset.name) {
    const existing = await prisma.schedulePreset.findUnique({
      where: { name: input.name },
    });
    if (existing) {
      throw new ServiceError("SchedulePresetService", "updateSchedulePreset", `A schedule preset named "${input.name}" already exists.`);
    }
  }

  const updated = await prisma.schedulePreset.update({
    where: { id },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.schedule !== undefined && { schedule: input.schedule }),
    },
  });

  log.info("Schedule preset updated", { id });
  return updated;
}

/**
 * Deletes a preset. The jobs that follow it keep running at its time on their own: its schedule is
 * written into each of them first, since the copy a job holds may be older than the last change of
 * the preset, which never reached the job itself. The caller refreshes the scheduler. Returns the
 * name the preset had, for the audit log.
 */
export async function deleteSchedulePreset(id: string): Promise<{ name: string }> {
  const preset = await prisma.schedulePreset.findUnique({ where: { id } });
  if (!preset) throw new NotFoundError("SchedulePreset", id);

  const [followers] = await prisma.$transaction([
    prisma.job.updateMany({ where: { schedulePresetId: id }, data: { schedule: preset.schedule, schedulePresetId: null } }),
    prisma.schedulePreset.delete({ where: { id } }),
  ]);
  log.info("Schedule preset deleted", { id, jobs: followers.count });
  return { name: preset.name };
}

/**
 * Deletes several schedule presets, reporting per-entry outcomes.
 *
 * Each entry goes through the single-entry guard above, so a schedule presets that is still in use
 * is refused with its own reason while the rest of the batch continues.
 */
export async function deleteSchedulePresetMany(ids: string[]): Promise<BulkResult> {
  const rows = await prisma.schedulePreset.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const names = new Map(rows.map((row) => [row.id, row.name]));

  return runBulk(ids, (id) => deleteSchedulePreset(id).then(() => undefined), (id) => names.get(id));
}
