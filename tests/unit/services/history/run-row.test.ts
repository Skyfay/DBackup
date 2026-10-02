import { describe, expect, it } from "vitest";
import { copiesOf, nameAndSub, noteOf, parseMetadata, runRow, starterOf } from "@/services/history/run-row";
import { record } from "./run-fixtures";

describe("starterOf", () => {
    it("keys the schedule, a person, an API key and a run that does not say", () => {
        expect(starterOf("Scheduler", "Scheduler")).toEqual({ key: "schedule", kind: "schedule", label: "Schedule" });
        expect(starterOf("Manual", "Manu")).toEqual({ key: "manual:Manu", kind: "manual", label: "Manu" });
        expect(starterOf("Api", "CI deploy")).toEqual({ key: "api:CI deploy", kind: "api", label: "CI deploy" });
        expect(starterOf(null, null).key).toBe("none");
    });
});

describe("nameAndSub", () => {
    it("names a backup after its job and lists its databases", () => {
        const run = record();
        expect(nameAndSub(run, parseMetadata(run.metadata))).toEqual({ name: "Shop offsite", sub: "Backup · shop, billing" });
    });

    it("names a restore after the server it went to and the file it came from", () => {
        const run = record({ type: "Restore", jobId: null, job: null, path: "Shop nightly/2026-09-26.tar", metadata: JSON.stringify({ target: { name: "Shop staging", adapterId: "postgres" } }) });
        expect(nameAndSub(run, parseMetadata(run.metadata))).toEqual({ name: "Restore onto Shop staging", sub: "Restore · 2026-09-26.tar" });
    });

    it("gives the system tasks a name of their own", () => {
        const run = record({ type: "IntegrityCheck", jobId: null, job: null, metadata: null });
        expect(nameAndSub(run, {}).name).toBe("Integrity check");
    });

    it("keeps a backup of a deleted job apart", () => {
        const run = record({ job: null, jobId: null });
        expect(nameAndSub(run, parseMetadata(run.metadata)).name).toBe("A deleted job");
    });
});

describe("copiesOf", () => {
    it("counts the copies of a finished backup and names the destinations that failed", () => {
        const metadata = parseMetadata(JSON.stringify({ destinations: [{ name: "NAS Backups", status: "success" }, { name: "Google Drive", status: "failed" }] }));
        expect(copiesOf(metadata)).toEqual({ stored: 1, total: 2, failed: ["Google Drive"] });
    });

    it("counts the uploads of a live backup", () => {
        const metadata = parseMetadata(JSON.stringify({ uploads: [{ configId: "nas", name: "NAS Backups", state: "done" }, { configId: "r2", name: "Cloudflare R2", state: "uploading" }] }));
        expect(copiesOf(metadata)).toEqual({ stored: 1, total: 2, failed: [] });
    });

    it("has none for a run without destinations", () => {
        expect(copiesOf({})).toBeNull();
    });

    it("leaves out an air-gapped destination the run skipped, finished or live", () => {
        const finished = parseMetadata(JSON.stringify({ destinations: [{ name: "NAS", status: "success" }, { name: "USB rotation", status: "skipped", airGapped: true }] }));
        expect(copiesOf(finished)).toEqual({ stored: 1, total: 1, failed: [] });

        const live = parseMetadata(JSON.stringify({ uploads: [
            { configId: "nas", name: "NAS", state: "uploading" },
            { configId: "usb", name: "USB rotation", state: "skipped", error: "Air-gapped and not connected" },
        ] }));
        expect(copiesOf(live)).toEqual({ stored: 0, total: 1, failed: [] });
    });
});

describe("noteOf", () => {
    const live = { stage: "Dumping Databases", percent: 12, detail: null };

    it("says what a run left out, in a few words", () => {
        expect(noteOf("Failed", null, live, "Could not reach Shop cluster")).toBe("Could not reach Shop cluster");
        expect(noteOf("Failed", null, live, null)).toBe("while dumping databases");
        expect(noteOf("Partial", { stored: 1, total: 2, failed: ["Google Drive"] }, live, null)).toBe("Google Drive failed");
        expect(noteOf("Partial", { stored: 1, total: 3, failed: ["A", "B"] }, live, null)).toBe("2 destinations failed");
        expect(noteOf("Success", { stored: 2, total: 2, failed: [] }, live, null)).toBe("2 of 2 copies");
        expect(noteOf("Running", null, live, null)).toBe("Dumping Databases, 12 %");
        expect(noteOf("Pending", null, live, null)).toBe("waits for a free slot");
    });
});

describe("runRow", () => {
    it("gives a finished run its duration, size and who started it", () => {
        const row = runRow(record(), 400_000, null);
        expect(row).toMatchObject({ durationMs: 432_000, usualMs: 400_000, size: 2_200_000_000, adapterId: "postgres", live: null, note: "2 of 2 copies" });
        expect(row.starter.key).toBe("schedule");
    });

    it("keeps the live state of a running run and no duration", () => {
        const row = runRow(record({ status: "Running", endedAt: null, metadata: JSON.stringify({ stage: "Uploading", progress: 64.4 }) }), null, null);
        expect(row.durationMs).toBeNull();
        expect(row.live).toEqual({ stage: "Uploading", percent: 64, detail: null });
    });
});
