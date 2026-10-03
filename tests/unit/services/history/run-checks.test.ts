import { describe, expect, it } from "vitest";
import { buildChecks, copiesOf, type CheckTarget } from "@/services/history/run-checks";

const targets = new Map<string, CheckTarget>([
    ["nas", { name: "NAS Backups", adapterId: "sftp", native: false }],
    ["r2", { name: "Cloudflare R2", adapterId: "s3-r2", native: true }],
]);

describe("what a check of copies checked", () => {
    it("counts every destination of an integrity check against its plan, the copy checked now among them", () => {
        const checks = buildChecks("IntegrityCheck", {
            plan: { total: 5, destinations: [{ id: "nas", name: "NAS", adapterId: "sftp", count: 3 }, { id: "r2", name: "R2", adapterId: "s3-r2", count: 2 }] },
            copies: [
                { destinationId: "nas", file: "CRM daily/a.tar", size: 61, state: "failed", method: "download", expected: "91ac2e10", actual: "0b7fc9d4" },
                { destinationId: "r2", file: "CRM daily/a.tar", size: 61, state: "passed", method: "native" },
                { destinationId: "nas", file: "Wiki/b.tar", size: 52, state: "skipped", reason: "no checksum stored" },
                { destinationId: "nas", file: "Shop/c.tar", size: 104, state: "checking", method: "download", processed: 64, total: 104 },
            ],
        }, targets, true)!;

        expect(checks.total).toBe(5);
        expect(checks.backup).toBeNull();
        expect(checks.destinations).toEqual([
            { id: "nas", name: "NAS Backups", adapterId: "sftp", total: 3, checked: 2, passed: 0, differ: 1, skipped: 1, native: false },
            { id: "r2", name: "Cloudflare R2", adapterId: "s3-r2", total: 2, checked: 1, passed: 1, differ: 0, skipped: 0, native: true },
        ]);
        expect(checks.copies[3]).toMatchObject({ state: "checking", processed: 64, total: 104, method: "download" });
    });

    it("takes the destinations of a verification from its copies, and the backup from their file", () => {
        const checks = buildChecks("Verification", {
            copies: [
                { destinationId: "r2", file: "UI Test/chain-1/UI_Test_full-000.tar", state: "passed", method: "native" },
                { destinationId: "nas", file: "UI Test/chain-1/UI_Test_full-000.tar", state: "checking", processed: 86, total: 139 },
            ],
        }, targets, false)!;

        expect(checks.total).toBe(2);
        expect(checks.destinations.map((entry) => [entry.name, entry.total, entry.checked])).toEqual([["Cloudflare R2", 1, 1], ["NAS Backups", 1, 0]]);
        expect(checks.backup).toEqual({ name: "UI Test", file: "UI_Test_full-000.tar", size: 139 });
    });

    it("is no check for any other run, nor for a finished check from before copies were recorded", () => {
        expect(buildChecks("Backup", { copies: [] }, targets, false)).toBeNull();
        expect(buildChecks("IntegrityCheck", {}, targets, false)).toBeNull();
        expect(buildChecks("IntegrityCheck", {}, targets, true)).toMatchObject({ total: 0, copies: [] });
    });

    it("keeps only copies it can read", () => {
        expect(copiesOf([{ destinationId: "nas", file: "a.tar", state: "odd" }, { file: "b.tar" }, null])).toEqual([
            expect.objectContaining({ destinationId: "nas", file: "a.tar", state: "waiting", method: null, size: null }),
        ]);
    });
});
