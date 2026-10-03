import type { NotificationEventData } from "@/lib/notifications/types";

/**
 * Example data for Send a test of every system notification event, so a test renders like the
 * real one. Names and values are made up and say so.
 */

export function buildTestData(eventType: string): NotificationEventData | null {
  const now = new Date().toISOString();

  // Plain objects, which carry some fields the typed payloads leave out, like the errors of a check.
  const testPayloads: Record<string, unknown> = {
    user_login: {
      eventType: "user_login",
      data: {
        userName: "Test User",
        email: "test@example.com",
        ipAddress: "127.0.0.1",
        timestamp: now,
      },
    },
    user_created: {
      eventType: "user_created",
      data: {
        userName: "New User",
        email: "new@example.com",
        createdBy: "Admin",
        timestamp: now,
      },
    },
    restore_complete: {
      eventType: "restore_complete",
      data: {
        sourceName: "MySQL Production",
        targetDatabase: "app_db_restored",
        duration: 8000,
        timestamp: now,
      },
    },
    restore_failure: {
      eventType: "restore_failure",
      data: {
        sourceName: "MySQL Production",
        targetDatabase: "app_db",
        error: "Permission denied (test)",
        timestamp: now,
      },
    },
    config_backup: {
      eventType: "config_backup",
      data: {
        fileName: "config_backup_test.json.gz.enc",
        size: 4096,
        encrypted: true,
        timestamp: now,
      },
    },
    system_error: {
      eventType: "system_error",
      data: {
        component: "Configuration backup",
        error: "No destination is picked under Configuration backup (test)",
        timestamp: now,
      },
    },
    storage_usage_spike: {
      eventType: "storage_usage_spike",
      data: {
        storageName: "Local Storage (Test)",
        previousSize: 1073741824,
        currentSize: 1610612736,
        changePercent: 50,
        timestamp: now,
      },
    },
    storage_limit_warning: {
      eventType: "storage_limit_warning",
      data: {
        storageName: "Local Storage (Test)",
        currentSize: 9663676416,
        limitSize: 10737418240,
        usagePercent: 90,
        timestamp: now,
      },
    },
    storage_missing_backup: {
      eventType: "storage_missing_backup",
      data: {
        storageName: "Local Storage (Test)",
        lastBackupAt: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(),
        thresholdHours: 48,
        hoursSinceLastBackup: 72,
        timestamp: now,
      },
    },
    airgap_skipped: {
      eventType: "airgap_skipped",
      data: {
        storageName: "USB rotation (Test)",
        jobName: "Shop MySQL (Test)",
        lastConnectedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        timestamp: now,
      },
    },
    update_available: {
      eventType: "update_available",
      data: {
        latestVersion: "99.0.0",
        currentVersion: "1.0.0",
        releaseUrl: "https://github.com/Skyfay/DBackup/releases",
        timestamp: now,
      },
    },
    connection_offline: {
      eventType: "connection_offline",
      data: {
        adapterName: "MySQL Production (Test)",
        adapterType: "database",
        adapterId: "mysql",
        consecutiveFailures: 3,
        lastError: "Connection refused (test)",
        timestamp: now,
      },
    },
    connection_online: {
      eventType: "connection_online",
      data: {
        adapterName: "MySQL Production (Test)",
        adapterType: "database",
        adapterId: "mysql",
        downtime: "2h 15m",
        timestamp: now,
      },
    },
    db_version_changed: {
      eventType: "db_version_changed",
      data: {
        sourceName: "MySQL Production (Test)",
        sourceId: "test-source-id",
        adapterId: "mysql",
        previousVersion: "8.0.36",
        newVersion: "8.0.40",
        edition: null,
        timestamp: now,
      },
    },
    integrity_check_failure: {
      eventType: "integrity_check_failure",
      data: {
        totalFiles: 12,
        failed: 2,
        passed: 9,
        skipped: 1,
        triggerType: "Scheduler",
        errors: [
          {
            file: "daily-backup/app_db_2026-01-15.sql.gz.enc",
            destination: "Local Storage (Test)",
            expected: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
            actual: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
          },
          {
            file: "daily-backup/app_db_2026-01-14.sql.gz.enc",
            destination: "Local Storage (Test)",
            expected: "f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5",
            actual: "cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe",
          },
        ],
      },
    },
  };

  return (testPayloads[eventType] as NotificationEventData | undefined) ?? null;
}
