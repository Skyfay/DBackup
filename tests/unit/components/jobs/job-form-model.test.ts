import { describe, expect, it } from "vitest";
import { DEFAULT_RETENTION_SENTINEL } from "@/components/templates/retention-policy-picker";
import { firstPartWithError, jobPartStatuses, jobParts } from "@/components/dashboard/jobs/job-form-layout";
import { jobDefaults, jobSchema, toJobPayload, type JobFormValues } from "@/components/dashboard/jobs/job-form-schema";
import type { JobListItem } from "@/services/jobs/job-list-service";

const connection = (id: string, adapterId: string) => ({ id, name: id, adapterId, lastStatus: "ONLINE" });

const saved = {
    id: "job-1",
    name: "Shop nightly",
    schedule: "0 3 * * *",
    enabled: true,
    sourceId: "db-1",
    databases: JSON.stringify(["shop", "billing"]),
    encryptionProfileId: "key-1",
    compression: "GZIP",
    pgCompression: "",
    notificationEvents: "PARTIAL|FAILED",
    namingTemplateId: null,
    schedulePresetId: null,
    skipVerification: false,
    backupMode: "FULL",
    fullEveryDays: 7,
    verifyByHash: false,
    createdAt: "2026-03-12T10:00:00.000Z",
    source: connection("db-1", "mysql"),
    destinations: [
        { configId: "nas", priority: 0, retention: "{}", retentionPolicyId: null, retentionPolicy: null, config: connection("nas", "sftp") },
        { configId: "s3", priority: 1, retention: "{}", retentionPolicyId: "policy-1", retentionPolicy: { name: "Long term" }, config: connection("s3", "s3-aws") },
    ],
    sources: [],
    notifications: [],
    notificationTemplates: [{ templateId: "template-1", priority: 0, template: { name: "Ops" } }],
    encryptionProfile: { id: "key-1", name: "Backup key" },
    schedulePreset: null,
    namingTemplate: null,
    overview: { status: null, runs: [], lastRun: null, error: null, live: null, nextRunAt: null },
} as unknown as JobListItem;

const errorsOf = (values: JobFormValues) => {
    const result = jobSchema.safeParse(values);
    return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
};

describe("job form values", () => {
    it("start from the job they edit, with the picked databases and each destination's policy", () => {
        const values = jobDefaults(saved);
        expect(values).toMatchObject({ sourceMode: "db", databaseScope: "some", databases: ["shop", "billing"], encryptionProfileId: "key-1", notificationTemplateIds: ["template-1"] });
        expect(values.destinations.map((destination) => destination.retentionPolicyId)).toEqual([DEFAULT_RETENTION_SENTINEL, "policy-1"]);
    });

    it("go back as the request the job API takes, the default policy as an empty setting", () => {
        const payload = toJobPayload(jobDefaults(saved), "mysql");
        expect(payload).toMatchObject({ name: "Shop nightly", sourceId: "db-1", databases: ["shop", "billing"], sources: [], encryptionProfileId: "key-1", pgCompression: "", schedulePresetId: null });
        expect(payload.destinations).toEqual([
            { configId: "nas", priority: 0, retention: {}, retentionPolicyId: null },
            { configId: "s3", priority: 1, retention: {}, retentionPolicyId: "policy-1" },
        ]);
    });

    it("send only what the source mode keeps, and every database once All is picked", () => {
        const values: JobFormValues = { ...jobDefaults(saved), databaseScope: "all", sourceMode: "dirs", directorySources: [{ configId: "files", path: "/srv", excludePatterns: [], excludePatternPresetIds: [], stopContainers: true }] };
        const payload = toJobPayload(values, "mysql");
        expect(payload.sourceId).toBe("");
        expect(payload.databases).toEqual([]);
        expect(payload.sources).toEqual([{ configId: "files", path: "/srv", excludePatterns: [], excludePatternPresetIds: [], stopContainers: true, priority: 0 }]);
    });

    it("turn the PostgreSQL algorithm and level into one setting for a PostgreSQL source only", () => {
        const values: JobFormValues = { ...jobDefaults(saved), pgCompressionAlgo: "ZSTD", pgCompressionLevel: 5 };
        expect(toJobPayload(values, "postgres").pgCompression).toBe("ZSTD:5");
        expect(toJobPayload(values, "mysql").pgCompression).toBe("");
    });

    it("start a job without folders in full, whatever an older version stored for it", () => {
        const folder = { configId: "files", path: "/srv", excludePatterns: [], excludePatternPresetIds: [], stopContainers: true };
        expect(jobDefaults({ ...saved, backupMode: "INCREMENTAL" } as JobListItem).backupMode).toBe("FULL");
        expect(jobDefaults({ ...saved, backupMode: "INCREMENTAL", sources: [folder] } as unknown as JobListItem).backupMode).toBe("INCREMENTAL");
        expect(jobDefaults(null).backupMode).toBe("FULL");
    });

    it("check the days between full backups only where the job builds chains with them", () => {
        const folders: JobFormValues = {
            ...jobDefaults(saved),
            sourceMode: "dirs",
            directorySources: [{ configId: "files", path: "/srv", excludePatterns: [], excludePatternPresetIds: [], stopContainers: true }],
        };
        expect(errorsOf({ ...folders, backupMode: "INCREMENTAL", fullEveryDays: 0 })).toEqual(["fullEveryDays"]);
        expect(errorsOf({ ...folders, backupMode: "INCREMENTAL", fullEveryDays: 400 })).toEqual(["fullEveryDays"]);
        expect(errorsOf({ ...folders, backupMode: "FULL", fullEveryDays: 0 })).toEqual([]);
        // A job of only a database hides the part, so an old value there cannot stop the save.
        expect(errorsOf({ ...jobDefaults(saved), backupMode: "INCREMENTAL", fullEveryDays: 0 })).toEqual([]);
    });

    it("refuse Some databases without one picked, a preset without its pick and folders mode without a folder", () => {
        const base = jobDefaults(saved);
        expect(errorsOf({ ...base, databases: [] })).toEqual(["databases"]);
        expect(errorsOf({ ...base, scheduleMode: "preset", schedulePresetId: null })).toEqual(["schedulePresetId"]);
        expect(errorsOf({ ...base, sourceMode: "dirs" })).toEqual(["directorySources"]);
        expect(errorsOf({ ...base, sourceMode: "both", sourceId: "" })).toEqual(["sourceId", "directorySources"]);
    });
});

describe("job form parts", () => {
    it("check a part once it has what the job needs, and keep the optional ones quiet", () => {
        const statuses = jobPartStatuses(jobDefaults(saved), []);
        expect(statuses).toMatchObject({ basics: { kind: "done" }, source: { kind: "done" }, destinations: { kind: "done" }, encryption: { kind: "none" } });
        expect(jobPartStatuses(jobDefaults(null), []).source).toEqual({ kind: "todo" });
    });

    it("leave Incremental out of a job of only a database, and list it right after the source otherwise", () => {
        expect(jobParts("db").map((part) => part.id)).toEqual(["basics", "source", "destinations", "compression", "encryption", "notifications", "advanced"]);
        expect(jobParts("dirs").map((part) => part.id).slice(0, 4)).toEqual(["basics", "source", "incremental", "destinations"]);
        expect(jobParts("both").map((part) => part.id)).toContain("incremental");
        // The form only opens a part it lists.
        expect(firstPartWithError(["verifyByHash", "destinations"], jobParts("db"))).toBe("destinations");
    });

    it("count errors on their part and open the first part that has one", () => {
        expect(jobPartStatuses(jobDefaults(null), ["destinations", "sourceId", "databases"]).source).toEqual({ kind: "error", count: 2 });
        expect(firstPartWithError(["destinations", "sourceId"])).toBe("source");
        // Incremental backups have a part of their own, right after the source.
        expect(firstPartWithError(["fullEveryDays", "destinations"])).toBe("incremental");
        expect(firstPartWithError(["namingTemplateId"])).toBe("advanced");
        // Compression has a part of its own, between the destinations and the encryption.
        expect(firstPartWithError(["pgCompressionLevel", "encryptionProfileId"])).toBe("compression");
    });
});
