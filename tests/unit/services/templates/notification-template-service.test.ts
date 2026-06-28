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
  getNotificationTemplates,
  getNotificationTemplateById,
  createNotificationTemplate,
  updateNotificationTemplate,
  setDefaultNotificationTemplate,
  unsetDefaultNotificationTemplate,
  deleteNotificationTemplate,
} from "@/services/templates/notification-template-service";
import { NotFoundError, ServiceError } from "@/lib/logging/errors";

const makeTemplate = (overrides: object = {}) => ({
  id: "tpl-1",
  name: "Default",
  description: null,
  isDefault: false,
  isSystem: false,
  channels: [],
  jobs: [],
  _count: { jobs: 0 },
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe("NotificationTemplateService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── getNotificationTemplates ─────────────────────────────────

  describe("getNotificationTemplates", () => {
    it("returns all templates ordered by name", async () => {
      const templates = [makeTemplate({ id: "a" }), makeTemplate({ id: "b" })];
      prismaMock.notificationTemplate.findMany.mockResolvedValue(templates as any);

      const result = await getNotificationTemplates();

      expect(prismaMock.notificationTemplate.findMany).toHaveBeenCalledWith({
        include: {
          channels: { include: { config: true } },
          _count: { select: { jobs: true } },
        },
        orderBy: { name: "asc" },
      });
      expect(result).toHaveLength(2);
    });
  });

  // ── getNotificationTemplateById ──────────────────────────────

  describe("getNotificationTemplateById", () => {
    it("returns template when found", async () => {
      const tpl = makeTemplate();
      prismaMock.notificationTemplate.findUnique.mockResolvedValue(tpl as any);

      const result = await getNotificationTemplateById("tpl-1");

      expect(prismaMock.notificationTemplate.findUnique).toHaveBeenCalledWith({
        where: { id: "tpl-1" },
        include: { channels: { include: { config: true } } },
      });
      expect(result).toBe(tpl);
    });

    it("throws NotFoundError when template does not exist", async () => {
      prismaMock.notificationTemplate.findUnique.mockResolvedValue(null);

      await expect(getNotificationTemplateById("missing")).rejects.toBeInstanceOf(
        NotFoundError
      );
    });
  });

  // ── createNotificationTemplate ───────────────────────────────

  describe("createNotificationTemplate", () => {
    it("creates a new template successfully", async () => {
      prismaMock.notificationTemplate.findUnique.mockResolvedValue(null);
      const created = makeTemplate({ name: "New" });
      prismaMock.notificationTemplate.create.mockResolvedValue(created as any);

      const result = await createNotificationTemplate({
        name: "New",
        channels: [{ configId: "cfg-1", events: "SUCCESS|FAILED" }],
      });

      expect(prismaMock.notificationTemplate.create).toHaveBeenCalled();
      expect(result).toBe(created);
    });

    it("throws ServiceError when a template with the same name already exists", async () => {
      prismaMock.notificationTemplate.findUnique.mockResolvedValue(
        makeTemplate() as any
      );

      await expect(
        createNotificationTemplate({ name: "Default", channels: [] })
      ).rejects.toBeInstanceOf(ServiceError);
    });

    it("clears previous default when isDefault is true", async () => {
      prismaMock.notificationTemplate.findUnique.mockResolvedValue(null);
      prismaMock.notificationTemplate.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.notificationTemplate.create.mockResolvedValue(
        makeTemplate({ isDefault: true }) as any
      );

      await createNotificationTemplate({
        name: "NewDefault",
        channels: [],
        isDefault: true,
      });

      expect(prismaMock.notificationTemplate.updateMany).toHaveBeenCalledWith({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    });

    it("does not clear defaults when isDefault is false", async () => {
      prismaMock.notificationTemplate.findUnique.mockResolvedValue(null);
      prismaMock.notificationTemplate.create.mockResolvedValue(
        makeTemplate() as any
      );

      await createNotificationTemplate({
        name: "NotDefault",
        channels: [],
        isDefault: false,
      });

      expect(prismaMock.notificationTemplate.updateMany).not.toHaveBeenCalled();
    });

    it("creates channels with default events when events is empty string", async () => {
      prismaMock.notificationTemplate.findUnique.mockResolvedValue(null);
      const created = makeTemplate({ name: "WithChannels" });
      prismaMock.notificationTemplate.create.mockResolvedValue(created as any);

      await createNotificationTemplate({
        name: "WithChannels",
        channels: [{ configId: "cfg-1", events: "" }],
      });

      expect(prismaMock.notificationTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            channels: {
              create: [{ configId: "cfg-1", events: "SUCCESS|PARTIAL|FAILED" }],
            },
          }),
        })
      );
    });
  });

  // ── updateNotificationTemplate ───────────────────────────────

  describe("updateNotificationTemplate", () => {
    it("updates a user template successfully", async () => {
      const tpl = makeTemplate();
      prismaMock.notificationTemplate.findUnique
        .mockResolvedValueOnce(tpl as any) // template lookup
        .mockResolvedValueOnce(null);       // name collision check
      const updated = makeTemplate({ name: "Renamed" });
      prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
      prismaMock.notificationTemplate.update.mockResolvedValue(updated as any);

      const result = await updateNotificationTemplate("tpl-1", { name: "Renamed" });

      expect(prismaMock.notificationTemplate.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "tpl-1" } })
      );
      expect(result).toBe(updated);
    });

    it("throws NotFoundError when template does not exist", async () => {
      prismaMock.notificationTemplate.findUnique.mockResolvedValue(null);

      await expect(
        updateNotificationTemplate("missing", { name: "x" })
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("throws ServiceError when modifying a system template", async () => {
      prismaMock.notificationTemplate.findUnique.mockResolvedValue(
        makeTemplate({ isSystem: true }) as any
      );

      await expect(
        updateNotificationTemplate("tpl-1", { name: "changed" })
      ).rejects.toBeInstanceOf(ServiceError);
    });

    it("throws ServiceError when renaming to an already used name", async () => {
      const tpl = makeTemplate({ name: "OldName" });
      prismaMock.notificationTemplate.findUnique
        .mockResolvedValueOnce(tpl as any)
        .mockResolvedValueOnce(makeTemplate({ name: "Taken" }) as any);

      await expect(
        updateNotificationTemplate("tpl-1", { name: "Taken" })
      ).rejects.toBeInstanceOf(ServiceError);
    });

    it("clears previous default when isDefault is set to true", async () => {
      const tpl = makeTemplate();
      prismaMock.notificationTemplate.findUnique.mockResolvedValue(tpl as any);
      prismaMock.notificationTemplate.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
      prismaMock.notificationTemplate.update.mockResolvedValue(
        makeTemplate({ isDefault: true }) as any
      );

      await updateNotificationTemplate("tpl-1", { isDefault: true });

      expect(prismaMock.notificationTemplate.updateMany).toHaveBeenCalledWith({
        where: { isDefault: true, id: { not: "tpl-1" } },
        data: { isDefault: false },
      });
    });

    it("replaces channels via transaction when channels are provided", async () => {
      const tpl = makeTemplate();
      prismaMock.notificationTemplate.findUnique.mockResolvedValue(tpl as any);
      prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
      prismaMock.notificationTemplateChannel.deleteMany.mockResolvedValue({ count: 1 });
      prismaMock.notificationTemplateChannel.createMany.mockResolvedValue({ count: 1 });
      prismaMock.notificationTemplate.update.mockResolvedValue(tpl as any);

      await updateNotificationTemplate("tpl-1", {
        channels: [{ configId: "cfg-2", events: "SUCCESS" }],
      });

      expect(prismaMock.notificationTemplateChannel.deleteMany).toHaveBeenCalledWith({
        where: { templateId: "tpl-1" },
      });
      expect(prismaMock.notificationTemplateChannel.createMany).toHaveBeenCalledWith({
        data: [{ templateId: "tpl-1", configId: "cfg-2", events: "SUCCESS" }],
      });
    });

    it("deletes channels but does not create when channels array is empty", async () => {
      const tpl = makeTemplate();
      prismaMock.notificationTemplate.findUnique.mockResolvedValue(tpl as any);
      prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
      prismaMock.notificationTemplateChannel.deleteMany.mockResolvedValue({ count: 2 });
      prismaMock.notificationTemplate.update.mockResolvedValue(tpl as any);

      await updateNotificationTemplate("tpl-1", { channels: [] });

      expect(prismaMock.notificationTemplateChannel.deleteMany).toHaveBeenCalled();
      expect(prismaMock.notificationTemplateChannel.createMany).not.toHaveBeenCalled();
    });

    it("skips channel operations when channels are not provided", async () => {
      const tpl = makeTemplate();
      prismaMock.notificationTemplate.findUnique
        .mockResolvedValueOnce(tpl as any) // template lookup
        .mockResolvedValueOnce(null);       // name collision check
      prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
      prismaMock.notificationTemplate.update.mockResolvedValue(tpl as any);

      await updateNotificationTemplate("tpl-1", { name: "JustName" });

      expect(prismaMock.notificationTemplateChannel.deleteMany).not.toHaveBeenCalled();
      expect(prismaMock.notificationTemplateChannel.createMany).not.toHaveBeenCalled();
    });
  });

  // ── setDefaultNotificationTemplate ──────────────────────────

  describe("setDefaultNotificationTemplate", () => {
    it("sets the default template and clears previous defaults", async () => {
      const tpl = makeTemplate();
      prismaMock.notificationTemplate.findUnique.mockResolvedValue(tpl as any);
      prismaMock.notificationTemplate.updateMany.mockResolvedValue({ count: 1 });
      const updated = makeTemplate({ isDefault: true });
      prismaMock.notificationTemplate.update.mockResolvedValue(updated as any);

      const result = await setDefaultNotificationTemplate("tpl-1");

      expect(prismaMock.notificationTemplate.updateMany).toHaveBeenCalledWith({
        where: { isDefault: true },
        data: { isDefault: false },
      });
      expect(prismaMock.notificationTemplate.update).toHaveBeenCalledWith({
        where: { id: "tpl-1" },
        data: { isDefault: true },
        include: { channels: { include: { config: true } } },
      });
      expect(result).toBe(updated);
    });

    it("throws NotFoundError when template does not exist", async () => {
      prismaMock.notificationTemplate.findUnique.mockResolvedValue(null);

      await expect(
        setDefaultNotificationTemplate("missing")
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  // ── unsetDefaultNotificationTemplate ────────────────────────

  describe("unsetDefaultNotificationTemplate", () => {
    it("clears all default flags", async () => {
      prismaMock.notificationTemplate.updateMany.mockResolvedValue({ count: 1 });

      await unsetDefaultNotificationTemplate();

      expect(prismaMock.notificationTemplate.updateMany).toHaveBeenCalledWith({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    });
  });

  // ── deleteNotificationTemplate ───────────────────────────────

  describe("deleteNotificationTemplate", () => {
    it("deletes a template successfully", async () => {
      const tpl = makeTemplate({ jobs: [] });
      prismaMock.notificationTemplate.findUnique.mockResolvedValue(tpl as any);
      prismaMock.notificationTemplate.delete.mockResolvedValue(tpl as any);

      await deleteNotificationTemplate("tpl-1");

      expect(prismaMock.notificationTemplate.delete).toHaveBeenCalledWith({
        where: { id: "tpl-1" },
      });
    });

    it("throws NotFoundError when template does not exist", async () => {
      prismaMock.notificationTemplate.findUnique.mockResolvedValue(null);

      await expect(deleteNotificationTemplate("missing")).rejects.toBeInstanceOf(
        NotFoundError
      );
    });

    it("throws ServiceError when trying to delete a system template", async () => {
      prismaMock.notificationTemplate.findUnique.mockResolvedValue(
        makeTemplate({ isSystem: true, jobs: [] }) as any
      );

      await expect(deleteNotificationTemplate("tpl-1")).rejects.toBeInstanceOf(
        ServiceError
      );
    });

    it("throws ServiceError when template is in use by jobs", async () => {
      prismaMock.notificationTemplate.findUnique.mockResolvedValue(
        makeTemplate({ jobs: [{ id: "job-1" }, { id: "job-2" }] }) as any
      );

      await expect(deleteNotificationTemplate("tpl-1")).rejects.toBeInstanceOf(
        ServiceError
      );
    });

    it("error message for in-use template mentions job count", async () => {
      prismaMock.notificationTemplate.findUnique.mockResolvedValue(
        makeTemplate({ jobs: [{ id: "job-1" }] }) as any
      );

      await expect(deleteNotificationTemplate("tpl-1")).rejects.toThrow("1 job");
    });
  });
});
