/**
 * What the volume picker of the job form learns about a Docker host: every volume with the
 * containers that mount it, and the Compose project it belongs to.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDockerEngine, type FakeDockerEngine } from "@/lib/testing/fake-docker-engine";

const connectDocker = vi.fn();
vi.mock("@/lib/adapters/storage/docker/engine/connect", () => ({
    connectDocker: (config: unknown) => connectDocker(config),
}));

const { readVolumeInventory, readVolumeSizes } = await import("@/lib/adapters/storage/docker/inventory");
const { groupVolumes } = await import("@/lib/adapters/storage/docker/grouping");

const ANONYMOUS = "01289f2274c9bcd81e8d6363fa60823566b01f5ebc1bd0a9bb93914ef3a84aaf";
const compose = (project: string) => ({ "com.docker.compose.project": project });

function useEngine(engine: FakeDockerEngine) {
    connectDocker.mockImplementation(() => ({ engine, close: async () => engine.close() }));
    return engine;
}

describe("the volumes of a Docker host for the job form", () => {
    beforeEach(() => {
        connectDocker.mockReset();
    });

    it("gives every volume the containers that mount it, whether they run, their image and where they mount it", async () => {
        useEngine(createFakeDockerEngine({
            volumes: ["nextcloud_html", "nextcloud_db"],
            volumeDetails: { nextcloud_html: { labels: compose("nextcloud"), createdAt: "2024-09-01T10:00:00Z" }, nextcloud_db: { labels: compose("nextcloud") } },
            containers: [
                { id: "c2", name: "nextcloud-cron-1", running: false, volumes: ["nextcloud_html"], image: "nextcloud:29-apache", mountPaths: { nextcloud_html: "/var/www/html" } },
                { id: "c1", name: "nextcloud-app-1", running: true, volumes: ["nextcloud_html"], image: "nextcloud:29-apache", mountPaths: { nextcloud_html: "/var/www/html" }, binds: ["/var/www/html/data"] },
                { id: "c3", name: "nextcloud-db-1", running: true, volumes: ["nextcloud_db"], image: "mariadb:11.4", mountPaths: { nextcloud_db: "/var/lib/mysql" } },
            ],
        }));

        const [db, html] = await readVolumeInventory({});

        expect(html).toEqual({
            name: "nextcloud_html",
            anonymous: false,
            stack: "nextcloud",
            createdAt: "2024-09-01T10:00:00Z",
            users: [
                { container: "nextcloud-app-1", running: true, image: "nextcloud:29-apache", mount: "/var/www/html" },
                { container: "nextcloud-cron-1", running: false, image: "nextcloud:29-apache", mount: "/var/www/html" },
            ],
        });
        expect(db).toMatchObject({ name: "nextcloud_db", createdAt: null, users: [{ container: "nextcloud-db-1", mount: "/var/lib/mysql" }] });
    });

    it("tells an anonymous volume by its name, and puts one into the project of the only project that mounts it", async () => {
        useEngine(createFakeDockerEngine({
            volumes: [ANONYMOUS, "shared_media", "old_postgres_data"],
            containers: [
                { id: "c1", name: "immich_redis", running: true, volumes: [ANONYMOUS], labels: compose("immich") },
                { id: "c2", name: "immich_server", running: true, volumes: ["shared_media"], labels: compose("immich") },
                { id: "c3", name: "jellyfin", running: true, volumes: ["shared_media"], labels: compose("media") },
            ],
        }));

        const byName = new Map((await readVolumeInventory({})).map((volume) => [volume.name, volume]));

        expect(byName.get(ANONYMOUS)).toMatchObject({ anonymous: true, stack: "immich" });
        // Mounted by two projects, so it belongs to neither.
        expect(byName.get("shared_media")).toMatchObject({ anonymous: false, stack: null });
        expect(byName.get("old_postgres_data")).toMatchObject({ stack: null, users: [] });
    });

    it("says why the daemon could not be reached instead of an empty list", async () => {
        useEngine(createFakeDockerEngine({ failOn: { listVolumes: Object.assign(new Error("connect ENOENT /var/run/docker.sock"), { code: "ENOENT" }) } }));

        await expect(readVolumeInventory({})).rejects.toThrow("The Docker socket was not found");
    });

    it("measures the volumes apart from the list", async () => {
        const engine = useEngine(createFakeDockerEngine({ volumes: ["a", "b"], sizes: { a: 2048, b: 0 } }));

        expect(await readVolumeSizes({})).toEqual({ a: 2048, b: 0 });
        expect(engine.calls.closed).toBe(1);
    });
});

describe("grouping volumes from what is known about them", () => {
    it("groups like the run does, so the picker shows what a run will stop", () => {
        const users: Record<string, string[]> = { html: ["app", "cron"], db: ["db"], config: ["cron"], orphan: [] };

        expect(groupVolumes(["db", "html", "orphan", "config"], (volume) => users[volume])).toEqual([["db"], ["html", "config"], ["orphan"]]);
    });
});
