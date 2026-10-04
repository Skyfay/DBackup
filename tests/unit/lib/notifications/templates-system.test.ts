import { describe, it, expect } from "vitest";
import { renderTemplate } from "@/lib/notifications/templates";
import { NOTIFICATION_EVENTS } from "@/lib/notifications/types";

const NOW = "2026-10-04T06:00:00.000Z";
const GB = 1024 ** 3;

const stat = (payload: { stats?: Array<{ label: string; value: string }> }, label: string) =>
  payload.stats?.find((entry) => entry.label === label)?.value;
const field = (payload: { fields?: Array<{ name: string; value: string }> }, name: string) =>
  payload.fields?.find((entry) => entry.name === name)?.value;

describe("the alerts of a destination", () => {
  it("says how much a destination grew and links to it", () => {
    const payload = renderTemplate({
      eventType: NOTIFICATION_EVENTS.STORAGE_USAGE_SPIKE,
      data: { storageName: "S3 Archive", storageId: "s1", previousSize: 10 * GB, currentSize: 15 * GB, changePercent: 50, timestamp: NOW },
    });

    expect(payload.title).toBe("S3 Archive grew by 50.0%");
    expect(stat(payload, "Change")).toBe("+50.0%");
    expect(payload.actions).toEqual([{ label: "Open destination", href: "/dashboard/backups?tab=destinations&destination=s1", icon: "archive" }]);
  });

  it("says a destination shrank", () => {
    const payload = renderTemplate({
      eventType: NOTIFICATION_EVENTS.STORAGE_USAGE_SPIKE,
      data: { storageName: "S3 Archive", previousSize: 20 * GB, currentSize: 10 * GB, changePercent: -50, timestamp: NOW },
    });

    expect(payload.title).toBe("S3 Archive shrank by 50.0%");
    expect(payload.actions).toEqual([]);
  });

  it("draws how full a destination is against its limit", () => {
    const payload = renderTemplate({
      eventType: NOTIFICATION_EVENTS.STORAGE_LIMIT_WARNING,
      data: { storageName: "S3 Archive", storageId: "s1", currentSize: 460 * GB, limitSize: 500 * GB, usagePercent: 92, timestamp: NOW },
    });

    expect(payload.title).toBe("S3 Archive is nearly full");
    expect(payload.message).toBe("It holds 460 GB of the 500 GB its alert allows.");
    expect(payload.usage).toEqual({ percent: 92, label: "92% of the limit", aside: "Alert from 90%" });
    expect(stat(payload, "Left")).toBe("40 GB");
    expect(payload.tone).toBe("warning");
  });

  it("says a destination is over its limit once it is", () => {
    const payload = renderTemplate({
      eventType: NOTIFICATION_EVENTS.STORAGE_LIMIT_WARNING,
      data: { storageName: "S3 Archive", currentSize: 510 * GB, limitSize: 500 * GB, usagePercent: 102, timestamp: NOW },
    });

    expect(payload.title).toBe("S3 Archive is over its limit");
    expect(payload.usage?.percent).toBe(100);
    expect(stat(payload, "Left")).toBe("0 Bytes");
  });

  it("says how long a destination went without a backup", () => {
    const payload = renderTemplate({
      eventType: NOTIFICATION_EVENTS.STORAGE_MISSING_BACKUP,
      data: { storageName: "NAS", lastBackupAt: "2026-10-01T06:00:00.000Z", thresholdHours: 48, hoursSinceLastBackup: 72, timestamp: NOW },
    });

    expect(payload.title).toBe("NAS got no new backup");
    expect(payload.message).toBe("Nothing new arrived there in 72 hours, its alert allows 48.");
    expect(payload.details).toContainEqual({ name: "Last backup", value: "1 Oct 2026, 06:00" });
  });

  it("leaves the last backup out when there was none", () => {
    const payload = renderTemplate({
      eventType: NOTIFICATION_EVENTS.STORAGE_MISSING_BACKUP,
      data: { storageName: "NAS", thresholdHours: 48, hoursSinceLastBackup: 72, timestamp: NOW },
    });

    expect(field(payload, "Last Backup")).toBeUndefined();
  });
});

describe("an air-gapped destination left out of a run", () => {
  it("says which job ran without it and how long it has been away, in gray as nothing is wrong", () => {
    const payload = renderTemplate({
      eventType: NOTIFICATION_EVENTS.AIRGAP_SKIPPED,
      data: { storageName: "USB rotation", storageId: "u1", jobName: "Shop MySQL", jobId: "j1", lastConnectedAt: "2026-10-01T06:00:00.000Z", timestamp: NOW },
    });

    expect(payload.title).toBe("USB rotation was skipped");
    expect(payload.message).toBe("Shop MySQL ran without 'USB rotation', since it is air-gapped and not connected. It was last connected 3 days ago.");
    expect(payload.tone).toBe("neutral");
    expect(payload.success).toBe(true);
    expect(payload.actions?.map((action) => action.href)).toEqual(["/dashboard/connections?tab=destinations&open=u1", "/dashboard/jobs?job=j1"]);
  });

  it("counts hours for the first two days and leaves the time out when it never answered a check", () => {
    const recent = renderTemplate({
      eventType: NOTIFICATION_EVENTS.AIRGAP_SKIPPED,
      data: { storageName: "USB", jobName: "Job", lastConnectedAt: "2026-10-03T06:00:00.000Z", timestamp: NOW },
    });
    const never = renderTemplate({ eventType: NOTIFICATION_EVENTS.AIRGAP_SKIPPED, data: { storageName: "USB", jobName: "Job", timestamp: NOW } });

    expect(recent.message).toContain("It was last connected 24 hours ago.");
    expect(never.message).not.toContain("last connected");
  });
});

describe("the health of the connections", () => {
  it("tells an offline source in plain words and links to it", () => {
    const payload = renderTemplate({
      eventType: NOTIFICATION_EVENTS.CONNECTION_OFFLINE,
      data: { adapterName: "MySQL Prod", adapterType: "database", adapterId: "mysql", configId: "c1", consecutiveFailures: 3, lastError: "connect ECONNREFUSED 10.0.0.5:3306", timestamp: NOW },
    });

    expect(payload.title).toBe("MySQL Prod is offline");
    expect(payload.problem?.title).toBe("Could not reach MySQL Prod");
    expect(payload.problem?.where).toBe("Health check · 06:00:00");
    expect(stat(payload, "Kind")).toBe("Source");
    expect(payload.actions).toEqual([{ label: "Open source", href: "/dashboard/connections?tab=databases&open=c1", icon: "database" }]);
  });

  it("calls a storage connection a destination", () => {
    const payload = renderTemplate({
      eventType: NOTIFICATION_EVENTS.CONNECTION_OFFLINE,
      data: { adapterName: "NAS", adapterType: "storage", adapterId: "smb", consecutiveFailures: 5, timestamp: NOW },
    });

    expect(field(payload, "Destination")).toBe("NAS");
    expect(payload.problem).toBeUndefined();
  });

  it("says when a connection is back and how long it was away", () => {
    const payload = renderTemplate({
      eventType: NOTIFICATION_EVENTS.CONNECTION_ONLINE,
      data: { adapterName: "NAS", adapterType: "storage", adapterId: "smb", downtime: "2h 15m", timestamp: NOW },
    });

    expect(payload.title).toBe("NAS is back");
    expect(payload.message).toBe("It answers its health checks again. It was offline for 2h 15m.");
    expect(payload.tone).toBe("success");
  });

  it("tells an upgrade calmly and a downgrade as a warning", () => {
    const base = { sourceName: "Postgres", sourceId: "s1", adapterId: "postgres", newVersion: "16.4", timestamp: NOW };
    const up = renderTemplate({ eventType: NOTIFICATION_EVENTS.DB_VERSION_CHANGED, data: { ...base, previousVersion: "16.3", edition: "Community", isDowngrade: false } });
    const down = renderTemplate({ eventType: NOTIFICATION_EVENTS.DB_VERSION_CHANGED, data: { ...base, previousVersion: null, isDowngrade: true } });

    expect(up.title).toBe("Postgres was upgraded");
    expect(up.tone).toBe("neutral");
    expect(stat(up, "Edition")).toBe("Community");
    expect(down.title).toBe("Postgres was downgraded");
    expect(down.tone).toBe("warning");
    expect(down.message).toContain("from unknown to 16.4");
  });
});

describe("the system", () => {
  it("names the task that failed and tells its error in plain words", () => {
    const payload = renderTemplate({
      eventType: NOTIFICATION_EVENTS.SYSTEM_ERROR,
      data: { component: "Configuration backup", error: "ENOSPC: no space left on device", details: "while writing", timestamp: NOW },
    });

    expect(payload.title).toBe("Configuration backup failed");
    expect(payload.problem?.title).toBe("The destination is full");
    expect(payload.problem?.raw).toBe("ENOSPC: no space left on device\nwhile writing");
    expect(payload.actions?.[0].href).toBe("/dashboard/settings?part=tasks");
  });

  it("reports a configuration backup with its size", () => {
    const payload = renderTemplate({
      eventType: NOTIFICATION_EVENTS.CONFIG_BACKUP,
      data: { fileName: "config_backup.db.gz.enc", size: 4096, encrypted: true, timestamp: NOW },
    });

    expect(payload.title).toBe("The configuration was backed up");
    expect(stat(payload, "Encrypted")).toBe("Yes");
    expect(payload.details).toEqual([{ name: "File", value: "config_backup.db.gz.enc" }]);
  });

  it("names a new version and links its release notes", () => {
    const payload = renderTemplate({
      eventType: NOTIFICATION_EVENTS.UPDATE_AVAILABLE,
      data: { latestVersion: "3.5.0", currentVersion: "3.4.0", releaseUrl: "https://github.com/Skyfay/DBackup/releases", timestamp: NOW },
    });

    expect(payload.title).toBe("DBackup 3.5.0 is out");
    expect(payload.actions).toEqual([{ label: "Release notes", href: "https://github.com/Skyfay/DBackup/releases", icon: "external-link" }]);
  });

  it("leaves the release notes out when there is no link", () => {
    const payload = renderTemplate({ eventType: NOTIFICATION_EVENTS.UPDATE_AVAILABLE, data: { latestVersion: "3.5.0", currentVersion: "3.4.0", timestamp: NOW } });

    expect(payload.actions).toEqual([]);
    expect(field(payload, "Release Notes")).toBeUndefined();
  });

  it("lists the files that failed the integrity check with their destination", () => {
    const payload = renderTemplate({
      eventType: NOTIFICATION_EVENTS.INTEGRITY_CHECK_FAILURE,
      data: {
        totalFiles: 12, failed: 2, passed: 9, skipped: 1, triggerType: "Scheduler",
        errors: [
          { file: "a.sql.gz", destination: "S3", expected: "x", actual: "y" },
          { file: "b.sql.gz", destination: "NAS", expected: "x", actual: "y" },
        ],
      },
    });

    expect(payload.title).toBe("2 backups failed the integrity check");
    expect(payload.problem?.raw).toBe("S3: a.sql.gz\nNAS: b.sql.gz");
    expect(stat(payload, "Skipped")).toBe("1");
  });
});
