import { describe, it, expect } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { jobAuditName, jobAuditSnapshot, jobChangeDetails, type JobAuditSnapshot } from "@/services/jobs/job-audit";

/** A job as the snapshot reads it, a PostgreSQL job with two destinations unless a test says otherwise. */
const row = (overrides: Record<string, unknown> = {}) => ({
    name: "Shop nightly",
    schedule: "0 3 * * *",
    enabled: true,
    databases: "[]",
    compression: "GZIP",
    pgCompression: "",
    notificationEvents: "ALWAYS",
    skipVerification: false,
    backupMode: "FULL",
    fullEveryDays: 7,
    verifyByHash: false,
    source: { name: "Shop DB", adapterId: "postgres" },
    schedulePreset: null,
    encryptionProfile: { name: "Prod key" },
    namingTemplate: null,
    destinations: [
        { retention: "{}", retentionPolicy: { name: "Keep 30" }, config: { name: "S3" } },
        { retention: "{}", retentionPolicy: null, config: { name: "NAS" } },
    ],
    sources: [],
    notifications: [],
    notificationTemplates: [{ template: { name: "Ops alerts" } }],
    ...overrides,
});

async function snapshot(overrides: Record<string, unknown> = {}): Promise<JobAuditSnapshot> {
    prismaMock.job.findUnique.mockResolvedValueOnce(row(overrides) as never);
    const result = await jobAuditSnapshot("job-1");
    if (!result) throw new Error("The job was not read");
    return result;
}

describe("what the audit log keeps of a job", () => {
    it("reads every setting of the form with names in place of ids", async () => {
        expect(await snapshot()).toEqual({
            name: "Shop nightly",
            enabled: true,
            schedule: "0 3 * * *",
            schedulePreset: null,
            source: "Shop DB",
            databases: "All databases",
            folders: [],
            leavesOut: [],
            stopsContainers: [],
            backupMode: "Every backup in full",
            fullEveryDays: null,
            verifyByHash: null,
            destinations: ["S3 (Keep 30)", "NAS (Default policy)"],
            compression: "Gzip",
            // An older job stores nothing here, which pg_dump runs as Gzip at level 6.
            dumpCompression: "Gzip, level 6",
            encryption: "Prod key",
            notificationTemplates: ["Ops alerts"],
            notificationChannels: [],
            notifyAfter: null,
            fileNames: "Default template",
            integrityChecks: true,
        });
    });

    it("names each folder with its connection, and what it leaves out with the folder it belongs to", async () => {
        const result = await snapshot({
            source: null,
            backupMode: "INCREMENTAL",
            fullEveryDays: 14,
            verifyByHash: true,
            sources: [
                { path: "/data", excludePatterns: '["*.tmp"]', stopContainers: true, config: { name: "NAS", adapterId: "sftp" }, excludePatternPresets: [{ name: "Dev junk" }] },
                { path: "pg_data", excludePatterns: "[]", stopContainers: true, config: { name: "Docker", adapterId: "docker-volume" }, excludePatternPresets: [] },
            ],
        });

        expect(result).toMatchObject({
            source: null,
            databases: null,
            dumpCompression: null,
            folders: ["/data on NAS", "pg_data on Docker"],
            leavesOut: ["*.tmp in /data on NAS", "Dev junk preset in /data on NAS"],
            // Only a Docker volume stops anything, the switch of the NAS folder does nothing.
            stopsContainers: ["pg_data on Docker"],
            backupMode: "Only what changed",
            fullEveryDays: "14 days",
            verifyByHash: true,
        });
    });

    it("tells a picked retention policy, the default policy and the inline setting of an older job apart", async () => {
        const result = await snapshot({
            destinations: [
                { retention: '{"mode":"SIMPLE","simple":{"keepCount":5}}', retentionPolicy: null, config: { name: "FTP" } },
                { retention: "", retentionPolicy: null, config: { name: "NAS" } },
            ],
        });

        expect(result.destinations).toEqual(["FTP (custom)", "NAS (Default policy)"]);
    });

    it("lists only the settings a save changed, and keeps a rename apart from them", async () => {
        const before = await snapshot();
        const after = await snapshot({
            name: "Shop hourly",
            schedule: "0 * * * *",
            encryptionProfile: null,
            destinations: [
                { retention: "{}", retentionPolicy: { name: "Keep 30" }, config: { name: "S3" } },
                { retention: "{}", retentionPolicy: { name: "Keep 7" }, config: { name: "NAS" } },
            ],
        });

        expect(jobChangeDetails(before, after)).toEqual({
            name: "Shop hourly",
            renamedFrom: "Shop nightly",
            changes: [
                { field: "When it runs", from: "0 3 * * *", to: "0 * * * *" },
                { field: "Destinations", from: "S3 (Keep 30), NAS (Default policy)", to: "S3 (Keep 30), NAS (Keep 7)" },
                { field: "Encryption key", from: "Prod key", to: null },
            ],
        });
    });

    it("sees no change in a new order of the destinations or in the older way of storing the same setting", async () => {
        const channels = [{ name: "Slack" }];
        const before = await snapshot({ notifications: channels, notificationEvents: "ALWAYS", pgCompression: "" });
        const after = await snapshot({
            notifications: channels,
            notificationEvents: "SUCCESS|PARTIAL|FAILED",
            pgCompression: "GZIP:6",
            destinations: [...row().destinations].reverse(),
        });

        expect(before.notifyAfter).toBe("After every run");
        expect(jobChangeDetails(before, after)).toEqual({ name: "Shop nightly", changes: [] });
    });

    it("shows the settings of the chain only once the job stores changes only", async () => {
        const folders = [{ path: "/data", excludePatterns: "[]", stopContainers: true, config: { name: "NAS", adapterId: "sftp" }, excludePatternPresets: [] }];
        const before = await snapshot({ source: null, sources: folders });
        const after = await snapshot({ source: null, sources: folders, backupMode: "INCREMENTAL" });

        expect(jobChangeDetails(before, after).changes).toEqual([
            { field: "What a backup stores", from: "Every backup in full", to: "Only what changed" },
            { field: "Full backup every", from: null, to: "7 days" },
            { field: "Detect changes by content", from: null, to: "Off" },
        ]);
    });

    it("reads nothing for a job that is gone, and never stops a save when the read fails", async () => {
        prismaMock.job.findUnique.mockResolvedValueOnce(null);
        expect(await jobAuditSnapshot("gone")).toBeNull();

        prismaMock.job.findUnique.mockRejectedValueOnce(new Error("database is locked"));
        expect(await jobAuditSnapshot("job-1")).toBeNull();

        prismaMock.job.findUnique.mockRejectedValueOnce(new Error("database is locked"));
        expect(await jobAuditName("job-1")).toBeNull();
    });
});
