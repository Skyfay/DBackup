import { describe, it, expect } from "vitest";
import { NOTIFICATION_EVENTS } from "@/lib/notifications/types";
import {
  EVENT_DEFINITIONS,
  getEventDefinition,
  getEventsByCategory,
} from "@/lib/notifications/events";

describe("Notification Types & Constants", () => {
  describe("NOTIFICATION_EVENTS", () => {
    it("should define all 11 event types", () => {
      expect(Object.keys(NOTIFICATION_EVENTS)).toHaveLength(11);
    });

    it("should have unique event string values", () => {
      const values = Object.values(NOTIFICATION_EVENTS);
      const unique = new Set(values);
      expect(unique.size).toBe(values.length);
    });

    it("should contain expected event keys", () => {
      expect(NOTIFICATION_EVENTS.USER_LOGIN).toBe("user_login");
      expect(NOTIFICATION_EVENTS.USER_CREATED).toBe("user_created");
      expect(NOTIFICATION_EVENTS.BACKUP_SUCCESS).toBe("backup_success");
      expect(NOTIFICATION_EVENTS.BACKUP_FAILURE).toBe("backup_failure");
      expect(NOTIFICATION_EVENTS.RESTORE_COMPLETE).toBe("restore_complete");
      expect(NOTIFICATION_EVENTS.RESTORE_FAILURE).toBe("restore_failure");
      expect(NOTIFICATION_EVENTS.CONFIG_BACKUP).toBe("config_backup");
      expect(NOTIFICATION_EVENTS.SYSTEM_ERROR).toBe("system_error");
      expect(NOTIFICATION_EVENTS.STORAGE_USAGE_SPIKE).toBe("storage_usage_spike");
      expect(NOTIFICATION_EVENTS.STORAGE_LIMIT_WARNING).toBe("storage_limit_warning");
      expect(NOTIFICATION_EVENTS.STORAGE_MISSING_BACKUP).toBe("storage_missing_backup");
    });
  });
});

describe("Notification Event Registry", () => {
  describe("EVENT_DEFINITIONS", () => {
    it("should define 9 system events (no backup events)", () => {
      // Backup events are excluded from system notifications (per-job only)
      // 6 original + 3 storage events = 9
      expect(EVENT_DEFINITIONS.length).toBe(9);
    });

    it("should have unique event IDs", () => {
      const ids = EVENT_DEFINITIONS.map((e) => e.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("should assign valid categories to all events", () => {
      const validCategories = ["auth", "backup", "restore", "system", "storage"];
      for (const event of EVENT_DEFINITIONS) {
        expect(validCategories).toContain(event.category);
      }
    });

    it("should have 3 storage events", () => {
      const storageEvents = EVENT_DEFINITIONS.filter((e) => e.category === "storage");
      expect(storageEvents).toHaveLength(3);
    });

    it("should have all storage events enabled by default", () => {
      const storageEvents = EVENT_DEFINITIONS.filter((e) => e.category === "storage");
      for (const event of storageEvents) {
        expect(event.defaultEnabled).toBe(true);
      }
    });

    it("should mark auth events as supporting notifyUser", () => {
      const authEvents = EVENT_DEFINITIONS.filter((e) => e.category === "auth");
      for (const event of authEvents) {
        expect(event.supportsNotifyUser).toBe(true);
      }
    });

    it("should not mark non-auth events as supporting notifyUser", () => {
      const nonAuth = EVENT_DEFINITIONS.filter((e) => e.category !== "auth");
      for (const event of nonAuth) {
        expect(event.supportsNotifyUser).toBeFalsy();
      }
    });

    it("should have SYSTEM_ERROR enabled by default", () => {
      const systemError = EVENT_DEFINITIONS.find(
        (e) => e.id === NOTIFICATION_EVENTS.SYSTEM_ERROR
      );
      expect(systemError?.defaultEnabled).toBe(true);
    });

    it("should have USER_LOGIN disabled by default", () => {
      const userLogin = EVENT_DEFINITIONS.find(
        (e) => e.id === NOTIFICATION_EVENTS.USER_LOGIN
      );
      expect(userLogin?.defaultEnabled).toBe(false);
    });
  });

  describe("getEventDefinition", () => {
    it("should find existing event by type", () => {
      const def = getEventDefinition(NOTIFICATION_EVENTS.USER_LOGIN);
      expect(def).toBeDefined();
      expect(def!.id).toBe("user_login");
      expect(def!.name).toBe("User Login");
    });

    it("should return undefined for unknown event type", () => {
      const def = getEventDefinition("nonexistent_event");
      expect(def).toBeUndefined();
    });
  });

  describe("getEventsByCategory", () => {
    it("should group events by category", () => {
      const grouped = getEventsByCategory();

      expect(grouped.auth).toBeDefined();
      expect(grouped.auth.length).toBeGreaterThan(0);

      expect(grouped.restore).toBeDefined();
      expect(grouped.system).toBeDefined();
      expect(grouped.storage).toBeDefined();
      expect(grouped.storage.length).toBe(3);
    });

    it("should include all events across all categories", () => {
      const grouped = getEventsByCategory();
      const totalGrouped = Object.values(grouped).flat().length;
      expect(totalGrouped).toBe(EVENT_DEFINITIONS.length);
    });

    it("should have auth events in auth category", () => {
      const grouped = getEventsByCategory();
      const authIds = grouped.auth.map((e) => e.id);
      expect(authIds).toContain(NOTIFICATION_EVENTS.USER_LOGIN);
      expect(authIds).toContain(NOTIFICATION_EVENTS.USER_CREATED);
    });

    it("should have storage events in storage category", () => {
      const grouped = getEventsByCategory();
      const storageIds = grouped.storage.map((e) => e.id);
      expect(storageIds).toContain(NOTIFICATION_EVENTS.STORAGE_USAGE_SPIKE);
      expect(storageIds).toContain(NOTIFICATION_EVENTS.STORAGE_LIMIT_WARNING);
      expect(storageIds).toContain(NOTIFICATION_EVENTS.STORAGE_MISSING_BACKUP);
    });
  });
});
