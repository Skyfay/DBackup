import { describe, expect, it } from "vitest";
import {
    EMPTY_SETUP, KEEP_COUNT, NOTIFY_ON, SCHEDULES, entryLabel, jobRequest, nextRun, scheduleChoiceOf, scheduleName, setupSteps,
    type JobChoices, type SetupState,
} from "@/components/dashboard/setup/setup-model";
import { jobDefaults } from "@/components/dashboard/setup/job-values";

const choices: JobChoices = {
    name: "  Shop backup  ",
    schedule: SCHEDULES.nightly,
    databases: ["shop", "billing"],
    compression: "GZIP",
    notifyOn: NOTIFY_ON.failures,
};

const state: SetupState = {
    ...EMPTY_SETUP,
    database: { id: "db-1", name: "Shop", adapterId: "mysql" },
    destination: { id: "dest-1", name: "NAS", adapterId: "local-filesystem" },
    encryption: { id: "key-1", name: "Backup key" },
    notification: { id: "ch-1", name: "Ops", adapterId: "teams" },
};

describe("quick setup steps", () => {
    it("leaves out encryption and notifications for a user who may not create them", () => {
        const ids = (steps: ReturnType<typeof setupSteps>) => steps.map((step) => step.id);
        expect(ids(setupSteps({ canCreateVault: true, canCreateNotification: true }))).toEqual(["database", "destination", "encryption", "notification", "job"]);
        expect(ids(setupSteps({ canCreateVault: false, canCreateNotification: false }))).toEqual(["database", "destination", "job"]);
    });

    it("names a connection by its name and its type", () => {
        expect(entryLabel({ id: "db-1", name: "Shop", adapterId: "mysql" })).toBe("Shop · MySQL");
        expect(entryLabel({ id: "key-1", name: "Backup key" })).toBe("Backup key");
    });
});

describe("quick setup schedule", () => {
    it("reads a schedule in the time zone of the scheduler", () => {
        const from = new Date("2026-09-23T12:00:00Z");
        expect(nextRun(SCHEDULES.nightly, "UTC", from)?.toISOString()).toBe("2026-09-24T03:00:00.000Z");
        // 03:00 in Zurich is 01:00 UTC while summer time lasts.
        expect(nextRun(SCHEDULES.nightly, "Europe/Zurich", from)?.toISOString()).toBe("2026-09-24T01:00:00.000Z");
    });

    it("refuses a cron expression it cannot read", () => {
        expect(nextRun("every night", "UTC")).toBeNull();
        expect(nextRun("0 3 * *", "UTC")).toBeNull();
    });

    it("tells the presets from a schedule of its own", () => {
        expect(scheduleChoiceOf("0 3 * * 0")).toBe("weekly");
        expect(scheduleChoiceOf("0 */6 * * *")).toBe("custom");
        expect(scheduleName(SCHEDULES.hourly)).toBe("every hour");
        expect(scheduleName("0 */6 * * *")).toBe("custom schedule");
    });
});

describe("quick setup job request", () => {
    it("ties the database, the destination, the key and the channel together", () => {
        expect(jobRequest(state, choices)).toEqual({
            name: "Shop backup",
            schedule: "0 3 * * *",
            sourceId: "db-1",
            databases: ["shop", "billing"],
            destinations: [{ configId: "dest-1", priority: 0, retention: { mode: "SIMPLE", simple: { keepCount: KEEP_COUNT } } }],
            encryptionProfileId: "key-1",
            compression: "GZIP",
            enabled: true,
            notificationIds: ["ch-1"],
            notificationEvents: "PARTIAL|FAILED",
        });
    });

    it("sends no key and no channel for steps that were skipped", () => {
        const request = jobRequest({ ...state, encryption: null, notification: null, skipped: ["encryption", "notification"] }, choices);
        expect(request.encryptionProfileId).toBeNull();
        expect(request.notificationIds).toEqual([]);
    });

    it("backs up a source that has no databases to pick as a whole", () => {
        const request = jobRequest({ ...state, database: { id: "db-2", name: "Cache", adapterId: "redis" } }, choices);
        expect(request.databases).toEqual([]);
    });

    it("leaves the compression of a PostgreSQL dump to PostgreSQL", () => {
        const request = jobRequest({ ...state, database: { id: "db-3", name: "CRM", adapterId: "postgres" } }, choices);
        expect(request.compression).toBe("NONE");
    });
});

describe("quick setup job draft", () => {
    const shop = { id: "db-1", name: "Shop", adapterId: "mysql" };
    const crm = { id: "db-2", name: "CRM", adapterId: "postgres" };

    it("starts with a name after the database, every night and all of its databases", () => {
        expect(jobDefaults(shop, null)).toMatchObject({ name: "Shop backup", when: "nightly", scope: "all", compression: "GZIP", notifyOn: "PARTIAL|FAILED" });
    });

    it("lets a name nobody changed follow another database and drops the databases picked on the old one", () => {
        const values = { ...jobDefaults(shop, null), scope: "some" as const, databases: ["orders"] };
        expect(jobDefaults(shop, { values, source: shop })).toEqual(values);
        expect(jobDefaults(crm, { values, source: shop })).toMatchObject({ name: "CRM backup", scope: "all", databases: [] });
        expect(jobDefaults(crm, { values: { ...values, name: "Nightly" }, source: shop })).toMatchObject({ name: "Nightly" });
    });
});
