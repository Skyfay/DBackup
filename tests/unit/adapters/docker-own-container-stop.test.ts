/**
 * No run stops the container DBackup runs in. Its stop ends the run before anything starts again,
 * and Docker does not bring back a container stopped through its API, so DBackup stayed down for
 * every tenant once a job named a volume its own container mounts outside its data folders, like a
 * folder for backups or the socket bridge of the documented setup.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDockerEngine, type FakeContainer, type FakeDockerEngine } from "@/lib/testing/fake-docker-engine";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const hints = vi.hoisted(() => ({ value: { inContainer: true, ids: [] as string[], hostname: "dbackup" } }));

const connectDocker = vi.fn();
vi.mock("@/lib/adapters/storage/docker/engine/connect", () => ({
    connectDocker: (config: unknown) => connectDocker(config),
    DEFAULT_SOCKET_PATH: "/var/run/docker.sock",
}));
vi.mock("@/lib/adapters/storage/docker/own-container", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/adapters/storage/docker/own-container")>()),
    ownContainerHints: async () => hints.value,
}));
vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const { createDockerSnapshot } = await import("@/lib/adapters/storage/docker/snapshot");
const { openDockerRestoreSession } = await import("@/lib/adapters/storage/docker/restore-session");

const OWN = "a".repeat(64);
const SOCKET = "b".repeat(64);
const direct = { connectionMode: "direct", helperImage: "alpine:3" };
const containers = (): FakeContainer[] => [
    { id: OWN, name: "dbackup", running: true, volumes: ["dbackup-data", "dbackup-backups", "socket-bridge"], mountPaths: { "dbackup-data": "/data", "dbackup-backups": "/backups", "socket-bridge": "/shared" } },
    { id: SOCKET, name: "docker-socket", running: true, volumes: ["socket-bridge"] },
    { id: "web", name: "web", running: true, volumes: ["web-data"] },
];

function useEngine(engine: FakeDockerEngine) {
    connectDocker.mockImplementation(() => ({ engine, close: async () => { await engine.close(); } }));
    return engine;
}

beforeEach(() => {
    vi.clearAllMocks();
    hints.value = { inContainer: true, ids: [OWN], hostname: "dbackup" };
});

describe("a backup of a volume DBackup's own container holds", () => {
    it.each(["dbackup-backups", "socket-bridge"])("refuses %s and stops no container of the group", async (volume) => {
        const engine = useEngine(createFakeDockerEngine({ volumes: [volume], containers: containers() }));

        await expect(createDockerSnapshot(direct, [volume], { stopContainers: true })).rejects.toThrow("a run never stops the container DBackup runs in");
        expect(engine.calls.stopped).toEqual([]);
        expect(engine.calls.created).toEqual([]);
    });

    it("reads it while it runs when the source is set not to stop containers", async () => {
        const engine = useEngine(createFakeDockerEngine({ volumes: ["dbackup-backups"], containers: containers() }));

        await createDockerSnapshot(direct, ["dbackup-backups"], { stopContainers: false });

        expect(engine.calls.stopped).toEqual([]);
        expect(engine.calls.created).toHaveLength(1);
    });

    it("still stops the containers of a volume DBackup's own container does not hold", async () => {
        const engine = useEngine(createFakeDockerEngine({ volumes: ["web-data"], containers: containers() }));

        await createDockerSnapshot(direct, ["web-data"], { stopContainers: true });

        expect(engine.calls.stopped).toEqual(["web"]);
    });

    it("stops nothing when DBackup runs in a container this Docker host does not list", async () => {
        hints.value = { inContainer: true, ids: ["c".repeat(64)], hostname: "elsewhere" };
        const engine = useEngine(createFakeDockerEngine({ volumes: ["web-data"], containers: containers() }));

        await expect(createDockerSnapshot(direct, ["web-data"], { stopContainers: true })).rejects.toThrow("runs in a container this Docker host does not list");
        expect(engine.calls.stopped).toEqual([]);
    });

    it("stops as before over SSH, which reaches another server", async () => {
        const engine = useEngine(createFakeDockerEngine({ volumes: ["socket-bridge"], containers: containers() }));

        await createDockerSnapshot({ connectionMode: "ssh", host: "docker.internal" }, ["socket-bridge"], { stopContainers: true });

        expect(engine.calls.stopped).toEqual([OWN, SOCKET]);
    });
});

describe("a restore into a volume DBackup's own container holds", () => {
    it("is refused before anything is stopped or emptied", async () => {
        const engine = useEngine(createFakeDockerEngine({ volumes: ["dbackup-backups"], containers: containers() }));
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dbackup-own-stop-"));
        const file = path.join(dir, "payload.txt");
        await fs.writeFile(file, "content\n");
        const session = openDockerRestoreSession(direct);

        await expect(session.upload(file, "dbackup-backups/payload.txt")).rejects.toThrow("Restore into another volume");
        await session.close();

        expect(engine.calls.stopped).toEqual([]);
        expect(engine.calls.emptied).toEqual([]);
        await fs.rm(dir, { recursive: true, force: true });
    });
});
