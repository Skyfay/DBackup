import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { NOTIFICATION_EVENTS } from "@/lib/notifications/types";

// Mock dependencies before importing the service
vi.mock("@/lib/adapters", () => ({
  registerAdapters: vi.fn(),
}));

vi.mock("@/lib/crypto", () => ({
  decryptConfig: vi.fn((config: any) => config),
}));

const mockSend = vi.fn().mockResolvedValue(true);

vi.mock("@/lib/core/registry", () => ({
  registry: {
    get: vi.fn(() => ({
      id: "email",
      type: "notification",
      send: mockSend,
    })),
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

vi.mock("@/lib/errors", () => ({
  wrapError: vi.fn((e: any) => e),
}));

import {
  getNotificationConfig,
  saveNotificationConfig,
  notify,
} from "@/services/system-notification-service";
import { registry } from "@/lib/core/registry";

describe("SystemNotificationService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Config Management ─────────────────────────────────────────

  describe("getNotificationConfig", () => {
    it("should return default config when no setting exists", async () => {
      prismaMock.systemSetting.findUnique.mockResolvedValue(null);

      const config = await getNotificationConfig();

      expect(config).toEqual({ globalChannels: [], events: {} });
    });

    it("should parse stored JSON config", async () => {
      const stored = {
        globalChannels: ["ch-1"],
        events: {
          user_login: { enabled: true, channels: null, notifyUser: "none" },
        },
      };

      prismaMock.systemSetting.findUnique.mockResolvedValue({
        id: "1",
        key: "notifications.config",
        value: JSON.stringify(stored),
        description: null,
      });

      const config = await getNotificationConfig();

      expect(config.globalChannels).toEqual(["ch-1"]);
      expect(config.events.user_login.enabled).toBe(true);
    });

    it("should return defaults for invalid JSON", async () => {
      prismaMock.systemSetting.findUnique.mockResolvedValue({
        id: "1",
        key: "notifications.config",
        value: "{{invalid json",
        description: null,
      });

      const config = await getNotificationConfig();

      expect(config).toEqual({ globalChannels: [], events: {} });
    });
  });

  describe("saveNotificationConfig", () => {
    it("should upsert config to SystemSetting", async () => {
      const config = {
        globalChannels: ["ch-1", "ch-2"],
        events: {
          user_login: { enabled: true, channels: null },
        },
      };

      prismaMock.systemSetting.upsert.mockResolvedValue({
        id: "1",
        key: "notifications.config",
        value: JSON.stringify(config),
        description: null,
      });

      await saveNotificationConfig(config as any);

      expect(prismaMock.systemSetting.upsert).toHaveBeenCalledWith({
        where: { key: "notifications.config" },
        update: { value: JSON.stringify(config) },
        create: {
          key: "notifications.config",
          value: JSON.stringify(config),
          description: expect.any(String),
        },
      });
    });
  });

  // ── Notification Dispatch ─────────────────────────────────────

  describe("notify", () => {
    const emailChannel = {
      id: "ch-email",
      name: "SMTP",
      adapterId: "email",
      type: "notification",
      config: JSON.stringify({ host: "smtp.test.com", from: "bot@test.com", to: "admin@test.com" }),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const discordChannel = {
      id: "ch-discord",
      name: "Discord",
      adapterId: "discord",
      type: "notification",
      config: JSON.stringify({ webhookUrl: "https://discord.com/api/webhooks/xxx" }),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it("should skip disabled events", async () => {
      prismaMock.systemSetting.findUnique.mockResolvedValue({
        id: "1",
        key: "notifications.config",
        value: JSON.stringify({
          globalChannels: ["ch-email"],
          events: { user_login: { enabled: false, channels: null } },
        }),
        description: null,
      });

      await notify({
        eventType: NOTIFICATION_EVENTS.USER_LOGIN,
        data: {
          userName: "Alice",
          email: "alice@test.com",
          timestamp: "2026-02-15T12:00:00Z",
        },
      });

      expect(mockSend).not.toHaveBeenCalled();
    });

    it("should skip when no channels are configured", async () => {
      prismaMock.systemSetting.findUnique.mockResolvedValue({
        id: "1",
        key: "notifications.config",
        value: JSON.stringify({
          globalChannels: [],
          events: { user_login: { enabled: true, channels: null } },
        }),
        description: null,
      });

      await notify({
        eventType: NOTIFICATION_EVENTS.USER_LOGIN,
        data: {
          userName: "Alice",
          email: "alice@test.com",
          timestamp: "2026-02-15T12:00:00Z",
        },
      });

      expect(mockSend).not.toHaveBeenCalled();
    });

    it("should send through configured channels", async () => {
      prismaMock.systemSetting.findUnique.mockResolvedValue({
        id: "1",
        key: "notifications.config",
        value: JSON.stringify({
          globalChannels: ["ch-email"],
          events: { user_login: { enabled: true, channels: null } },
        }),
        description: null,
      });

      prismaMock.adapterConfig.findMany.mockResolvedValue([emailChannel]);

      await notify({
        eventType: NOTIFICATION_EVENTS.USER_LOGIN,
        data: {
          userName: "Alice",
          email: "alice@test.com",
          timestamp: "2026-02-15T12:00:00Z",
        },
      });

      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ host: "smtp.test.com" }),
        expect.stringContaining("Alice"),
        expect.objectContaining({
          title: "User Login",
          success: true,
          eventType: "user_login",
        })
      );
    });

    it("should use event-level channel overrides over global channels", async () => {
      prismaMock.systemSetting.findUnique.mockResolvedValue({
        id: "1",
        key: "notifications.config",
        value: JSON.stringify({
          globalChannels: ["ch-email"],
          events: {
            user_login: { enabled: true, channels: ["ch-discord"] },
          },
        }),
        description: null,
      });

      prismaMock.adapterConfig.findMany.mockResolvedValue([discordChannel]);

      await notify({
        eventType: NOTIFICATION_EVENTS.USER_LOGIN,
        data: {
          userName: "Alice",
          email: "alice@test.com",
          timestamp: "2026-02-15T12:00:00Z",
        },
      });

      // Should query for discord channel, not email
      expect(prismaMock.adapterConfig.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ["ch-discord"] }, type: "notification" },
        })
      );
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it("should use event defaultEnabled when no explicit config exists", async () => {
      // SYSTEM_ERROR has defaultEnabled: true
      prismaMock.systemSetting.findUnique.mockResolvedValue({
        id: "1",
        key: "notifications.config",
        value: JSON.stringify({
          globalChannels: ["ch-email"],
          events: {}, // no explicit config for system_error
        }),
        description: null,
      });

      prismaMock.adapterConfig.findMany.mockResolvedValue([emailChannel]);

      await notify({
        eventType: NOTIFICATION_EVENTS.SYSTEM_ERROR,
        data: {
          component: "Scheduler",
          error: "Cron error",
          timestamp: "2026-02-15T12:00:00Z",
        },
      });

      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it("should not send through admin channels when notifyUser is 'only'", async () => {
      prismaMock.systemSetting.findUnique.mockResolvedValue({
        id: "1",
        key: "notifications.config",
        value: JSON.stringify({
          globalChannels: ["ch-email"],
          events: {
            user_login: {
              enabled: true,
              channels: null,
              notifyUser: "only",
            },
          },
        }),
        description: null,
      });

      prismaMock.adapterConfig.findMany.mockResolvedValue([emailChannel]);

      await notify({
        eventType: NOTIFICATION_EVENTS.USER_LOGIN,
        data: {
          userName: "Alice",
          email: "alice@test.com",
          timestamp: "2026-02-15T12:00:00Z",
        },
      });

      // Should only send one user-targeted email, not admin + user
      expect(mockSend).toHaveBeenCalledTimes(1);
      // The user-targeted call should have the user's email as `to`
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ to: "alice@test.com" }),
        expect.any(String),
        expect.any(Object)
      );
    });

    it("should send to both admin and user when notifyUser is 'also'", async () => {
      prismaMock.systemSetting.findUnique.mockResolvedValue({
        id: "1",
        key: "notifications.config",
        value: JSON.stringify({
          globalChannels: ["ch-email"],
          events: {
            user_login: {
              enabled: true,
              channels: null,
              notifyUser: "also",
            },
          },
        }),
        description: null,
      });

      prismaMock.adapterConfig.findMany.mockResolvedValue([emailChannel]);

      await notify({
        eventType: NOTIFICATION_EVENTS.USER_LOGIN,
        data: {
          userName: "Alice",
          email: "alice@test.com",
          timestamp: "2026-02-15T12:00:00Z",
        },
      });

      // Should send twice: once to admin, once to user
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it("should never throw even when adapter fails", async () => {
      prismaMock.systemSetting.findUnique.mockResolvedValue({
        id: "1",
        key: "notifications.config",
        value: JSON.stringify({
          globalChannels: ["ch-email"],
          events: { system_error: { enabled: true, channels: null } },
        }),
        description: null,
      });

      prismaMock.adapterConfig.findMany.mockResolvedValue([emailChannel]);
      mockSend.mockRejectedValueOnce(new Error("SMTP timeout"));

      // Should not throw
      await expect(
        notify({
          eventType: NOTIFICATION_EVENTS.SYSTEM_ERROR,
          data: {
            component: "Test",
            error: "Test error",
            timestamp: "2026-02-15T12:00:00Z",
          },
        })
      ).resolves.toBeUndefined();
    });

    it("should not throw when config loading fails", async () => {
      prismaMock.systemSetting.findUnique.mockRejectedValue(
        new Error("DB connection lost")
      );

      await expect(
        notify({
          eventType: NOTIFICATION_EVENTS.USER_LOGIN,
          data: {
            userName: "Alice",
            email: "alice@test.com",
            timestamp: "2026-02-15T12:00:00Z",
          },
        })
      ).resolves.toBeUndefined();
    });

    it("should skip notifyUser for events that don't support it", async () => {
      // CONFIG_BACKUP does not have supportsNotifyUser
      prismaMock.systemSetting.findUnique.mockResolvedValue({
        id: "1",
        key: "notifications.config",
        value: JSON.stringify({
          globalChannels: ["ch-email"],
          events: {
            config_backup: {
              enabled: true,
              channels: null,
              notifyUser: "also",
            },
          },
        }),
        description: null,
      });

      prismaMock.adapterConfig.findMany.mockResolvedValue([emailChannel]);

      await notify({
        eventType: NOTIFICATION_EVENTS.CONFIG_BACKUP,
        data: {
          encrypted: true,
          timestamp: "2026-02-15T12:00:00Z",
        },
      });

      // Should send only once (admin channel), no user-targeted email
      expect(mockSend).toHaveBeenCalledTimes(1);
      // Should NOT have overridden the to field
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ to: "admin@test.com" }),
        expect.any(String),
        expect.any(Object)
      );
    });
  });
});
