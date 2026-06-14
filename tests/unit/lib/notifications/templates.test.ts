import { describe, it, expect } from "vitest";
import { renderTemplate } from "@/lib/notifications/templates";
import { NOTIFICATION_EVENTS } from "@/lib/notifications/types";
// Import from the barrel to give index.ts coverage
import {
  NOTIFICATION_EVENTS as BARREL_EVENTS,
  renderTemplate as barrelRenderTemplate,
  getEventDefinition,
  getEventsByCategory,
} from "@/lib/notifications";

describe("Notification Templates", () => {
  describe("renderTemplate", () => {
    describe("USER_LOGIN", () => {
      it("should render login payload with all fields", () => {
        const payload = renderTemplate({
          eventType: NOTIFICATION_EVENTS.USER_LOGIN,
          data: {
            userName: "Alice",
            email: "alice@example.com",
            ipAddress: "192.168.1.1",
            timestamp: "2026-02-15T12:00:00Z",
          },
        });

        expect(payload.title).toBe("User Login");
        expect(payload.message).toContain("Alice");
        expect(payload.message).toContain("alice@example.com");
        expect(payload.success).toBe(true);
        expect(payload.color).toBe("#3b82f6"); // blue
        expect(payload.fields).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: "User", value: "Alice" }),
            expect.objectContaining({ name: "Email", value: "alice@example.com" }),
            expect.objectContaining({ name: "IP Address", value: "192.168.1.1" }),
            expect.objectContaining({ name: "Time" }),
          ])
        );
      });

      it("should omit IP address field when not provided", () => {
        const payload = renderTemplate({
          eventType: NOTIFICATION_EVENTS.USER_LOGIN,
          data: {
            userName: "Bob",
            email: "bob@example.com",
            timestamp: "2026-02-15T12:00:00Z",
          },
        });

        const fieldNames = payload.fields?.map((f) => f.name) ?? [];
        expect(fieldNames).not.toContain("IP Address");
        expect(fieldNames).toContain("User");
        expect(fieldNames).toContain("Email");
      });
    });

    describe("USER_CREATED", () => {
      it("should render user created payload", () => {
        const payload = renderTemplate({
          eventType: NOTIFICATION_EVENTS.USER_CREATED,
          data: {
            userName: "NewUser",
            email: "new@example.com",
            createdBy: "Admin",
            timestamp: "2026-02-15T12:00:00Z",
          },
        });

        expect(payload.title).toBe("New User Created");
        expect(payload.message).toContain("NewUser");
        expect(payload.success).toBe(true);
        expect(payload.color).toBe("#22c55e"); // green
        expect(payload.fields).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: "Created By", value: "Admin" }),
          ])
        );
      });

      it("should omit createdBy when not provided", () => {
        const payload = renderTemplate({
          eventType: NOTIFICATION_EVENTS.USER_CREATED,
          data: {
            userName: "NewUser",
            email: "new@example.com",
            timestamp: "2026-02-15T12:00:00Z",
          },
        });

        const fieldNames = payload.fields?.map((f) => f.name) ?? [];
        expect(fieldNames).not.toContain("Created By");
      });
    });

    describe("BACKUP_SUCCESS", () => {
      it("should render successful backup with all details", () => {
        const payload = renderTemplate({
          eventType: NOTIFICATION_EVENTS.BACKUP_SUCCESS,
          data: {
            jobName: "Daily MySQL",
            sourceName: "mysql-prod",
            duration: 5000,
            size: 1048576,
            timestamp: "2026-02-15T12:00:00Z",
          },
        });

        expect(payload.title).toBe("Backup Successful: Daily MySQL");
        expect(payload.message).toContain("Daily MySQL");
        expect(payload.success).toBe(true);
        expect(payload.color).toBe("#22c55e");
        expect(payload.fields).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: "Job", value: "Daily MySQL" }),
            expect.objectContaining({ name: "Source", value: "mysql-prod" }),
            expect.objectContaining({ name: "Duration", value: "5s" }),
            expect.objectContaining({ name: "Size", value: expect.stringContaining("1") }),
          ])
        );
      });

      it("should omit optional fields when not provided", () => {
        const payload = renderTemplate({
          eventType: NOTIFICATION_EVENTS.BACKUP_SUCCESS,
          data: {
            jobName: "Minimal Job",
            timestamp: "2026-02-15T12:00:00Z",
          },
        });

        const fieldNames = payload.fields?.map((f) => f.name) ?? [];
        expect(fieldNames).toContain("Job");
        expect(fieldNames).not.toContain("Source");
        expect(fieldNames).not.toContain("Duration");
        expect(fieldNames).not.toContain("Size");
      });
    });

    describe("BACKUP_FAILURE", () => {
      it("should render failure with error details", () => {
        const payload = renderTemplate({
          eventType: NOTIFICATION_EVENTS.BACKUP_FAILURE,
          data: {
            jobName: "Daily MySQL",
            error: "Connection refused",
            timestamp: "2026-02-15T12:00:00Z",
          },
        });

        expect(payload.title).toBe("Backup Failed: Daily MySQL");
        expect(payload.message).toContain("Connection refused");
        expect(payload.success).toBe(false);
        expect(payload.color).toBe("#ef4444"); // red
        expect(payload.fields).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: "Error", value: "Connection refused" }),
          ])
        );
      });

      it("should handle failure without error message", () => {
        const payload = renderTemplate({
          eventType: NOTIFICATION_EVENTS.BACKUP_FAILURE,
          data: {
            jobName: "Job",
            timestamp: "2026-02-15T12:00:00Z",
          },
        });

        expect(payload.success).toBe(false);
        const fieldNames = payload.fields?.map((f) => f.name) ?? [];
        expect(fieldNames).not.toContain("Error");
      });
    });

    describe("RESTORE_COMPLETE", () => {
      it("should render successful restore", () => {
        const payload = renderTemplate({
          eventType: NOTIFICATION_EVENTS.RESTORE_COMPLETE,
          data: {
            sourceName: "mysql-prod",
            targetDatabase: "staging_db",
            duration: 3000,
            timestamp: "2026-02-15T12:00:00Z",
          },
        });

        expect(payload.title).toBe("Restore Completed");
        expect(payload.message).toContain("staging_db");
        expect(payload.success).toBe(true);
        expect(payload.fields).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: "Target DB", value: "staging_db" }),
            expect.objectContaining({ name: "Duration", value: "3s" }),
          ])
        );
      });

      it("should render all optional fields when provided", () => {
        const payload = renderTemplate({
          eventType: NOTIFICATION_EVENTS.RESTORE_COMPLETE,
          data: {
            sourceName: "mysql-prod",
            targetDatabase: "staging_db",
            databaseType: "mysql",
            storageName: "s3-bucket",
            backupFile: "backup.sql",
            size: 2048,
            duration: 4000,
            timestamp: "2026-02-15T12:00:00Z",
          },
        });

        const fieldNames = payload.fields?.map((f) => f.name) ?? [];
        expect(fieldNames).toContain("Database Type");
        expect(fieldNames).toContain("Storage");
        expect(fieldNames).toContain("Backup File");
        expect(fieldNames).toContain("Size");
      });

      it("should omit Target DB from message when targetDatabase is not provided", () => {
        const payload = renderTemplate({
          eventType: NOTIFICATION_EVENTS.RESTORE_COMPLETE,
          data: { timestamp: "2026-02-15T12:00:00Z" },
        });

        expect(payload.message).not.toContain("Target:");
        const fieldNames = payload.fields?.map((f) => f.name) ?? [];
        expect(fieldNames).not.toContain("Target DB");
      });
    });

    describe("RESTORE_FAILURE", () => {
      it("should render failed restore with error", () => {
        const payload = renderTemplate({
          eventType: NOTIFICATION_EVENTS.RESTORE_FAILURE,
          data: {
            sourceName: "mysql-prod",
            error: "Permission denied",
            timestamp: "2026-02-15T12:00:00Z",
          },
        });

        expect(payload.title).toBe("Restore Failed");
        expect(payload.success).toBe(false);
        expect(payload.color).toBe("#ef4444");
        expect(payload.fields).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: "Error", value: "Permission denied" }),
          ])
        );
      });

      it("should render all optional fields when provided", () => {
        const payload = renderTemplate({
          eventType: NOTIFICATION_EVENTS.RESTORE_FAILURE,
          data: {
            sourceName: "mysql-prod",
            databaseType: "mysql",
            targetDatabase: "staging_db",
            backupFile: "backup.sql",
            error: "timeout",
            duration: 1000,
            timestamp: "2026-02-15T12:00:00Z",
          },
        });

        const fieldNames = payload.fields?.map((f) => f.name) ?? [];
        expect(fieldNames).toContain("Database Type");
        expect(fieldNames).toContain("Target DB");
        expect(fieldNames).toContain("Backup File");
        expect(fieldNames).toContain("Duration");
      });

      it("should render minimal payload when no optional fields are provided", () => {
        const payload = renderTemplate({
          eventType: NOTIFICATION_EVENTS.RESTORE_FAILURE,
          data: { timestamp: "2026-02-15T12:00:00Z" },
        });

        expect(payload.success).toBe(false);
        expect(payload.message).toBe("Database restore failed.");
        const fieldNames = payload.fields?.map((f) => f.name) ?? [];
        expect(fieldNames).not.toContain("Source");
        expect(fieldNames).not.toContain("Error");
      });
    });

    describe("CONFIG_BACKUP", () => {
      it("should render config backup notification", () => {
        const payload = renderTemplate({
          eventType: NOTIFICATION_EVENTS.CONFIG_BACKUP,
          data: {
            fileName: "config_backup.json.gz.enc",
            size: 2048,
            encrypted: true,
            timestamp: "2026-02-15T12:00:00Z",
          },
        });

        expect(payload.title).toBe("Configuration Backup Created");
        expect(payload.message).toContain("Encrypted");
        expect(payload.success).toBe(true);
        expect(payload.color).toBe("#8b5cf6"); // purple
        expect(payload.fields).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: "File", value: "config_backup.json.gz.enc" }),
            expect.objectContaining({ name: "Encrypted", value: "Yes" }),
          ])
        );
      });

      it("should show unencrypted status", () => {
        const payload = renderTemplate({
          eventType: NOTIFICATION_EVENTS.CONFIG_BACKUP,
          data: {
            encrypted: false,
            timestamp: "2026-02-15T12:00:00Z",
          },
        });

        expect(payload.fields).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: "Encrypted", value: "No" }),
          ])
        );
      });
    });

    describe("SYSTEM_ERROR", () => {
      it("should render system error with details", () => {
        const payload = renderTemplate({
          eventType: NOTIFICATION_EVENTS.SYSTEM_ERROR,
          data: {
            component: "Scheduler",
            error: "Cron parse error",
            details: "Invalid expression: '* * *'",
            timestamp: "2026-02-15T12:00:00Z",
          },
        });

        expect(payload.title).toBe("System Error");
        expect(payload.message).toContain("Scheduler");
        expect(payload.message).toContain("Cron parse error");
        expect(payload.success).toBe(false);
        expect(payload.color).toBe("#ef4444");
        expect(payload.fields).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: "Component", value: "Scheduler" }),
            expect.objectContaining({ name: "Error", value: "Cron parse error" }),
            expect.objectContaining({ name: "Details", value: "Invalid expression: '* * *'" }),
          ])
        );
      });

      it("should omit details field when not provided", () => {
        const payload = renderTemplate({
          eventType: NOTIFICATION_EVENTS.SYSTEM_ERROR,
          data: {
            component: "Queue",
            error: "Timeout",
            timestamp: "2026-02-15T12:00:00Z",
          },
        });

        const fieldNames = payload.fields?.map((f) => f.name) ?? [];
        expect(fieldNames).not.toContain("Details");
      });
    });

    describe("Unknown event type fallback", () => {
      it("should return generic payload for unknown events", () => {
        const payload = renderTemplate({
          eventType: "unknown_event" as any,
          data: {} as any,
        });

        expect(payload.title).toBe("Notification");
        expect(payload.message).toBe("An event occurred.");
        expect(payload.success).toBe(true);
      });
    });

    // ── Storage Alert Templates ──────────────────────────────────

    describe("STORAGE_USAGE_SPIKE", () => {
      it("should render spike payload for increase", () => {
        const payload = renderTemplate({
          eventType: NOTIFICATION_EVENTS.STORAGE_USAGE_SPIKE,
          data: {
            storageName: "S3 Prod",
            previousSize: 1073741824, // 1 GB
            currentSize: 1610612736,  // 1.5 GB
            changePercent: 50,
            timestamp: "2026-02-22T10:00:00Z",
          },
        });

        expect(payload.title).toBe("Storage Usage Spike");
        expect(payload.message).toContain("S3 Prod");
        expect(payload.message).toContain("increased");
        expect(payload.message).toContain("50.0%");
        expect(payload.success).toBe(false);
        expect(payload.badge).toBe("Alert");
        expect(payload.color).toBe("#f59e0b"); // amber
        expect(payload.fields).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: "Storage", value: "S3 Prod" }),
            expect.objectContaining({ name: "Change", value: "+50.0%" }),
            expect.objectContaining({ name: "Previous Size" }),
            expect.objectContaining({ name: "Current Size" }),
            expect.objectContaining({ name: "Time" }),
          ])
        );
      });

      it("should render spike payload for decrease", () => {
        const payload = renderTemplate({
          eventType: NOTIFICATION_EVENTS.STORAGE_USAGE_SPIKE,
          data: {
            storageName: "Local Backup",
            previousSize: 2147483648, // 2 GB
            currentSize: 1073741824,  // 1 GB
            changePercent: -50,
            timestamp: "2026-02-22T10:00:00Z",
          },
        });

        expect(payload.message).toContain("decreased");
        expect(payload.message).toContain("50.0%");
        expect(payload.fields).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: "Change", value: "-50.0%" }),
          ])
        );
      });
    });

    describe("STORAGE_LIMIT_WARNING", () => {
      it("should render limit warning payload", () => {
        const payload = renderTemplate({
          eventType: NOTIFICATION_EVENTS.STORAGE_LIMIT_WARNING,
          data: {
            storageName: "NAS Storage",
            currentSize: 9663676416,  // ~9 GB
            limitSize: 10737418240,   // 10 GB
            usagePercent: 90,
            timestamp: "2026-02-22T10:00:00Z",
          },
        });

        expect(payload.title).toBe("Storage Limit Warning");
        expect(payload.message).toContain("NAS Storage");
        expect(payload.message).toContain("90.0%");
        expect(payload.success).toBe(false);
        expect(payload.badge).toBe("Alert");
        expect(payload.color).toBe("#ef4444"); // red
        expect(payload.fields).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: "Storage", value: "NAS Storage" }),
            expect.objectContaining({ name: "Usage", value: "90.0%" }),
            expect.objectContaining({ name: "Current Size" }),
            expect.objectContaining({ name: "Limit" }),
            expect.objectContaining({ name: "Time" }),
          ])
        );
      });
    });

    describe("STORAGE_MISSING_BACKUP", () => {
      it("should render missing backup payload with last backup date", () => {
        const payload = renderTemplate({
          eventType: NOTIFICATION_EVENTS.STORAGE_MISSING_BACKUP,
          data: {
            storageName: "S3 Archive",
            lastBackupAt: "2026-02-20T08:00:00Z",
            thresholdHours: 48,
            hoursSinceLastBackup: 50,
            timestamp: "2026-02-22T10:00:00Z",
          },
        });

        expect(payload.title).toBe("Missing Backup Alert");
        expect(payload.message).toContain("S3 Archive");
        expect(payload.message).toContain("50 hours");
        expect(payload.message).toContain("48h");
        expect(payload.success).toBe(false);
        expect(payload.badge).toBe("Alert");
        expect(payload.color).toBe("#3b82f6"); // blue
        expect(payload.fields).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: "Storage", value: "S3 Archive" }),
            expect.objectContaining({ name: "Hours Since Last Backup", value: "50h" }),
            expect.objectContaining({ name: "Threshold", value: "48h" }),
            expect.objectContaining({ name: "Last Backup" }),
            expect.objectContaining({ name: "Time" }),
          ])
        );
      });

      it("should omit last backup field when not provided", () => {
        const payload = renderTemplate({
          eventType: NOTIFICATION_EVENTS.STORAGE_MISSING_BACKUP,
          data: {
            storageName: "Local",
            thresholdHours: 24,
            hoursSinceLastBackup: 30,
            timestamp: "2026-02-22T10:00:00Z",
          },
        });

        const fieldNames = payload.fields?.map((f) => f.name) ?? [];
        expect(fieldNames).not.toContain("Last Backup");
        expect(fieldNames).toContain("Storage");
        expect(fieldNames).toContain("Hours Since Last Backup");
      });
    });

    // ── Update / Connection Templates ─────────────────────────────

    describe("UPDATE_AVAILABLE", () => {
      it("should render update available payload with releaseUrl", () => {
        const payload = renderTemplate({
          eventType: NOTIFICATION_EVENTS.UPDATE_AVAILABLE,
          data: {
            latestVersion: "2.0.0",
            currentVersion: "1.5.0",
            releaseUrl: "https://github.com/dbackup/releases/2.0.0",
            timestamp: "2026-02-22T10:00:00Z",
          },
        });

        expect(payload.title).toBe("Update Available");
        expect(payload.message).toContain("2.0.0");
        expect(payload.message).toContain("1.5.0");
        expect(payload.success).toBe(true);
        expect(payload.badge).toBe("Update");
        expect(payload.color).toBe("#3b82f6");
        const fieldNames = payload.fields?.map((f) => f.name) ?? [];
        expect(fieldNames).toContain("Latest Version");
        expect(fieldNames).toContain("Current Version");
        expect(fieldNames).toContain("Release Notes");
      });

      it("should omit Release Notes field when releaseUrl is not provided", () => {
        const payload = renderTemplate({
          eventType: NOTIFICATION_EVENTS.UPDATE_AVAILABLE,
          data: {
            latestVersion: "2.0.0",
            currentVersion: "1.5.0",
            timestamp: "2026-02-22T10:00:00Z",
          },
        });

        const fieldNames = payload.fields?.map((f) => f.name) ?? [];
        expect(fieldNames).not.toContain("Release Notes");
      });
    });

    describe("CONNECTION_OFFLINE", () => {
      it("should render database source as offline with last error", () => {
        const payload = renderTemplate({
          eventType: NOTIFICATION_EVENTS.CONNECTION_OFFLINE,
          data: {
            adapterName: "prod-mysql",
            adapterType: "database",
            adapterId: "mysql",
            consecutiveFailures: 3,
            lastError: "ECONNREFUSED",
            timestamp: "2026-02-22T10:00:00Z",
          },
        });

        expect(payload.title).toBe("Source Offline");
        expect(payload.message).toContain("prod-mysql");
        expect(payload.message).toContain("3");
        expect(payload.success).toBe(false);
        expect(payload.badge).toBe("Offline");
        expect(payload.color).toBe("#ef4444");
        const fieldNames = payload.fields?.map((f) => f.name) ?? [];
        expect(fieldNames).toContain("Source");
        expect(fieldNames).toContain("Type");
        expect(fieldNames).toContain("Failed Checks");
        expect(fieldNames).toContain("Last Error");
      });

      it("should use Destination label for storage adapter type", () => {
        const payload = renderTemplate({
          eventType: NOTIFICATION_EVENTS.CONNECTION_OFFLINE,
          data: {
            adapterName: "s3-bucket",
            adapterType: "storage",
            adapterId: "s3",
            consecutiveFailures: 1,
            timestamp: "2026-02-22T10:00:00Z",
          },
        });

        expect(payload.title).toBe("Destination Offline");
        const fieldNames = payload.fields?.map((f) => f.name) ?? [];
        expect(fieldNames).not.toContain("Last Error");
      });
    });

    describe("CONNECTION_ONLINE", () => {
      it("should render database source as recovered with downtime", () => {
        const payload = renderTemplate({
          eventType: NOTIFICATION_EVENTS.CONNECTION_ONLINE,
          data: {
            adapterName: "prod-mysql",
            adapterType: "database",
            adapterId: "mysql",
            downtime: "15m",
            timestamp: "2026-02-22T10:00:00Z",
          },
        });

        expect(payload.title).toBe("Source Recovered");
        expect(payload.message).toContain("prod-mysql");
        expect(payload.message).toContain("15m");
        expect(payload.success).toBe(true);
        expect(payload.badge).toBe("Recovered");
        expect(payload.color).toBe("#22c55e");
        const fieldNames = payload.fields?.map((f) => f.name) ?? [];
        expect(fieldNames).toContain("Downtime");
      });

      it("should use Destination label for storage adapter and omit downtime when not provided", () => {
        const payload = renderTemplate({
          eventType: NOTIFICATION_EVENTS.CONNECTION_ONLINE,
          data: {
            adapterName: "s3-bucket",
            adapterType: "storage",
            adapterId: "s3",
            timestamp: "2026-02-22T10:00:00Z",
          },
        });

        expect(payload.title).toBe("Destination Recovered");
        const fieldNames = payload.fields?.map((f) => f.name) ?? [];
        expect(fieldNames).not.toContain("Downtime");
      });
    });

    describe("DB_VERSION_CHANGED", () => {
      it("renders payload with all fields including edition", () => {
        const payload = renderTemplate({
          eventType: NOTIFICATION_EVENTS.DB_VERSION_CHANGED,
          data: {
            sourceName: "prod-mssql",
            sourceId: "src-1",
            adapterId: "mssql",
            previousVersion: "15.0.4280.7",
            newVersion: "15.0.4360.2",
            edition: "Enterprise Edition",
            timestamp: "2026-05-31T10:00:00Z",
            isDowngrade: false,
          },
        });

        expect(payload.title).toBe("Database Version Upgraded: prod-mssql");
        expect(payload.message).toContain("prod-mssql");
        expect(payload.message).toContain("15.0.4280.7");
        expect(payload.message).toContain("15.0.4360.2");
        expect(payload.success).toBe(true);
        expect(payload.color).toBe("#3b82f6");
        expect(payload.badge).toBe("Upgrade");

        const fieldNames = payload.fields?.map((f) => f.name) ?? [];
        expect(fieldNames).toEqual(
          expect.arrayContaining([
            "Source",
            "Adapter",
            "Previous Version",
            "New Version",
            "Edition",
            "Time",
          ])
        );
      });

      it("falls back to 'unknown' for previousVersion=null and omits edition when missing", () => {
        const payload = renderTemplate({
          eventType: NOTIFICATION_EVENTS.DB_VERSION_CHANGED,
          data: {
            sourceName: "prod-mysql",
            sourceId: "src-2",
            adapterId: "mysql",
            previousVersion: null,
            newVersion: "8.0.31",
            timestamp: "2026-05-31T10:00:00Z",
            isDowngrade: false,
          },
        });

        expect(payload.message).toContain("unknown");
        expect(payload.message).toContain("8.0.31");
        const fieldNames = payload.fields?.map((f) => f.name) ?? [];
        expect(fieldNames).not.toContain("Edition");
        expect(payload.fields).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: "Previous Version", value: "unknown" }),
          ])
        );
      });
    });
  });
});

// ── Barrel export (index.ts) ──────────────────────────────────

describe("notifications/index barrel exports", () => {
  it("re-exports NOTIFICATION_EVENTS", () => {
    expect(BARREL_EVENTS.BACKUP_SUCCESS).toBe("backup_success");
  });

  it("re-exports renderTemplate and it works", () => {
    const payload = barrelRenderTemplate({
      eventType: BARREL_EVENTS.SYSTEM_ERROR,
      data: { component: "test", error: "fail", timestamp: "2026-01-01T00:00:00Z" },
    });
    expect(payload.title).toBe("System Error");
  });

  it("re-exports getEventDefinition", () => {
    const def = getEventDefinition(BARREL_EVENTS.USER_LOGIN);
    expect(def?.id).toBe("user_login");
  });

  it("re-exports getEventsByCategory", () => {
    const grouped = getEventsByCategory();
    expect(Object.keys(grouped).length).toBeGreaterThan(0);
  });
});
