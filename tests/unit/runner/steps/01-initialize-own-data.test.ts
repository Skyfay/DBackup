import { describe, it, expect, vi, beforeEach } from "vitest";
import { stepInitialize } from "@/lib/runner/steps/01-initialize";
import type { RunnerContext } from "@/lib/runner/types";

/**
 * A run checks again what a save checked, since a link can point elsewhere by now and a job of a
 * member may use a connection of the platform admin: no run reads or writes DBackup's own data,
 * and no job called like the folder of the configuration backup writes among its files.
 */

const mocks = vi.hoisted(() => ({
    job: vi.fn(),
    ownData: vi.fn(),
    ownVolume: vi.fn(),
}));

vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
    default: {
        job: { findUnique: (...args: unknown[]) => mocks.job(...args) },
        execution: { create: vi.fn() },
        connectionShare: { count: vi.fn().mockResolvedValue(0) },
    },
}));
vi.mock("@/services/sharing/provided", () => ({ providedConnection: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/core/registry", () => ({
    registry: { get: (id: string) => ({ id, type: id === "mysql" ? "database" : "storage", upload: vi.fn() }), register: vi.fn() },
}));
vi.mock("@/lib/adapters/config-resolver", () => ({
    resolveAdapterConfig: vi.fn(async (row: { config: string }) => JSON.parse(row.config)),
}));
vi.mock("@/lib/adapters/own-data", () => ({
    ownDataRefusal: (...args: unknown[]) => mocks.ownData(...args),
    ownVolumeRefusal: (...args: unknown[]) => mocks.ownVolume(...args),
}));
vi.mock("@/lib/logging/logger", () => ({
    logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

const REFUSED = "This path reaches the folder of DBackup's own database, which only a platform admin connects.";

function ctx(): RunnerContext {
    return {
        jobId: "job-1",
        execution: { id: "exec-1" },
        logs: [],
        log: vi.fn(),
        updateProgress: vi.fn(),
        setStage: vi.fn(),
        updateDetail: vi.fn(),
        updateStageProgress: vi.fn(),
        destinations: [],
        status: "Running",
        startedAt: new Date(),
    } as unknown as RunnerContext;
}

const connection = (id: string, adapterId: string, config: Record<string, unknown>, name = id) =>
    ({ id, adapterId, config: JSON.stringify(config), name, type: adapterId === "mysql" ? "database" : "storage", tenantId: "default", primaryCredentialId: null, sshCredentialId: null });

function job(overrides: Record<string, unknown> = {}) {
    return {
        id: "job-1",
        name: "Nightly",
        tenantId: "default",
        encryptionProfileId: null,
        source: connection("db", "mysql", { host: "db.internal" }),
        destinations: [
            { id: "d-1", configId: "nas", priority: 0, retention: "{}", config: connection("nas", "local-filesystem", { basePath: "/backups" }, "NAS") },
            { id: "d-2", configId: "data", priority: 1, retention: "{}", config: connection("data", "local-filesystem", { basePath: "/data" }, "Data") },
        ],
        sources: [],
        notifications: [],
        notificationTemplates: [],
        ...overrides,
    };
}

describe("a run that reaches DBackup's own data", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.ownData.mockImplementation(async (_adapterId: string, config: { basePath?: string }, options?: { subPath?: string }) =>
            config.basePath === "/data" || options?.subPath === "linked" ? REFUSED : null);
        mocks.ownVolume.mockImplementation(async (adapterId: string, _config: unknown, volume: string) =>
            adapterId === "docker-volume" && volume === "dbackup_data" ? "DBackup's own container keeps its database in this volume." : null);
    });

    it("writes nothing to a destination there and keeps the others", async () => {
        mocks.job.mockResolvedValue(job());
        const run = ctx();

        await stepInitialize(run);

        expect(run.destinations.map((destination) => [destination.configId, destination.refusal])).toEqual([["nas", undefined], ["data", REFUSED]]);
        expect(mocks.ownData).toHaveBeenCalledWith("local-filesystem", { basePath: "/backups" }, { configId: "nas" });
    });

    it("writes nothing into a destination whose folder of the job leads there, also the destination of the configuration backup", async () => {
        mocks.ownData.mockImplementation(async (_adapterId: string, _config: unknown, options?: { subPath?: string; configId?: string }) =>
            options?.subPath === "Nightly" ? REFUSED : null);
        mocks.job.mockResolvedValue(job());
        const run = ctx();

        await stepInitialize(run);

        expect(run.destinations.map((destination) => destination.refusal)).toEqual([REFUSED, REFUSED]);
        // The folder of the job is checked without the room the configuration backup has in its own folder.
        expect(mocks.ownData).toHaveBeenCalledWith("local-filesystem", { basePath: "/backups" }, { subPath: "Nightly" });
    });

    it("refuses to read a folder of a job that leads there", async () => {
        mocks.job.mockResolvedValue(job({
            source: null,
            sources: [{ id: "s-1", path: "linked", priority: 0, excludePatterns: "[]", excludePatternPresets: [], stopContainers: false, config: connection("files", "local-filesystem", { basePath: "/srv" }, "Files") }],
        }));

        await expect(stepInitialize(ctx())).rejects.toThrow(`Files: ${REFUSED}`);
        expect(mocks.ownData).toHaveBeenCalledWith("local-filesystem", { basePath: "/srv" }, { subPath: "linked" });
    });

    it("refuses to read the Docker volume DBackup's own container keeps its data in", async () => {
        mocks.job.mockResolvedValue(job({
            source: null,
            sources: [{ id: "s-1", path: "dbackup_data", priority: 0, excludePatterns: "[]", excludePatternPresets: [], stopContainers: false, config: connection("docker", "docker-volume", { connectionMode: "direct" }, "Docker") }],
        }));

        await expect(stepInitialize(ctx())).rejects.toThrow("Docker: DBackup's own container keeps its database in this volume.");
        expect(mocks.ownVolume).toHaveBeenCalledWith("docker-volume", { connectionMode: "direct" }, "dbackup_data");
    });
});

describe("a run of a job called like the folder of the configuration backup", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.ownData.mockResolvedValue(null);
    });

    it("stops before it writes anything, also when the name came back from an older file or Recently deleted", async () => {
        mocks.job.mockResolvedValue(job({ name: "Config-Backups." }));

        await expect(stepInitialize(ctx())).rejects.toThrow("cannot be called config-backups");
    });

    it("stops a job whose name leads out of its own folder, or into that one through a . or .. folder", async () => {
        for (const name of ["x/../config-backups", "x/..", "/", "./nightly"]) {
            mocks.job.mockResolvedValue(job({ name }));
            await expect(stepInitialize(ctx())).rejects.toThrow(/cannot be called config-backups|cannot hold a \. or \.\. folder/);
        }
        expect(mocks.ownData).not.toHaveBeenCalled();
    });
});

describe("a run of a job whose directory source leaves the folder of its connection", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.ownData.mockResolvedValue(null);
        mocks.ownVolume.mockResolvedValue(null);
    });

    const files = (path: string) => job({
        source: null,
        sources: [{ id: "s-1", path, priority: 0, excludePatterns: "[]", excludePatternPresets: [], stopContainers: false, config: connection("files", "sftp", { host: "files.internal", pathPrefix: "/home/customer-a" }, "Files") }],
    });

    it("stops before it reads anything, for a job saved before a save refused such a folder", async () => {
        for (const path of ["../customer-b", "data\\..\\..\\customer-b", "%2e%2e%2fcustomer-b"]) {
            mocks.job.mockResolvedValue(files(path));
            const run = ctx();
            await expect(stepInitialize(run)).rejects.toThrow(`Job Nightly, source Files: The folder ${path} leaves the folder of its connection.`);
            expect(run.sources ?? []).toEqual([]);
        }
        expect(mocks.ownData).not.toHaveBeenCalled();
    });

    it("reads a folder inside the connection and the whole connection", async () => {
        for (const [path, remotePath] of [["/", ""], ["data/app", "data/app"]]) {
            mocks.job.mockResolvedValue(files(path));
            const run = ctx();
            await stepInitialize(run);
            expect(run.sources.map((source) => source.remotePath)).toEqual([remotePath]);
        }
    });
});

describe("a run of a Docker Volumes job whose path is no volume", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.ownData.mockResolvedValue(null);
        mocks.ownVolume.mockResolvedValue(null);
    });

    const volume = (path: string, connectionMode = "direct") => job({
        source: null,
        sources: [{ id: "s-1", path, priority: 0, excludePatterns: "[]", excludePatternPresets: [], stopContainers: true, config: connection("docker", "docker-volume", { connectionMode }, "Docker") }],
    });

    it("stops before Docker mounts a folder of its host, for a job saved before a save refused it", async () => {
        for (const path of ["/etc", "/var/lib/docker/volumes/dbackup-data/_data", "/"]) {
            for (const mode of ["direct", "ssh"]) {
                mocks.job.mockResolvedValue(volume(path, mode));
                const run = ctx();
                await expect(stepInitialize(run)).rejects.toThrow("Job Nightly, source Docker: ");
                expect(run.sources ?? []).toEqual([]);
            }
        }
        expect(mocks.ownVolume).not.toHaveBeenCalled();
    });

    it("reads a volume by its name", async () => {
        mocks.job.mockResolvedValue(volume("immich_upload"));
        const run = ctx();

        await stepInitialize(run);

        expect(run.sources.map((source) => source.remotePath)).toEqual(["immich_upload"]);
    });
});
