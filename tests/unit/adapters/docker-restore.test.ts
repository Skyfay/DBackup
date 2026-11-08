/**
 * Restoring into a Docker volume.
 *
 * Two things carry the weight here. Preparing a volume is destructive - an overwrite empties
 * it - so it has to happen exactly once per volume no matter how many files arrive at the
 * same moment. And the containers holding the target have to come back afterwards, including
 * when the restore fails partway.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDockerEngine, type FakeContainer, type FakeDockerEngine } from "@/lib/testing/fake-docker-engine";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const connectDocker = vi.fn();
vi.mock("@/lib/adapters/storage/docker/engine/connect", () => ({
    connectDocker: (config: unknown) => connectDocker(config),
    DEFAULT_SOCKET_PATH: "/var/run/docker.sock",
}));

// Outside of any container, whatever runs the tests, so no stop meets DBackup's own container.
vi.mock("@/lib/adapters/storage/docker/own-container", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/adapters/storage/docker/own-container")>()),
    ownContainerHints: async () => ({ inContainer: false, ids: [], hostname: "test" }),
}));

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const { openDockerRestoreSession } = await import("@/lib/adapters/storage/docker/restore-session");
const { splitVolumePath } = await import("@/lib/adapters/storage/docker/write");

const config = { connectionMode: "direct", helperImage: "alpine:3" };
const container = (id: string, volumes: string[], running = true): FakeContainer =>
    ({ id, name: id, running, volumes });

function useEngine(engine: FakeDockerEngine) {
    connectDocker.mockImplementation(() => ({ engine, close: async () => { await engine.close(); } }));
    return engine;
}

let sourceFile: string;

beforeEach(async () => {
    vi.clearAllMocks();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dbackup-restore-"));
    sourceFile = path.join(dir, "payload.txt");
    await fs.writeFile(sourceFile, "content\n");
});

describe("splitVolumePath", () => {
    it("takes the first component as the volume and the rest as the path inside it", () => {
        expect(splitVolumePath("myvolume/sub/file.txt")).toEqual({ volume: "myvolume", inner: "sub/file.txt" });
    });

    it("tolerates a leading slash, which the restore's path join can produce", () => {
        expect(splitVolumePath("/myvolume/file.txt")).toEqual({ volume: "myvolume", inner: "file.txt" });
    });

    it("refuses a path that names no file inside a volume", () => {
        // Writing to the volume root as if it were a file would be a silent no-op at best.
        expect(() => splitVolumePath("myvolume")).toThrow(/does not name a file inside a volume/);
        expect(() => splitVolumePath("myvolume/")).toThrow(/does not name a file inside a volume/);
    });
});

describe("the restore session", () => {
    it("empties an existing volume before the first file, and only once", async () => {
        // Overwrite has to mean the backup's state, not a merge of two - and emptying per
        // file would leave exactly the last one.
        const engine = useEngine(createFakeDockerEngine({
            volumes: ["v-target"],
            containers: [container("app", ["v-target"])],
        }));

        const session = openDockerRestoreSession(config);
        await session.upload(sourceFile, "v-target/a.txt");
        await session.upload(sourceFile, "v-target/b.txt");
        await session.close();

        expect(engine.calls.emptied).toEqual(["v-target"]);
        expect(engine.calls.created).toHaveLength(1);
    });

    it("creates a volume that does not exist yet instead of emptying it", async () => {
        const engine = useEngine(createFakeDockerEngine({ volumes: [], containers: [] }));

        const session = openDockerRestoreSession(config);
        await session.upload(sourceFile, "v-new/a.txt");
        await session.close();

        expect(engine.calls.order).toContain("createVolume:v-new");
        expect(engine.calls.emptied).toEqual([]);
    });

    it("prepares a volume once when two files arrive at the same moment", async () => {
        // The restore writes through a concurrency pool, so two files of one volume really
        // do start together. Preparing twice would empty the volume under the first write.
        const engine = useEngine(createFakeDockerEngine({
            volumes: ["v-target"],
            containers: [container("app", ["v-target"])],
        }));

        const session = openDockerRestoreSession(config);
        await Promise.all([
            session.upload(sourceFile, "v-target/a.txt"),
            session.upload(sourceFile, "v-target/b.txt"),
            session.upload(sourceFile, "v-target/c.txt"),
        ]);
        await session.close();

        expect(engine.calls.emptied).toEqual(["v-target"]);
        expect(engine.calls.stopped).toEqual(["app"]);
        expect(engine.calls.created).toHaveLength(1);
    });

    it("stops the target's containers and starts them again at the end", async () => {
        const engine = useEngine(createFakeDockerEngine({
            volumes: ["v-target"],
            containers: [container("app", ["v-target"])],
        }));

        const session = openDockerRestoreSession(config);
        await session.upload(sourceFile, "v-target/a.txt");
        expect(engine.calls.started).toEqual([]);

        await session.close();
        expect(engine.calls.started).toEqual(["app"]);
    });

    it("leaves a container that was already stopped alone", async () => {
        const engine = useEngine(createFakeDockerEngine({
            volumes: ["v-target"],
            containers: [container("app", ["v-target"], false)],
        }));

        const session = openDockerRestoreSession(config);
        await session.upload(sourceFile, "v-target/a.txt");
        await session.close();

        expect(engine.calls.stopped).toEqual([]);
        expect(engine.calls.started).toEqual([]);
    });

    it("checks the helper image before stopping anything", async () => {
        // A restore that was never going to work should say so while the target is still
        // running, not after its containers are down.
        const engine = useEngine(createFakeDockerEngine({
            volumes: ["v-target"],
            containers: [container("app", ["v-target"])],
            failOn: { ensureImage: new Error("no such image") },
        }));

        const session = openDockerRestoreSession(config);
        await expect(session.upload(sourceFile, "v-target/a.txt")).rejects.toThrow(/no such image/);

        expect(engine.calls.stopped).toEqual([]);
        await session.close();
    });

    it("starts the containers again when preparing fails after they went down", async () => {
        const engine = useEngine(createFakeDockerEngine({
            volumes: ["v-target"],
            containers: [container("app", ["v-target"])],
            failOn: { emptyVolume: new Error("device or resource busy") },
        }));

        const session = openDockerRestoreSession(config);
        await expect(session.upload(sourceFile, "v-target/a.txt")).rejects.toThrow(/device or resource busy/);

        expect(engine.calls.started).toEqual(["app"]);
        await session.close();
    });

    it("finishes each volume independently", async () => {
        // One helper that will not go away must not keep another volume's containers down.
        const engine = createFakeDockerEngine({
            volumes: ["v-a", "v-b"],
            containers: [container("app-a", ["v-a"]), container("app-b", ["v-b"])],
        });
        useEngine(engine);
        const session = openDockerRestoreSession(config);
        await session.upload(sourceFile, "v-a/x.txt");
        await session.upload(sourceFile, "v-b/x.txt");
        engine.removeMountContainer = async () => { throw new Error("busy"); };

        await session.close();

        expect(engine.calls.started.sort()).toEqual(["app-a", "app-b"]);
    });

    it("writes into the prepared helper, under the volume's mount path", async () => {
        const engine = useEngine(createFakeDockerEngine({ volumes: ["v-target"], containers: [] }));

        const session = openDockerRestoreSession(config);
        await session.upload(sourceFile, "v-target/sub/a.txt");
        await session.close();

        expect(engine.calls.created[0].volumes).toEqual(["v-target"]);
    });
});

describe("symbolic links", () => {
    it("are not offered at all, so the restore reports them as skipped rather than failed", async () => {
        // A link's target is a path inside whichever container mounts the volume later,
        // which is not where it was written - an absolute one means something else there,
        // and a relative one leaving the volume is refused by the daemon. Declaring the
        // capability and restoring only the ones that happen to work would leave a user
        // unable to tell which of their links survived.
        //
        // An adapter says it cannot store links by not implementing `createSymlink`, which
        // archive-restore.ts reads as a capability limit: one warning, counted as skipped.
        const { DockerVolumeAdapter } = await import("@/lib/adapters/storage/docker");

        expect(DockerVolumeAdapter.createSymlink).toBeUndefined();
    });
});
