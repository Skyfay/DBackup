import { describe, it, expect } from "vitest";
import { renderTemplate } from "@/lib/notifications/templates";
import { NOTIFICATION_EVENTS } from "@/lib/notifications/types";

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

        expect(payload.title).toBe("Backup Successful");
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

        expect(payload.title).toBe("Backup Failed");
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
  });
});
