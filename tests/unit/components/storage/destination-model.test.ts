import { describe, expect, it } from "vitest";
import { jobsAt, limitShare, statesOfDestination, statesOfJob, summarizeDestinations, typeOfJob } from "@/components/dashboard/storage/explorer/destination-model";
import { destination, hoursAgo, index, job, newest, runs } from "./explorer-fixtures";

const alertsOff = destination("x", "X").alerts;

describe("jobs at a destination", () => {
    it("counts the backups of every job stored there, how big they are, the newest and where else they lie", () => {
        const entries = jobsAt("nas", runs, index.jobs);

        expect(entries.map((entry) => entry.job.key)).toEqual(["job-shop", "job-media", "deleted:job-erp"]);
        expect(entries[0]).toMatchObject({ backups: 2, size: 200, newest: newest.createdAt, alsoAt: ["r2"], missing: 0 });
        expect(entries[1]).toMatchObject({ backups: 4, size: 8_300, alsoAt: [] });
        expect(entries[2]).toMatchObject({ backups: 2, alsoAt: [] });
    });

    it("counts a copy missing at a destination apart from the backups there", () => {
        const [shop, ...rest] = jobsAt("r2", runs, index.jobs);

        expect(rest).toEqual([]);
        expect(shop).toMatchObject({ backups: 1, missing: 1, alsoAt: ["nas"] });
        expect(statesOfJob(shop)).toEqual(["missing"]);
    });

    it("marks a deleted job, so its backups can be found and deleted", () => {
        const erp = jobsAt("nas", runs, index.jobs).find((entry) => entry.job.kind === "deleted");

        expect(erp && statesOfJob(erp)).toEqual(["deleted"]);
    });

    it("sorts a job into its type by what it backs up", () => {
        expect(typeOfJob(job({}))).toBe("postgres");
        expect(typeOfJob(job({ sourceType: null, hasFolders: true }))).toBe("folders");
        expect(typeOfJob(job({ kind: "system" }))).toBe("system");
        expect(typeOfJob(job({ kind: "none", sourceType: null }))).toBe("none");
    });
});

describe("states of a destination", () => {
    it("tells whether it answers, whether its list is old and whether an alert fires", () => {
        expect(statesOfDestination(destination("nas", "NAS"))).toEqual(["online"]);
        expect(statesOfDestination(destination("r2", "R2", {
            health: { status: "OFFLINE", checkedAt: hoursAgo(0), error: "timeout", latencyMs: null, answeredAt: hoursAgo(5) },
            listError: "timeout",
            alerts: { ...alertsOff, missingBackup: { enabled: true, hours: 24, active: true } },
        }))).toEqual(["offline", "behind", "alert"]);
        expect(statesOfDestination(destination("new", "New", { listedAt: null }))).toEqual(["online", "behind"]);
    });

    it("fills a share of its storage limit only while the limit alert is on", () => {
        expect(limitShare(destination("nas", "NAS", { size: 300 }))).toBeNull();
        expect(limitShare(destination("nas", "NAS", { size: 300, alerts: { ...alertsOff, storageLimit: { enabled: true, bytes: 1_200, active: false } } }))).toBe(0.25);
    });
});

describe("numbers above the destinations", () => {
    it("adds up what every destination stores and names the alerts that fire", () => {
        const summary = summarizeDestinations([
            destination("nas", "NAS", { size: 300, count: 3, growth: 50 }),
            destination("r2", "R2", {
                size: 700,
                count: 4,
                health: { status: "OFFLINE", checkedAt: hoursAgo(0), error: null, latencyMs: null, answeredAt: null },
                alerts: { ...alertsOff, storageLimit: { enabled: true, bytes: 600, active: true } },
            }),
        ]);

        expect(summary).toEqual({ destinations: 2, answering: 1, size: 1_000, growth: 50, backups: 7, alerts: ["Storage limit at R2"] });
    });

    it("has no growth when no destination was measured a week ago", () => {
        expect(summarizeDestinations([destination("nas", "NAS")]).growth).toBeNull();
    });
});
