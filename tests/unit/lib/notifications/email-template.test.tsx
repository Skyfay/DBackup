import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";
import { renderNotificationEmail } from "@/components/email/render-email";
import { ADAPTER_LOGOS, BANNER_ICONS, MUTED_ICONS, STATE_ICONS, bannerIcon } from "@/components/email/email-icons";
import { ADAPTER_DEFINITIONS } from "@/lib/adapters/definitions";
import { renderTemplate } from "@/lib/notifications/templates";
import { NOTIFICATION_EVENTS, type NotificationEventData, type NotificationPayload } from "@/lib/notifications/types";
import { buildTestData } from "@/services/notifications/notification-test-data";

const BRAND = { instanceName: "Production", baseUrl: "https://backup.example.com", timeZone: "UTC" };

const FAILED: NotificationPayload = {
  title: "postgres-nightly failed",
  message: "The run stopped while dumping databases, so no destination got a backup.",
  success: false,
  tone: "failure",
  icon: "circle-x",
  stats: [{ label: "Started", value: "02:00" }, { label: "Duration", value: "4 s" }],
  problem: { title: "Postgres Prod refused the login", help: "Check the user and password.", raw: "password authentication failed", where: "Dumping databases · 02:00:04" },
  fields: [{ name: "Job", value: "postgres-nightly" }, { name: "Duration", value: "4 s" }],
  actions: [
    { label: "Open run", href: "/dashboard/history/run?id=e1&from=history", icon: "history" },
    { label: "Release notes", href: "https://github.com/Skyfay/DBackup/releases", icon: "external-link" },
  ],
  preheader: "Postgres Prod refused the login.",
  reason: "You get this through Ops mail.",
  timestamp: "2026-10-04T00:00:04.000Z",
};

describe("the notification mail", () => {
  it("tells the status in a banner and the facts in a card", async () => {
    const { html, subject } = await renderNotificationEmail(FAILED, BRAND);

    expect(subject).toBe("postgres-nightly failed");
    expect(html).toContain("m-banner-failure");
    expect(html).toContain("banner-circle-x-failure-light.png");
    expect(html).toContain("The run stopped while dumping databases");
    expect(html).toContain("Postgres Prod refused the login.");
    expect(html).toContain("password authentication failed");
    expect(html).toContain("DBackup</span>");
    expect(html).toContain("· Production");
  });

  it("lists the fields the tiles leave out when the payload names no details", async () => {
    const { text } = await renderNotificationEmail(FAILED, BRAND);

    expect(text).toContain("Job: postgres-nightly");
    // Duration stands in a tile already.
    expect(text.match(/Duration: 4 s/g)).toHaveLength(1);
  });

  it("links its buttons to the address of the instance and keeps an outside link", async () => {
    const { html } = await renderNotificationEmail(FAILED, BRAND);

    expect(html).toContain('href="https://backup.example.com/dashboard/history/run?id=e1&amp;from=history"');
    expect(html).toContain('href="https://github.com/Skyfay/DBackup/releases"');
    expect(html).toContain("muted-history-light.png");
  });

  it("leaves out the buttons into the app while the instance has no address", async () => {
    const { html, text } = await renderNotificationEmail(FAILED, { ...BRAND, baseUrl: null });

    expect(html).not.toContain("/dashboard/history/run");
    expect(html).toContain("Release notes");
    expect(text).not.toContain("Open run");
  });

  it("paints itself dark for a client that follows the system", async () => {
    const { html } = await renderNotificationEmail(FAILED, BRAND);

    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    expect(html).toContain("@media (prefers-color-scheme: dark)");
    expect(html).toContain("banner-circle-x-failure-dark.png");
  });

  it("starts with a hidden preheader and ends with why the reader gets it", async () => {
    const { html, text } = await renderNotificationEmail(FAILED, BRAND);

    expect(html.indexOf("Postgres Prod refused the login.")).toBeLessThan(html.indexOf(`class="m-banner-failure"`));
    expect(html).toContain("You get this through Ops mail.");
    expect(text.trim().endsWith("DBackup · Production · https://backup.example.com")).toBe(true);
  });

  it("shows the error of a destination under its row instead of a second problem block", async () => {
    const { html } = await renderNotificationEmail({
      ...FAILED,
      tone: "warning",
      destinations: [
        { name: "S3 Archive", adapterId: "s3-aws", state: "ok", detail: "Uploaded" },
        { name: "Dropbox", adapterId: "dropbox", state: "failed", detail: "Upload failed", error: "Error 401: expired_access_token" },
      ],
    }, BRAND);

    expect(html).not.toContain("What went wrong");
    expect(html).toContain("adapter-dropbox-light.png");
    expect(html).toContain("state-failed-light.png");
    expect(html).toContain("Error 401: expired_access_token");
  });

  it("takes its color from success when the payload names no tone", async () => {
    const { html } = await renderNotificationEmail({ title: "Done", message: "It worked.", success: true }, BRAND);

    expect(html).toContain("m-banner-success");
  });

  it("escapes what the payload says", async () => {
    const { html } = await renderNotificationEmail({ title: "<b>job</b>", message: "a & b", success: true }, BRAND);

    expect(html).toContain("<title>&lt;b&gt;job&lt;/b&gt;</title>");
    expect(html).not.toContain("<b>job</b>");
  });
});

describe("the pictures of the mails", () => {
  const assets = path.join(process.cwd(), "docs/public/email");
  const exists = (file: string) => fs.existsSync(path.join(assets, file));

  it("has a light and a dark PNG for every icon in the lists", () => {
    const missing: string[] = [];
    for (const theme of ["light", "dark"]) {
      for (const [tone, icons] of Object.entries(BANNER_ICONS)) {
        for (const icon of icons) if (!exists(`banner-${icon}-${tone}-${theme}.png`)) missing.push(`banner-${icon}-${tone}-${theme}`);
      }
      for (const icon of MUTED_ICONS) if (!exists(`muted-${icon}-${theme}.png`)) missing.push(`muted-${icon}-${theme}`);
      for (const state of Object.keys(STATE_ICONS)) if (!exists(`state-${state}-${theme}.png`)) missing.push(`state-${state}-${theme}`);
      for (const adapterId of Object.keys(ADAPTER_LOGOS)) if (!exists(`adapter-${adapterId}-${theme}.png`)) missing.push(`adapter-${adapterId}-${theme}`);
    }
    // Run `pnpm email:icons` after adding one to src/components/email/email-icons.ts.
    expect(missing).toEqual([]);
  });

  it("has a logo for every destination adapter", () => {
    const storage = ADAPTER_DEFINITIONS.filter((definition) => definition.type === "storage").map((definition) => definition.id);
    expect(storage.filter((id) => !ADAPTER_LOGOS[id])).toEqual([]);
  });

  it("has a picture for the icon and tone every template asks for", () => {
    const events = Object.values(NOTIFICATION_EVENTS).flatMap((type) => {
      const data = buildTestData(type);
      return data ? [data] : [];
    });
    const backup = (eventType: string) => ({ eventType, data: { jobName: "job", timestamp: "2026-10-04T00:00:00.000Z" } }) as NotificationEventData;
    events.push(backup(NOTIFICATION_EVENTS.BACKUP_SUCCESS), backup(NOTIFICATION_EVENTS.BACKUP_PARTIAL), backup(NOTIFICATION_EVENTS.BACKUP_FAILURE));
    for (const event of events) {
      const payload = renderTemplate(event);
      const tone = payload.tone ?? (payload.success ? "success" : "failure");
      expect(bannerIcon(payload.icon, tone), event.eventType).toBe(payload.icon);
    }
  });
});
