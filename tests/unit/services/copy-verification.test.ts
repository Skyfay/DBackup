import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    configs: [] as { id: string; name: string; adapterId: string }[],
    native: new Set<string>(),
    verifyFile: vi.fn(),
    notify: vi.fn(),
    runner: {
        id: "exec-1",
        extras: [] as unknown[],
        logs: [] as string[],
        progress: [] as number[],
        finished: null as string | null,
    },
    execution: null as null | { id: string; type: string; status: string; metadata: string | null },
}));

vi.mock("@/lib/prisma", () => ({
    default: {
        adapterConfig: { findMany: vi.fn(async () => mocks.configs) },
        execution: { findUnique: vi.fn(async () => mocks.execution) },
    },
}));
vi.mock("@/lib/runner/system-task-runner", () => ({
    SystemTaskRunner: {
        create: vi.fn(async () => ({
            id: mocks.runner.id,
            start: vi.fn(async () => {}),
            setStage: vi.fn(),
            setExtra: (extra: { copies: unknown[] }) => mocks.runner.extras.push(JSON.parse(JSON.stringify(extra.copies))),
            setProgress: (value: number) => mocks.runner.progress.push(value),
            logEntry: (message: string) => mocks.runner.logs.push(message),
            finish: vi.fn(async (status: string) => {
                mocks.runner.finished = status;
            }),
        })),
    },
}));
vi.mock("@/services/storage/verification-service", () => ({
    checksNatively: (adapterId: string) => mocks.native.has(adapterId),
    verificationService: { verifyFile: mocks.verifyFile },
}));
vi.mock("@/services/notifications/system-notification-service", () => ({ notify: mocks.notify }));

import { readCopyVerification, startCopyVerification } from "@/services/storage/copy-verification";

const FILE = "UI Test/UI_Test_2026-09-26.tar";
const lastCopies = () => mocks.runner.extras[mocks.runner.extras.length - 1] as { destinationId: string; state: string; method?: string; processed?: number; total?: number; reason?: string }[];
const finished = () => vi.waitFor(() => expect(mocks.runner.finished).not.toBeNull());

describe("checking the copies of a backup", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.configs = [
            { id: "sftp", name: "Hetzner Box", adapterId: "sftp" },
            { id: "nas", name: "NAS Backups", adapterId: "local-filesystem" },
            { id: "drive", name: "Google Drive", adapterId: "google-drive" },
        ];
        mocks.native = new Set(["local-filesystem", "google-drive"]);
        mocks.runner.extras = [];
        mocks.runner.logs = [];
        mocks.runner.progress = [];
        mocks.runner.finished = null;
        mocks.verifyFile.mockImplementation(async () => ({ status: "passed", verifiedAt: "2026-09-26T12:00:00.000Z", method: "native" }));
    });

    it("checks the copies without a download first, one after the other, in one run", async () => {
        const { executionId } = await startCopyVerification(
            [{ destinationId: "sftp", file: FILE }, { destinationId: "nas", file: FILE }, { destinationId: "drive", file: FILE }],
            "Manu"
        );
        await finished();

        expect(executionId).toBe("exec-1");
        expect(mocks.verifyFile.mock.calls.map((call) => call[0])).toEqual(["nas", "drive", "sftp"]);
        expect(lastCopies().map((copy) => [copy.destinationId, copy.state])).toEqual([["nas", "passed"], ["drive", "passed"], ["sftp", "passed"]]);
        expect(mocks.runner.finished).toBe("Success");
        expect(mocks.notify).not.toHaveBeenCalled();
    });

    it("shows how far the download of a copy got", async () => {
        mocks.verifyFile.mockImplementation(async (_id: string, _file: string, _trigger: string, options: { onProgress: (processed: number, total: number) => void }) => {
            options.onProgress(50, 200);
            return { status: "passed", verifiedAt: "2026-09-26T12:00:00.000Z", method: "download" };
        });

        await startCopyVerification([{ destinationId: "sftp", file: FILE }], "Manu");
        await finished();

        expect(mocks.runner.extras).toContainEqual([expect.objectContaining({ destinationId: "sftp", state: "checking", method: "download", processed: 50, total: 200 })]);
        expect(mocks.runner.progress).toContain(25);
    });

    it("reports a copy that does not match, notifies, and still checks the others", async () => {
        mocks.verifyFile
            .mockImplementationOnce(async () => ({ status: "failed", verifiedAt: "x", method: "native", expectedChecksum: "aaa", actualChecksum: "bbb" }))
            .mockImplementationOnce(async () => {
                throw new Error("Connection refused");
            });

        await startCopyVerification([{ destinationId: "nas", file: FILE }, { destinationId: "drive", file: FILE }, { destinationId: "sftp", file: FILE }], "Manu");
        await finished();

        expect(lastCopies().map((copy) => [copy.destinationId, copy.state])).toEqual([["nas", "failed"], ["drive", "error"], ["sftp", "passed"]]);
        expect(lastCopies()[1].reason).toBe("Connection refused");
        expect(mocks.runner.finished).toBe("Failed");
        expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ failed: 1, passed: 1, errors: [{ file: FILE, destination: "NAS Backups", expected: "aaa", actual: "bbb" }] }),
        }));
    });

    it("says why a copy without a checksum was skipped", async () => {
        mocks.verifyFile.mockImplementation(async () => ({ status: "no_checksum", verifiedAt: "x" }));

        await startCopyVerification([{ destinationId: "nas", file: FILE }], "Manu");
        await finished();

        expect(lastCopies()[0]).toMatchObject({ state: "skipped", reason: "No checksum was stored for it" });
        expect(mocks.runner.finished).toBe("Success");
    });
});

describe("reading a check of copies", () => {
    it("hands the dialog the state of every copy, and nothing for a run of another kind", async () => {
        mocks.execution = { id: "exec-1", type: "Verification", status: "Running", metadata: JSON.stringify({ progress: 40, copies: [{ destinationId: "nas", file: FILE, state: "passed" }] }) };
        expect(await readCopyVerification("exec-1")).toEqual({ executionId: "exec-1", status: "Running", progress: 40, copies: [{ destinationId: "nas", file: FILE, state: "passed" }] });

        mocks.execution = { id: "exec-2", type: "Backup", status: "Running", metadata: null };
        expect(await readCopyVerification("exec-2")).toBeNull();
    });
});
