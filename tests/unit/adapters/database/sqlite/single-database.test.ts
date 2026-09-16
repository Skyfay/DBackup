import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFsStat } = vi.hoisted(() => ({ mockFsStat: vi.fn() }));

vi.mock("fs/promises", () => ({
    default: { stat: (...args: unknown[]) => mockFsStat(...args) },
    stat: (...args: unknown[]) => mockFsStat(...args),
}));

import { createFakeHost } from "@/lib/testing/fake-host";
import { dumpOne, listDumpEntries } from "@/lib/adapters/database/sqlite/dump";
import { restoreOne, resolveSqliteTargetPath } from "@/lib/adapters/database/sqlite/restore";
import type { HostKind } from "@/lib/transport/types";

const baseConfig = { mode: "local", path: "/data/app.sqlite" };

describe("SQLite restore target path", () => {
    it("keeps the configured file when restoring under the original name", () => {
        expect(resolveSqliteTargetPath("/data/app.sqlite", "app.sqlite", "app.sqlite")).toBe("/data/app.sqlite");
        expect(resolveSqliteTargetPath("/data/app.sqlite", undefined, "app.sqlite")).toBe("/data/app.sqlite");
    });

    it("writes a renamed restore as a sibling file", () => {
        expect(resolveSqliteTargetPath("/data/app.sqlite", "app-copy.sqlite", "app.sqlite")).toBe("/data/app-copy.sqlite");
    });

    it("refuses a target name that points into another directory", () => {
        expect(() => resolveSqliteTargetPath("/data/app.sqlite", "../etc/app.sqlite", "app.sqlite")).toThrow(/without a directory/);
        expect(() => resolveSqliteTargetPath("/data/app.sqlite", "..", "app.sqlite")).toThrow(/without a directory/);
    });
});

describe.each<HostKind>(["direct", "ssh"])("SQLite single-database backup over a %s host", (kind) => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFsStat.mockResolvedValue({ size: 4096 });
    });

    it("always backs up the one configured file, whatever was selected", async () => {
        const host = createFakeHost({ kind });
        expect(await listDumpEntries(baseConfig as never, ["something-else"], host)).toEqual(["app.sqlite"]);
    });

    it("snapshots the file with .backup and reports its size", async () => {
        const host = createFakeHost({ kind });
        const { size } = await dumpOne(baseConfig as never, "app.sqlite", "/tmp/0001.sqlite", host);

        expect(size).toBe(4096);
        expect(host.calls.exec.some((argv) => argv.some((a) => a.startsWith(".backup")))).toBe(true);
    });

    it("throws when sqlite3 fails", async () => {
        const host = createFakeHost({ kind, onExec: () => ({ code: 1, stderr: "database is locked" }) });
        await expect(dumpOne(baseConfig as never, "app.sqlite", "/tmp/0001.sqlite", host)).rejects.toThrow(/database is locked/);
    });

    it("restores a renamed database into a sibling file", async () => {
        const host = createFakeHost({ kind });
        await restoreOne(baseConfig as never, "/tmp/restore-db-1.sqlite", "app-copy.sqlite", host, undefined, undefined, "app.sqlite");

        const restoreCall = host.calls.exec.find((argv) => argv.some((a) => a.startsWith(".restore")))!;
        expect(restoreCall[1]).toBe("/data/app-copy.sqlite");
    });

    it("throws when the restore fails", async () => {
        const host = createFakeHost({
            kind,
            onExec: (argv) => (argv.some((a) => a.startsWith(".restore")) ? { code: 1, stderr: "not a database" } : { code: 0 }),
        });
        await expect(restoreOne(baseConfig as never, "/tmp/restore-db-1.sqlite", "app.sqlite", host, undefined, undefined, "app.sqlite"))
            .rejects.toThrow(/not a database/);
    });
});
