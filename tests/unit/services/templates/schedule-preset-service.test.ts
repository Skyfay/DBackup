import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";

vi.mock("@/lib/logging/logger", () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

import {
  getSchedulePresets,
  getSchedulePreset,
  createSchedulePreset,
  updateSchedulePreset,
  deleteSchedulePreset,
} from "@/services/templates/schedule-preset-service";
import { NotFoundError, ServiceError } from "@/lib/logging/errors";

const makePreset = (overrides: object = {}) => ({
  id: "pre-1",
  name: "Every Hour",
  description: null,
  schedule: "0 * * * *",
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe("SchedulePresetService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Read operations ──────────────────────────────────────────

  describe("getSchedulePresets", () => {
    it("returns all presets ordered by name, with how many jobs follow each", async () => {
      const presets = [makePreset({ id: "a" }), makePreset({ id: "b" })];
      prismaMock.schedulePreset.findMany.mockResolvedValue(presets as any);

      const result = await getSchedulePresets();

      expect(prismaMock.schedulePreset.findMany).toHaveBeenCalledWith({
        include: { _count: { select: { jobs: true } } },
        orderBy: { name: "asc" },
      });
      expect(result).toHaveLength(2);
    });
  });

  describe("getSchedulePreset", () => {
    it("returns the preset when found", async () => {
      const preset = makePreset();
      prismaMock.schedulePreset.findUnique.mockResolvedValue(preset as any);

      const result = await getSchedulePreset("pre-1");

      expect(prismaMock.schedulePreset.findUnique).toHaveBeenCalledWith({
        where: { id: "pre-1" },
      });
      expect(result).toBe(preset);
    });

    it("throws NotFoundError when preset does not exist", async () => {
      prismaMock.schedulePreset.findUnique.mockResolvedValue(null);

      await expect(getSchedulePreset("missing")).rejects.toBeInstanceOf(
        NotFoundError
      );
    });
  });

  // ── Create ───────────────────────────────────────────────────

  describe("createSchedulePreset", () => {
    it("creates a new preset successfully", async () => {
      prismaMock.schedulePreset.findUnique.mockResolvedValue(null);
      const created = makePreset({ name: "Daily" });
      prismaMock.schedulePreset.create.mockResolvedValue(created as any);

      const result = await createSchedulePreset({
        name: "Daily",
        schedule: "0 0 * * *",
      });

      expect(prismaMock.schedulePreset.create).toHaveBeenCalled();
      expect(result).toBe(created);
    });

    it("throws ServiceError when a preset with the same name already exists", async () => {
      prismaMock.schedulePreset.findUnique.mockResolvedValue(
        makePreset() as any
      );

      await expect(
        createSchedulePreset({ name: "Every Hour", schedule: "0 * * * *" })
      ).rejects.toBeInstanceOf(ServiceError);
    });

    it("creates a preset with description", async () => {
      prismaMock.schedulePreset.findUnique.mockResolvedValue(null);
      const created = makePreset({
        name: "Weekly",
        description: "Runs every Monday",
      });
      prismaMock.schedulePreset.create.mockResolvedValue(created as any);

      await createSchedulePreset({
        name: "Weekly",
        schedule: "0 0 * * 1",
        description: "Runs every Monday",
      });

      expect(prismaMock.schedulePreset.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ description: "Runs every Monday" }),
        })
      );
    });
  });

  // ── Update ───────────────────────────────────────────────────

  describe("updateSchedulePreset", () => {
    it("updates an existing preset successfully", async () => {
      prismaMock.schedulePreset.findUnique.mockResolvedValue(
        makePreset() as any
      );
      const updated = makePreset({ schedule: "0 0 * * *" });
      prismaMock.schedulePreset.update.mockResolvedValue(updated as any);

      const result = await updateSchedulePreset("pre-1", {
        schedule: "0 0 * * *",
      });

      expect(prismaMock.schedulePreset.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "pre-1" } })
      );
      expect(result).toBe(updated);
    });

    it("throws NotFoundError when preset does not exist", async () => {
      prismaMock.schedulePreset.findUnique.mockResolvedValue(null);

      await expect(
        updateSchedulePreset("missing", { schedule: "x" })
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("throws ServiceError when renaming to an already used name", async () => {
      const preset = makePreset({ name: "OldName" });
      prismaMock.schedulePreset.findUnique
        .mockResolvedValueOnce(preset as any)
        .mockResolvedValueOnce(makePreset({ name: "Taken" }) as any);

      await expect(
        updateSchedulePreset("pre-1", { name: "Taken" })
      ).rejects.toBeInstanceOf(ServiceError);
    });

    it("does not check for name collision when name is unchanged", async () => {
      const preset = makePreset({ name: "Every Hour" });
      prismaMock.schedulePreset.findUnique.mockResolvedValueOnce(preset as any);
      prismaMock.schedulePreset.update.mockResolvedValue(preset as any);

      await updateSchedulePreset("pre-1", { name: "Every Hour" });

      // findUnique called only once (for the existence check, not for name-collision)
      expect(prismaMock.schedulePreset.findUnique).toHaveBeenCalledTimes(1);
    });
  });

  // ── Delete ───────────────────────────────────────────────────

  describe("deleteSchedulePreset", () => {
    it("deletes an existing preset successfully", async () => {
      prismaMock.schedulePreset.findUnique.mockResolvedValue(
        makePreset() as any
      );
      prismaMock.schedulePreset.delete.mockResolvedValue(makePreset() as any);

      await deleteSchedulePreset("pre-1");

      expect(prismaMock.schedulePreset.delete).toHaveBeenCalledWith({
        where: { id: "pre-1" },
      });
    });

    it("throws NotFoundError when preset does not exist", async () => {
      prismaMock.schedulePreset.findUnique.mockResolvedValue(null);

      await expect(deleteSchedulePreset("missing")).rejects.toBeInstanceOf(
        NotFoundError
      );
    });
  });
});
