import { describe, expect, it } from "vitest";
import { searchSettings, settingsIndex } from "@/components/dashboard/settings/settings-index";
import { partFromAddress } from "@/components/dashboard/settings/settings-parts";
import { partStates } from "@/components/dashboard/settings/settings-states";
import { changesOf, minutesText, offsetLabel, secondsText, withSaved, zoneExample } from "@/components/dashboard/settings/settings-values";
import { triggerSample } from "@/components/dashboard/settings/privacy-part";
import type { SettingsModel, SystemTaskRow } from "@/services/system/settings-types";

const TASKS = [
    { id: "system.health_check", name: "Health checks", description: "Pings every source and destination for its state and response time." },
    { id: "system.config_backup", name: "Configuration backup", description: "Backs up connections, jobs, users and settings to the destination of Configuration backup." },
];

function task(overrides: Partial<SystemTaskRow> = {}): SystemTaskRow {
    return {
        id: "system.health_check",
        name: "Health checks",
        description: "",
        schedule: "* * * * *",
        enabled: true,
        runOnStartup: false,
        running: false,
        lastRun: { at: "2026-09-29T10:00:00.000Z", durationMs: 2000, ok: true, summary: null },
        nextRunAt: null,
        follows: null,
        ...overrides,
    };
}

function notificationEvent(overrides: Partial<SettingsModel["notifications"]["events"][number]>): SettingsModel["notifications"]["events"][number] {
    return {
        id: "restore_complete", name: "A restore finished", description: "", category: "restore", enabled: true, channels: null,
        notifyUser: null, supportsReminder: false, reminderHours: null, defaultReminderHours: null, ...overrides,
    };
}

function model(overrides: Partial<SettingsModel> = {}): SettingsModel {
    return {
        canManage: true,
        isSuperAdmin: true,
        general: { instanceName: "", timezone: "UTC", maxConcurrentJobs: 1, stuckTimeoutMinutes: 360, checkForUpdates: true, showQuickSetup: false },
        signIn: { sessionDuration: 604800, passkeyLogin: true, emailLoginDisabledByEnv: false, providers: [], passkeyIsLastWayIn: false },
        privacy: { includeActorInMetadata: true },
        retention: { values: {} as SettingsModel["retention"]["values"], counts: {} as SettingsModel["retention"]["counts"] },
        database: null,
        configBackup: {
            settings: { enabled: true, storageId: "nas", profileId: "", schedule: "0 3 * * *", includeStatistics: false, retention: 10 },
            destinations: [],
            keys: [],
            lastRun: null,
            running: false,
        },
        rateLimits: { auth: { points: 5, duration: 60 }, api: { points: 100, duration: 60 }, mutation: { points: 20, duration: 60 } },
        certificate: {
            exists: true, issuer: "CN=DBackup", subject: "CN=DBackup", validFrom: "", validTo: "", expiresAt: "", expired: false,
            serialNumber: "", fingerprint: "", names: [], isSelfSigned: true, daysRemaining: 200, isHttpsEnabled: true,
        },
        tasks: [task()],
        integrity: { scanMode: "jobs", skipPassed: false, maxAgeDays: 0, maxFileSizeMb: 0 },
        notifications: {
            channels: [{ id: "mail", name: "Admins", adapterId: "email" } as SettingsModel["notifications"]["channels"][number]],
            defaultChannels: ["mail"],
            events: [
                notificationEvent({ id: "restore_complete" }),
                notificationEvent({ id: "restore_failure", channels: ["mail"] }),
                notificationEvent({ id: "user_login", enabled: false }),
            ],
        },
        ...overrides,
    };
}

describe("the address of the Settings page", () => {
    it("opens the part it names, and the parts of the old tabs from links and bookmarks", () => {
        expect(partFromAddress("rate-limits", null)).toBe("rate-limits");
        expect(partFromAddress(null, "config")).toBe("config-backup");
        expect(partFromAddress(null, "certificate")).toBe("https");
        expect(partFromAddress("nothing", "nothing")).toBeNull();
    });
});

describe("the search of the Settings page", () => {
    const index = settingsIndex(TASKS);

    it("finds settings by their name and line regardless of case, with the hits per part", () => {
        const search = searchSettings(index, "BACKUP");

        expect(search.hits.map((hit) => hit.id)).toContain("config-backup");
        expect(search.hits.map((hit) => hit.id)).toContain("task:system.config_backup");
        expect(search.hits.map((hit) => hit.id)).toContain("privacy.actor");
        expect(search.counts.tasks).toBe(1);
    });

    it("lists the hits in the order of the parts on the page", () => {
        const parts = searchSettings(index, "backup").hits.map((hit) => hit.part);

        expect(parts.indexOf("tasks")).toBeLessThan(parts.indexOf("config-backup"));
        expect(parts.indexOf("config-backup")).toBeLessThan(parts.indexOf("privacy"));
    });

    it("finds a word by its start only, so backup leaves out what only names DBackup", () => {
        const ids = searchSettings(index, "backup").hits.map((hit) => hit.id);

        expect(ids).not.toContain("general");
        expect(ids).not.toContain("tasks");
        expect(searchSettings(index, "meta json").hits.map((hit) => hit.id)).toEqual(["privacy.actor"]);
    });

    it("finds nothing for an empty search", () => {
        expect(searchSettings(index, "  ")).toEqual({ hits: [], counts: {} });
    });
});

describe("the state of each part in the navigation", () => {
    it("warns about a configuration backup that is off or failed", () => {
        const off = model();
        off.configBackup.settings.enabled = false;
        expect(partStates(off)["config-backup"]).toEqual({ text: "Off", tone: "warning" });

        const failed = model();
        failed.configBackup.lastRun = { at: "2026-09-29T03:00:00.000Z", durationMs: 100, ok: false, summary: "No destination" };
        expect(partStates(failed)["config-backup"]).toEqual({ text: "Failed", tone: "warning" });

        expect(partStates(model())["config-backup"]).toBeUndefined();
    });

    it("counts down a certificate that runs out within 30 days and calls a past one expired", () => {
        const soon = model();
        soon.certificate = { ...soon.certificate!, daysRemaining: 12 };
        expect(partStates(soon).https).toEqual({ text: "12 days", tone: "warning" });

        const expired = model();
        expired.certificate = { ...expired.certificate!, daysRemaining: -3, expired: true };
        expect(partStates(expired).https).toEqual({ text: "Expired", tone: "destructive" });

        expect(partStates(model({ certificate: null })).https).toEqual({ text: "Unreadable", tone: "warning" });
    });

    it("counts the tasks, or the ones whose last run needs a look", () => {
        expect(partStates(model()).tasks).toEqual({ text: "1" });

        const problem = model({ tasks: [task(), task({ id: "system.integrity_check", lastRun: { at: "2026-09-28T04:00:00.000Z", durationMs: 9000, ok: false, summary: "2 of 148 failed" } })] });
        expect(partStates(problem).tasks).toEqual({ text: "1 problem", tone: "warning" });
    });

    it("warns about events that are on but have no channel to go to", () => {
        const empty = model();
        empty.notifications.defaultChannels = [];
        expect(partStates(empty).notifications).toEqual({ text: "1 goes nowhere", tone: "warning" });
    });

    it("names how many notification events are on", () => {
        expect(partStates(model()).notifications).toEqual({ text: "2 of 3" });
    });
});

describe("the words of the Settings page", () => {
    it("says times the way the selects show them", () => {
        expect(minutesText(0)).toBe("Never");
        expect(minutesText(360)).toBe("6 hours");
        expect(minutesText(45)).toBe("45 minutes");
        expect(secondsText(604800)).toBe("7 days");
        expect(secondsText(28800)).toBe("8 hours");
    });

    it("keeps a saved value among the choices when it is none of them", () => {
        expect(withSaved([30, 60], 45)).toEqual([30, 45, 60]);
        expect(withSaved([30, 60], 60)).toEqual([30, 60]);
    });

    it("tells the offset of a time zone from UTC and what 03:00 is there", () => {
        const winter = new Date("2026-01-15T12:00:00Z");
        expect(offsetLabel("Asia/Kolkata", winter)).toBe("UTC+5:30");
        expect(offsetLabel("Europe/Zurich", winter)).toBe("UTC+1");
        expect(zoneExample("Europe/Zurich", winter)).toBe("03:00 here is 02:00 UTC.");
        expect(zoneExample("UTC", winter)).toBe("Its clock is the one of UTC.");
    });

    it("names the changes of a part for the save bar in its words", () => {
        const changes = changesOf(
            { maxConcurrentJobs: 1, checkForUpdates: true, timezone: "UTC" },
            { maxConcurrentJobs: 2, checkForUpdates: false, timezone: "UTC" },
            { maxConcurrentJobs: { label: "Runs at the same time" }, checkForUpdates: { label: "Look for new versions" }, timezone: { label: "Time zone" } }
        );

        expect(changes).toEqual([
            { label: "Runs at the same time", from: "1", to: "2" },
            { label: "Look for new versions", from: "on", to: "off" },
        ]);
    });

    it("shows the metadata of a backup with the name of who started it only while the switch is on", () => {
        expect(triggerSample(true, "Ada")).toContain('"actor": "Ada"');
        expect(triggerSample(false, "Ada")).not.toContain("actor");
    });
});
