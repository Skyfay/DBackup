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
  getRetentionPolicies,
  getRetentionPolicy,
  createRetentionPolicy,
  updateRetentionPolicy,
  setDefaultRetentionPolicy,
  unsetDefaultRetentionPolicy,
  deleteRetentionPolicy,
  parseRetentionPolicyConfig,
} from "@/services/templates/retention-policy-service";
import { NotFoundError, ServiceError, ValidationError } from "@/lib/logging/errors";
import type { RetentionConfiguration } from "@/lib/core/retention";

const makePolicy = (overrides: object = {}) => ({
  id: "pol-1",
  name: "Keep 7",
  description: null,
  config: JSON.stringify({ mode: "SIMPLE", simple: { keepCount: 7 } }),
  isDefault: false,
  jobDestinations: [],
  adapterConfigs: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const simpleConfig: RetentionConfiguration = {
  mode: "SIMPLE",
  simple: { keepCount: 7 },
};

describe("RetentionPolicyService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Read operations ──────────────────────────────────────────

  describe("getRetentionPolicies", () => {
    it("returns all policies ordered by name", async () => {
      const policies = [makePolicy({ id: "a" }), makePolicy({ id: "b" })];
      prismaMock.retentionPolicy.findMany.mockResolvedValue(policies as any);

      const result = await getRetentionPolicies();

      expect(prismaMock.retentionPolicy.findMany).toHaveBeenCalledWith({
        include: { _count: { select: { jobDestinations: true } } },
        orderBy: { name: "asc" },
      });
      expect(result).toHaveLength(2);
    });
  });

  describe("getRetentionPolicy", () => {
    it("returns policy when found", async () => {
      prismaMock.retentionPolicy.findUnique.mockResolvedValue(
        makePolicy() as any
      );

      await getRetentionPolicy("pol-1");

      expect(prismaMock.retentionPolicy.findUnique).toHaveBeenCalledWith({
        where: { id: "pol-1" },
      });
    });

    it("throws NotFoundError when policy does not exist", async () => {
      prismaMock.retentionPolicy.findUnique.mockResolvedValue(null);

      await expect(getRetentionPolicy("missing")).rejects.toBeInstanceOf(
        NotFoundError
      );
    });
  });

  // ── Create ───────────────────────────────────────────────────

  describe("createRetentionPolicy", () => {
    it("creates a new policy successfully", async () => {
      prismaMock.retentionPolicy.findUnique.mockResolvedValue(null);
      const created = makePolicy({ name: "New" });
      prismaMock.retentionPolicy.create.mockResolvedValue(created as any);

      const result = await createRetentionPolicy({
        name: "New",
        config: simpleConfig,
      });

      expect(prismaMock.retentionPolicy.create).toHaveBeenCalled();
      expect(result).toBe(created);
    });

    it("throws ServiceError when a policy with the same name already exists", async () => {
      prismaMock.retentionPolicy.findUnique.mockResolvedValue(
        makePolicy() as any
      );

      await expect(
        createRetentionPolicy({ name: "Keep 7", config: simpleConfig })
      ).rejects.toBeInstanceOf(ServiceError);
    });

    it("stores an hourly tier", async () => {
      prismaMock.retentionPolicy.findUnique.mockResolvedValue(null);
      prismaMock.retentionPolicy.create.mockResolvedValue(makePolicy() as any);

      await createRetentionPolicy({
        name: "Hourly GFS",
        config: { mode: "SMART", smart: { hourly: 24, daily: 7, weekly: 4, monthly: 12, yearly: 2 } },
      });

      const stored = JSON.parse(
        prismaMock.retentionPolicy.create.mock.calls[0][0].data.config as string
      );
      expect(stored.smart.hourly).toBe(24);
    });

    it("rejects a config with a negative tier instead of storing it", async () => {
      prismaMock.retentionPolicy.findUnique.mockResolvedValue(null);

      await expect(
        createRetentionPolicy({
          name: "Broken",
          config: { mode: "SMART", smart: { hourly: -5, daily: 7, weekly: 4, monthly: 12, yearly: 2 } },
        })
      ).rejects.toBeInstanceOf(ValidationError);

      expect(prismaMock.retentionPolicy.create).not.toHaveBeenCalled();
    });

    it("clears previous default when isDefault is true", async () => {
      prismaMock.retentionPolicy.findUnique.mockResolvedValue(null);
      prismaMock.retentionPolicy.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.retentionPolicy.create.mockResolvedValue(
        makePolicy({ isDefault: true }) as any
      );

      await createRetentionPolicy({
        name: "NewDefault",
        config: simpleConfig,
        isDefault: true,
      });

      expect(prismaMock.retentionPolicy.updateMany).toHaveBeenCalledWith({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    });
  });

  // ── Update ───────────────────────────────────────────────────

  describe("updateRetentionPolicy", () => {
    it("updates an existing policy successfully", async () => {
      prismaMock.retentionPolicy.findUnique
        .mockResolvedValueOnce(makePolicy() as any) // existence check
        .mockResolvedValueOnce(null); // name-collision check - no conflict
      const updated = makePolicy({ name: "Updated" });
      prismaMock.retentionPolicy.update.mockResolvedValue(updated as any);

      const result = await updateRetentionPolicy("pol-1", { name: "Updated" });

      expect(prismaMock.retentionPolicy.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "pol-1" } })
      );
      expect(result).toBe(updated);
    });

    it("throws NotFoundError when policy does not exist", async () => {
      prismaMock.retentionPolicy.findUnique.mockResolvedValue(null);

      await expect(
        updateRetentionPolicy("missing", { name: "x" })
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("throws ServiceError when renaming to an already used name", async () => {
      const policy = makePolicy({ name: "OldName" });
      prismaMock.retentionPolicy.findUnique
        .mockResolvedValueOnce(policy as any)
        .mockResolvedValueOnce(makePolicy({ name: "Taken" }) as any);

      await expect(
        updateRetentionPolicy("pol-1", { name: "Taken" })
      ).rejects.toBeInstanceOf(ServiceError);
    });

    it("clears previous default when isDefault is set to true", async () => {
      prismaMock.retentionPolicy.findUnique.mockResolvedValue(
        makePolicy() as any
      );
      prismaMock.retentionPolicy.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.retentionPolicy.update.mockResolvedValue(
        makePolicy({ isDefault: true }) as any
      );

      await updateRetentionPolicy("pol-1", { isDefault: true });

      expect(prismaMock.retentionPolicy.updateMany).toHaveBeenCalledWith({
        where: { isDefault: true, id: { not: "pol-1" } },
        data: { isDefault: false },
      });
    });

    it("serializes config to JSON when config is provided", async () => {
      prismaMock.retentionPolicy.findUnique.mockResolvedValue(
        makePolicy() as any
      );
      prismaMock.retentionPolicy.update.mockResolvedValue(makePolicy() as any);

      await updateRetentionPolicy("pol-1", { config: simpleConfig });

      expect(prismaMock.retentionPolicy.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            config: JSON.stringify(simpleConfig),
          }),
        })
      );
    });
  });

  // ── Default management ───────────────────────────────────────

  describe("setDefaultRetentionPolicy", () => {
    it("sets the given policy as default", async () => {
      prismaMock.retentionPolicy.findUnique.mockResolvedValue(
        makePolicy() as any
      );
      prismaMock.retentionPolicy.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.retentionPolicy.update.mockResolvedValue(
        makePolicy({ isDefault: true }) as any
      );

      const result = await setDefaultRetentionPolicy("pol-1");

      expect(prismaMock.retentionPolicy.updateMany).toHaveBeenCalledWith({
        where: { isDefault: true },
        data: { isDefault: false },
      });
      expect(prismaMock.retentionPolicy.update).toHaveBeenCalledWith({
        where: { id: "pol-1" },
        data: { isDefault: true },
      });
      expect(result).toBeTruthy();
    });

    it("throws NotFoundError when policy does not exist", async () => {
      prismaMock.retentionPolicy.findUnique.mockResolvedValue(null);

      await expect(
        setDefaultRetentionPolicy("missing")
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("unsetDefaultRetentionPolicy", () => {
    it("clears the default flag from all policies", async () => {
      prismaMock.retentionPolicy.updateMany.mockResolvedValue({ count: 1 });

      await unsetDefaultRetentionPolicy();

      expect(prismaMock.retentionPolicy.updateMany).toHaveBeenCalledWith({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    });
  });

  // ── Delete ───────────────────────────────────────────────────

  describe("deleteRetentionPolicy", () => {
    it("deletes a policy that has no usages", async () => {
      prismaMock.retentionPolicy.findUnique.mockResolvedValue(
        makePolicy({ jobDestinations: [], adapterConfigs: [] }) as any
      );
      prismaMock.retentionPolicy.delete.mockResolvedValue(makePolicy() as any);

      await deleteRetentionPolicy("pol-1");

      expect(prismaMock.retentionPolicy.delete).toHaveBeenCalledWith({
        where: { id: "pol-1" },
      });
    });

    it("throws NotFoundError when policy does not exist", async () => {
      prismaMock.retentionPolicy.findUnique.mockResolvedValue(null);

      await expect(deleteRetentionPolicy("missing")).rejects.toBeInstanceOf(
        NotFoundError
      );
    });

    it("throws ServiceError when policy is still in use", async () => {
      prismaMock.retentionPolicy.findUnique.mockResolvedValue(
        makePolicy({
          jobDestinations: [{ id: "dest-1" }],
          adapterConfigs: [],
        }) as any
      );

      await expect(deleteRetentionPolicy("pol-1")).rejects.toBeInstanceOf(
        ServiceError
      );
    });
  });

  // ── parseRetentionPolicyConfig ───────────────────────────────

  describe("parseRetentionPolicyConfig", () => {
    it("parses valid JSON config correctly", () => {
      const config: RetentionConfiguration = {
        mode: "SIMPLE",
        simple: { keepCount: 5 },
      };
      const result = parseRetentionPolicyConfig(JSON.stringify(config));
      expect(result).toEqual(config);
    });

    it("returns {mode: 'NONE'} for invalid JSON", () => {
      const result = parseRetentionPolicyConfig("{invalid-json}");
      expect(result).toEqual({ mode: "NONE" });
    });
  });
});
