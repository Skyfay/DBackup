import { describe, expect, it } from "vitest";
import { buildTemplatesModel, type JobRecord, type TemplateRecords } from "@/services/templates/templates-model";

const STAMP = { description: null, createdAt: new Date("2026-03-14T10:00:00Z"), updatedAt: new Date("2026-09-02T10:00:00Z") };

function job(overrides: Partial<JobRecord> = {}): JobRecord {
    return {
        id: "shop",
        name: "Shop nightly",
        enabled: true,
        schedule: "0 1 * * *",
        presetSchedule: null,
        schedulePresetId: null,
        namingTemplateId: null,
        sourceType: "postgres",
        incremental: false,
        databases: "[\"shop\"]",
        destinations: [],
        folders: [],
        ...overrides,
    };
}

function records(overrides: Partial<TemplateRecords> = {}): TemplateRecords {
    return {
        timezone: "Europe/Zurich",
        channels: [],
        jobs: [],
        retention: [
            { ...STAMP, id: "gfs", name: "Smart GFS", config: "{\"mode\":\"SMART\",\"smart\":{\"daily\":7,\"weekly\":4,\"monthly\":12,\"yearly\":2}}", isDefault: true, isSystem: true, prefills: [] },
            { ...STAMP, id: "keep14", name: "Simple - 14 Days", config: "{\"mode\":\"SIMPLE\",\"simple\":{\"keepCount\":14}}", isDefault: false, isSystem: true, prefills: [] },
        ],
        naming: [
            { ...STAMP, id: "standard", name: "Standard", pattern: "{job_name}_yyyy-MM-dd_HH-mm-ss", isDefault: true, isSystem: true },
            { ...STAMP, id: "daily", name: "Daily", pattern: "{job_name}_yyyy-MM-dd", isDefault: false, isSystem: false },
        ],
        schedules: [{ ...STAMP, id: "3am", name: "Daily at 3 AM", schedule: "0 3 * * *" }],
        notifications: [],
        excludes: [{ ...STAMP, id: "junk", name: "System Junk Files", patterns: "[]", groups: "[\"macos\"]", excludedGroupPatterns: "[]", isDefault: true, isSystem: true }],
        ...overrides,
    };
}

const destination = (configId: string, retentionPolicyId: string | null, retention = "{}") => ({ configId, name: configId.toUpperCase(), adapterId: "smb", retention, retentionPolicyId });

describe("buildTemplatesModel", () => {
    it("counts a destination without a policy of its own under the default policy, the way the runner resolves it", () => {
        const model = buildTemplatesModel(records({
            jobs: [
                job({ destinations: [destination("nas", null), destination("r2", "keep14")] }),
                job({ id: "crm", name: "CRM", destinations: [destination("nas", null, "{\"mode\":\"SIMPLE\",\"simple\":{\"keepCount\":3}}")] }),
            ],
        }));

        const gfs = model.retention.find((row) => row.id === "gfs")!;
        const keep14 = model.retention.find((row) => row.id === "keep14")!;
        expect(gfs.uses).toEqual([{ jobId: "shop", destinationId: "nas", destinationName: "NAS", adapterId: "smb", how: "default" }]);
        expect(keep14.uses.map((use) => use.how)).toEqual(["picked"]);
        // A setting saved in the job before templates existed is neither picked nor the default.
        expect(model.retentionTotals).toEqual({ destinations: 3, picked: 1, followDefault: 1, own: 1 });
        expect(gfs.config).toEqual({ mode: "SMART", smart: { daily: 7, weekly: 4, monthly: 12, yearly: 2 } });
    });

    it("leaves the followers counted but unassigned while no policy is the default", () => {
        const base = records();
        const model = buildTemplatesModel({
            ...base,
            retention: base.retention.map((policy) => ({ ...policy, isDefault: false })),
            jobs: [job({ destinations: [destination("nas", null)] })],
        });

        expect(model.retention.every((row) => row.uses.length === 0)).toBe(true);
        expect(model.retentionTotals.followDefault).toBe(1);
    });

    it("names the jobs of a file name template and the ones that follow the default", () => {
        const model = buildTemplatesModel(records({ jobs: [job(), job({ id: "wiki", name: "Wiki", namingTemplateId: "daily" })] }));

        expect(model.naming.find((row) => row.id === "standard")!.uses).toEqual([{ jobId: "shop", how: "default" }]);
        expect(model.naming.find((row) => row.id === "daily")!.uses).toEqual([{ jobId: "wiki", how: "picked" }]);
        expect(model.namingTotals).toEqual({ jobs: 2, picked: 1, followDefault: 1 });
    });

    it("hands each job the schedule the scheduler reads, the one of its preset when it follows one", () => {
        const model = buildTemplatesModel(records({ jobs: [job({ schedulePresetId: "3am", presetSchedule: "0 3 * * *" })] }));

        expect(model.schedules[0].jobIds).toEqual(["shop"]);
        expect(model.jobs[0]).toMatchObject({ schedule: "0 3 * * *", databases: ["shop"], hasFolders: false });
    });

    it("lists the folders of an exclude preset and counts the folders without one", () => {
        const folder = (id: string, presetIds: string[]) => ({ id, configId: "photos", name: "Photos share", adapterId: "smb", path: `/volume1/${id}`, presetIds });
        const model = buildTemplatesModel(records({ jobs: [job({ id: "photos", name: "Photos", incremental: true, folders: [folder("photo", ["junk"]), folder("video", [])] })] }));

        expect(model.excludes[0].folders).toEqual([{ id: "photo", jobId: "photos", connectionId: "photos", connectionName: "Photos share", adapterId: "smb", path: "/volume1/photo" }]);
        expect(model.excludes[0].groups).toEqual(["macos"]);
        expect(model.folders).toEqual({ total: 2, withPreset: 1 });
        expect(model.jobs[0]).toMatchObject({ hasFolders: true, incremental: true });
    });

    it("keeps a policy it cannot read as one that keeps everything", () => {
        const base = records();
        const model = buildTemplatesModel({ ...base, retention: [{ ...base.retention[0], config: "not json" }] });

        expect(model.retention[0].config).toEqual({ mode: "NONE" });
    });
});
