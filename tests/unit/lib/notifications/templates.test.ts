import { describe, it, expect } from "vitest";
import { renderTemplate } from "@/lib/notifications/templates";
import { NOTIFICATION_EVENTS, type BackupResultData, type NotificationEventData } from "@/lib/notifications/types";
import {
  NOTIFICATION_EVENTS as BARREL_EVENTS,
  renderTemplate as barrelRenderTemplate,
  getEventDefinition,
  getEventsByCategory,
} from "@/lib/notifications";

const field = (payload: { fields?: Array<{ name: string; value: string }> }, name: string) =>
  payload.fields?.find((entry) => entry.name === name)?.value;
const stat = (payload: { stats?: Array<{ label: string; value: string }> }, label: string) =>
  payload.stats?.find((entry) => entry.label === label)?.value;

const RUN: BackupResultData = {
  jobName: "mysql-shop",
  jobId: "job-1",
  sourceName: "MySQL Shop",
  sourceType: "MySQL 8.4",
  duration: 134_000,
  size: 1_524_713_390,
  executionId: "run-1",
  timestamp: "2026-10-04T01:17:21.000Z",
  startedAt: "2026-10-04T01:15:07.000Z",
  trigger: "Scheduler",
  databases: 3,
  encryptionKey: "Main key",
  destinations: [
    { name: "S3 Archive", adapterId: "s3-aws", state: "ok", detail: "Uploaded" },
    { name: "NAS Backup", adapterId: "smb", state: "ok", detail: "Uploaded" },
  ],
};

const backup = (eventType: string, data: Partial<BackupResultData> = {}) =>
  renderTemplate({ eventType, data: { ...RUN, ...data } } as NotificationEventData);

describe("the mails of a backup run", () => {
  it("names the job first and says where the databases went", () => {
    const payload = backup(NOTIFICATION_EVENTS.BACKUP_SUCCESS);

    expect(payload.title).toBe("mysql-shop finished");
    expect(payload.message).toBe("3 databases from MySQL Shop are now in 2 destinations.");
    expect(payload.preheader).toBe("1.42 GB went to S3 Archive and NAS Backup in 2 min 14 s.");
    expect(payload.tone).toBe("success");
    expect(payload.success).toBe(true);
  });

  it("shows when it started, how long it took, its size and who started it as tiles", () => {
    const payload = backup(NOTIFICATION_EVENTS.BACKUP_SUCCESS);

    expect(payload.stats).toEqual([
      { label: "Started", value: "01:15" },
      { label: "Duration", value: "2 min 14 s" },
      { label: "Size", value: "1.42 GB" },
      { label: "Trigger", value: "Schedule" },
    ]);
    expect(payload.details).toContainEqual({ name: "Source", value: "MySQL Shop · MySQL 8.4" });
    expect(payload.details).toContainEqual({ name: "Encrypted", value: "with Main key" });
  });

  it("links a finished run to its page", () => {
    const payload = backup(NOTIFICATION_EVENTS.BACKUP_SUCCESS);

    expect(payload.actions).toEqual([{ label: "Open run", href: "/dashboard/history/run?id=run-1&from=history", icon: "history" }]);
  });

  it("names the destinations that did not get a partial backup", () => {
    const payload = backup(NOTIFICATION_EVENTS.BACKUP_PARTIAL, {
      destinations: [
        ...RUN.destinations!,
        { name: "Dropbox", adapterId: "dropbox", state: "failed", detail: "Upload failed", error: "Error 401: expired_access_token" },
      ],
    });

    expect(payload.title).toBe("mysql-shop finished partially");
    expect(payload.message).toBe("2 of 3 destinations got the backup. Dropbox did not.");
    expect(stat(payload, "Destinations")).toBe("2 of 3");
    expect(field(payload, "Failed")).toBe("Dropbox");
    expect(payload.tone).toBe("warning");
    expect(payload.actions?.map((action) => action.label)).toEqual(["Open run", "Open job"]);
  });

  it("tells a failure in plain words with the message as it was written", () => {
    const payload = backup(NOTIFICATION_EVENTS.BACKUP_FAILURE, {
      destinations: [{ name: "S3 Archive", adapterId: "s3-aws", state: "skipped", detail: "Not reached" }],
      problem: { title: "MySQL Shop refused the login", raw: "Access denied for user 'backup'", where: "Dumping databases · 03:15:09" },
      failedInARow: 3,
      lastSuccessAt: "2026-10-02T01:16:00.000Z",
    });

    expect(payload.title).toBe("mysql-shop failed");
    expect(payload.message).toBe("The run stopped while dumping databases, so no destination got a backup.");
    expect(payload.preheader).toBe("MySQL Shop refused the login. Last clean run 2 days ago.");
    expect(stat(payload, "Failed in a row")).toBe("3");
    expect(field(payload, "Error")).toBe("Access denied for user 'backup'");
    expect(payload.details).toContainEqual({ name: "Last clean run", value: "2 Oct 2026, 01:16" });
    expect(payload.tone).toBe("failure");
  });

  it("keeps the raw error of a failure for a caller that has no plain words for it", () => {
    const payload = backup(NOTIFICATION_EVENTS.BACKUP_FAILURE, { error: "Something broke", destinations: undefined });

    expect(payload.problem).toEqual({ title: "The run stopped with an error", raw: "Something broke" });
    expect(payload.message).toBe("The run stopped with an error, so no destination got a backup.");
  });

  it("works with the job name alone", () => {
    const payload = renderTemplate({
      eventType: NOTIFICATION_EVENTS.BACKUP_SUCCESS,
      data: { jobName: "files", timestamp: "2026-10-04T01:17:21.000Z" },
    });

    expect(payload.title).toBe("files finished");
    expect(payload.message).toBe("files finished.");
    expect(payload.actions).toEqual([]);
  });
});

describe("times in the mails", () => {
  it("writes every time in the time zone of the instance", () => {
    const payload = renderTemplate(
      { eventType: NOTIFICATION_EVENTS.BACKUP_SUCCESS, data: { ...RUN } },
      { timeZone: "Europe/Zurich" },
    );

    expect(stat(payload, "Started")).toBe("03:15");
    expect(field(payload, "Time")).toBe("4 Oct 2026, 03:17");
  });

  it("falls back to UTC for a time zone the runtime does not know", () => {
    const payload = renderTemplate({ eventType: NOTIFICATION_EVENTS.BACKUP_SUCCESS, data: { ...RUN } }, { timeZone: "Mars/Olympus" });

    expect(field(payload, "Time")).toBe("4 Oct 2026, 01:17");
  });
});

describe("the mails about a restore", () => {
  it("names the database that came back", () => {
    const payload = renderTemplate({
      eventType: NOTIFICATION_EVENTS.RESTORE_COMPLETE,
      data: { sourceName: "MySQL Prod", targetDatabase: "app_db", databaseType: "mysql", size: 1024, duration: 8000, executionId: "r1", timestamp: "2026-10-04T01:00:00.000Z" },
    });

    expect(payload.title).toBe("app_db was restored");
    expect(stat(payload, "Type")).toBe("MYSQL");
    expect(payload.actions?.[0].href).toBe("/dashboard/history/run?id=r1&from=history");
  });

  it("tells a failed restore in plain words", () => {
    const payload = renderTemplate({
      eventType: NOTIFICATION_EVENTS.RESTORE_FAILURE,
      data: { sourceName: "MySQL Prod", targetDatabase: "app_db", error: "Access denied for user 'root'", timestamp: "2026-10-04T01:00:00.000Z" },
    });

    expect(payload.title).toBe("The restore of app_db failed");
    expect(payload.problem?.title).toBe("MySQL Prod refused the login");
    expect(payload.problem?.raw).toBe("Access denied for user 'root'");
    expect(payload.success).toBe(false);
  });

  it("works without any of its optional facts", () => {
    const payload = renderTemplate({ eventType: NOTIFICATION_EVENTS.RESTORE_FAILURE, data: { timestamp: "2026-10-04T01:00:00.000Z" } });

    expect(payload.title).toBe("A restore failed");
    expect(payload.problem).toBeUndefined();
    expect(payload.fields?.map((entry) => entry.name)).toEqual(["Time"]);
  });
});

describe("the mails about people", () => {
  const login = {
    eventType: NOTIFICATION_EVENTS.USER_LOGIN,
    data: {
      userName: "Anna Keller",
      email: "anna@example.com",
      ipAddress: "203.0.113.24",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:131.0) Gecko/20100101 Firefox/131.0",
      timestamp: "2026-10-04T07:14:00.000Z",
    },
  } as const;

  it("tells the channels who signed in, from which browser", () => {
    const payload = renderTemplate(login);

    expect(payload.title).toBe("Anna Keller signed in");
    expect(payload.message).toBe("Anna Keller (anna@example.com) signed in from Firefox on macOS.");
    expect(field(payload, "IP Address")).toBe("203.0.113.24");
    expect(payload.note).toBeUndefined();
  });

  it("tells the person themselves what to do when it was not them", () => {
    const payload = renderTemplate(login, { audience: "user" });

    expect(payload.title).toBe("New sign-in to your account");
    expect(payload.note).toContain("Not you?");
    expect(payload.actions).toEqual([{ label: "Open sessions", href: "/dashboard/profile?part=sessions", icon: "user-round" }]);
  });

  it("tells a new person their account is ready", () => {
    const data = { userName: "Ben", email: "ben@example.com", createdBy: "Anna Keller", timestamp: "2026-10-04T07:14:00.000Z" };

    expect(renderTemplate({ eventType: NOTIFICATION_EVENTS.USER_CREATED, data }).title).toBe("Ben has an account now");
    const toUser = renderTemplate({ eventType: NOTIFICATION_EVENTS.USER_CREATED, data }, { audience: "user" });
    expect(toUser.title).toBe("Your DBackup account is ready");
    expect(toUser.message).toBe("Anna Keller made an account for ben@example.com.");
  });
});

describe("an event no template knows", () => {
  it("still gives a payload", () => {
    const payload = renderTemplate({ eventType: "unknown_event", data: {} } as unknown as NotificationEventData);

    expect(payload.title).toBe("Notification");
    expect(payload.success).toBe(true);
  });
});

describe("notifications/index barrel exports", () => {
  it("re-exports NOTIFICATION_EVENTS", () => {
    expect(BARREL_EVENTS.BACKUP_SUCCESS).toBe("backup_success");
  });

  it("re-exports renderTemplate and it works", () => {
    const payload = barrelRenderTemplate({
      eventType: BARREL_EVENTS.SYSTEM_ERROR,
      data: { component: "Configuration backup", error: "fail", timestamp: "2026-01-01T00:00:00Z" },
    });
    expect(payload.title).toBe("Configuration backup failed");
  });

  it("re-exports getEventDefinition", () => {
    expect(getEventDefinition(BARREL_EVENTS.USER_LOGIN)?.id).toBe("user_login");
  });

  it("re-exports getEventsByCategory", () => {
    expect(Object.keys(getEventsByCategory()).length).toBeGreaterThan(0);
  });
});
