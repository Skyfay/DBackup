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
  getNamingTemplates,
  getNamingTemplate,
  getDefaultNamingTemplate,
  createNamingTemplate,
  updateNamingTemplate,
  deleteNamingTemplate,
} from "@/services/templates/naming-template-service";
import { NotFoundError, ServiceError } from "@/lib/logging/errors";

const makeTemplate = (overrides: object = {}) => ({
  id: "tpl-1",
  name: "Default",
  description: null,
  pattern: "{job_name}_yyyy-MM-dd",
  isDefault: false,
  isSystem: false,
  jobs: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe("NamingTemplateService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Read operations ──────────────────────────────────────────

  describe("getNamingTemplates", () => {
    it("returns all templates ordered by name, with how many jobs use each", async () => {
      const templates = [makeTemplate({ id: "a" }), makeTemplate({ id: "b" })];
      prismaMock.namingTemplate.findMany.mockResolvedValue(templates as any);

      const result = await getNamingTemplates();

      expect(prismaMock.namingTemplate.findMany).toHaveBeenCalledWith({
        include: { _count: { select: { jobs: true } } },
        orderBy: { name: "asc" },
      });
      expect(result).toHaveLength(2);
    });
  });

  describe("getNamingTemplate", () => {
    it("returns template when found", async () => {
      const tpl = makeTemplate();
      prismaMock.namingTemplate.findUnique.mockResolvedValue(tpl as any);

      const result = await getNamingTemplate("tpl-1");

      expect(prismaMock.namingTemplate.findUnique).toHaveBeenCalledWith({
        where: { id: "tpl-1" },
      });
      expect(result).toBe(tpl);
    });

    it("throws NotFoundError when template does not exist", async () => {
      prismaMock.namingTemplate.findUnique.mockResolvedValue(null);

      await expect(getNamingTemplate("missing")).rejects.toBeInstanceOf(
        NotFoundError
      );
    });
  });

  describe("getDefaultNamingTemplate", () => {
    it("returns the default template", async () => {
      const tpl = makeTemplate({ isDefault: true });
      prismaMock.namingTemplate.findFirst.mockResolvedValue(tpl as any);

      const result = await getDefaultNamingTemplate();

      expect(prismaMock.namingTemplate.findFirst).toHaveBeenCalledWith({
        where: { isDefault: true },
      });
      expect(result).toBe(tpl);
    });
  });

  // ── Create ───────────────────────────────────────────────────

  describe("createNamingTemplate", () => {
    it("creates a new template successfully", async () => {
      prismaMock.namingTemplate.findUnique.mockResolvedValue(null);
      const created = makeTemplate({ name: "New" });
      prismaMock.namingTemplate.create.mockResolvedValue(created as any);

      const result = await createNamingTemplate({
        name: "New",
        pattern: "{job_name}_yyyy",
      });

      expect(prismaMock.namingTemplate.create).toHaveBeenCalled();
      expect(result).toBe(created);
    });

    it("throws ServiceError when a template with the same name already exists", async () => {
      prismaMock.namingTemplate.findUnique.mockResolvedValue(
        makeTemplate() as any
      );

      await expect(
        createNamingTemplate({ name: "Default", pattern: "x" })
      ).rejects.toBeInstanceOf(ServiceError);
    });

    it("clears previous default when isDefault is true", async () => {
      prismaMock.namingTemplate.findUnique.mockResolvedValue(null);
      prismaMock.namingTemplate.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.namingTemplate.create.mockResolvedValue(
        makeTemplate({ isDefault: true }) as any
      );

      await createNamingTemplate({
        name: "NewDefault",
        pattern: "x",
        isDefault: true,
      });

      expect(prismaMock.namingTemplate.updateMany).toHaveBeenCalledWith({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    });
  });

  // ── Update ───────────────────────────────────────────────────

  describe("updateNamingTemplate", () => {
    it("updates a user template successfully", async () => {
      const tpl = makeTemplate();
      prismaMock.namingTemplate.findUnique.mockResolvedValue(tpl as any);
      const updated = makeTemplate({ pattern: "new-pattern" });
      prismaMock.namingTemplate.update.mockResolvedValue(updated as any);

      const result = await updateNamingTemplate("tpl-1", {
        pattern: "new-pattern",
      });

      expect(prismaMock.namingTemplate.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "tpl-1" } })
      );
      expect(result).toBe(updated);
    });

    it("throws NotFoundError when template does not exist", async () => {
      prismaMock.namingTemplate.findUnique.mockResolvedValue(null);

      await expect(
        updateNamingTemplate("missing", { pattern: "x" })
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("throws ServiceError when modifying a system template", async () => {
      prismaMock.namingTemplate.findUnique.mockResolvedValue(
        makeTemplate({ isSystem: true }) as any
      );

      await expect(
        updateNamingTemplate("tpl-1", { name: "changed" })
      ).rejects.toBeInstanceOf(ServiceError);
    });

    it("throws ServiceError when renaming to an already used name", async () => {
      const tpl = makeTemplate({ name: "OldName" });
      prismaMock.namingTemplate.findUnique
        .mockResolvedValueOnce(tpl as any) // current template lookup
        .mockResolvedValueOnce(makeTemplate({ name: "Taken" }) as any); // name-collision check

      await expect(
        updateNamingTemplate("tpl-1", { name: "Taken" })
      ).rejects.toBeInstanceOf(ServiceError);
    });

    it("clears previous default when isDefault is set to true", async () => {
      const tpl = makeTemplate();
      prismaMock.namingTemplate.findUnique.mockResolvedValue(tpl as any);
      prismaMock.namingTemplate.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.namingTemplate.update.mockResolvedValue(
        makeTemplate({ isDefault: true }) as any
      );

      await updateNamingTemplate("tpl-1", { isDefault: true });

      expect(prismaMock.namingTemplate.updateMany).toHaveBeenCalledWith({
        where: { isDefault: true, id: { not: "tpl-1" } },
        data: { isDefault: false },
      });
    });
  });

  // ── Delete ───────────────────────────────────────────────────

  describe("deleteNamingTemplate", () => {
    it("deletes a template successfully", async () => {
      const tpl = makeTemplate({ jobs: [] });
      prismaMock.namingTemplate.findUnique.mockResolvedValue(tpl as any);
      prismaMock.namingTemplate.delete.mockResolvedValue(tpl as any);

      await deleteNamingTemplate("tpl-1");

      expect(prismaMock.namingTemplate.delete).toHaveBeenCalledWith({
        where: { id: "tpl-1" },
      });
    });

    it("throws NotFoundError when template does not exist", async () => {
      prismaMock.namingTemplate.findUnique.mockResolvedValue(null);

      await expect(deleteNamingTemplate("missing")).rejects.toBeInstanceOf(
        NotFoundError
      );
    });

    it("throws ServiceError when trying to delete a system template", async () => {
      prismaMock.namingTemplate.findUnique.mockResolvedValue(
        makeTemplate({ isSystem: true }) as any
      );

      await expect(deleteNamingTemplate("tpl-1")).rejects.toBeInstanceOf(
        ServiceError
      );
    });

    it("throws ServiceError when trying to delete the default template", async () => {
      prismaMock.namingTemplate.findUnique.mockResolvedValue(
        makeTemplate({ isDefault: true }) as any
      );

      await expect(deleteNamingTemplate("tpl-1")).rejects.toBeInstanceOf(
        ServiceError
      );
    });

    it("throws ServiceError when template is in use by jobs", async () => {
      prismaMock.namingTemplate.findUnique.mockResolvedValue(
        makeTemplate({ jobs: [{ id: "job-1" }] }) as any
      );

      await expect(deleteNamingTemplate("tpl-1")).rejects.toBeInstanceOf(
        ServiceError
      );
    });
  });
});
