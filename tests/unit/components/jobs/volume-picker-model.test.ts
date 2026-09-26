import { describe, expect, it } from "vitest";
import type { DockerVolumeEntry } from "@/lib/adapters/storage/docker/inventory";
import { groupText, matchesVolume, planGroups, planSummary, sectionMeta, volumeSections } from "@/components/dashboard/jobs/volume-picker-model";

const ANONYMOUS = "01289f2274c9bcd81e8d6363fa60823566b01f5ebc1bd0a9bb93914ef3a84aaf";
const user = (container: string, mount: string, running = true, image = "postgres:16") => ({ container, running, image, mount });
const volume = (name: string, stack: string | null, users: DockerVolumeEntry["users"]): DockerVolumeEntry => ({
    name, anonymous: name.length === 64, stack, createdAt: null, users,
});

const VOLUMES = [
    volume("paperless_media", "paperless", [user("paperless-webserver-1", "/usr/src/paperless/media", true, "paperless-ngx:2.12")]),
    volume(ANONYMOUS, "immich", [user("immich_redis", "/data", true, "redis:7")]),
    volume("immich_pgdata", "immich", [user("immich_postgres", "/var/lib/postgresql/data")]),
    volume("wiki_db", "wiki", [user("wiki-db-1", "/var/lib/postgresql/data", false)]),
    volume("portainer_data", null, [user("portainer", "/data", true, "portainer/portainer-ce:2.21")]),
    volume("3d962f26bbf9fc06a0f7aa935cbb084626c2aaf77252a0b553cddcda30581990", null, [user("grafana", "/var/lib/grafana", true, "grafana/grafana:11.2")]),
    volume("old_postgres_data", null, []),
    volume("nextcloud_html", "nextcloud", [user("nextcloud-app-1", "/var/www/html", true, "nextcloud:29"), user("nextcloud-cron-1", "/var/www/html", true, "nextcloud:29")]),
    volume("nextcloud_config", "nextcloud", [user("nextcloud-cron-1", "/config", true, "nextcloud:29")]),
    volume("nextcloud_db", "nextcloud", [user("nextcloud-db-1", "/var/lib/mysql", true, "mariadb:11.4")]),
];
const byName = new Map(VOLUMES.map((entry) => [entry.name, entry]));

describe("the parts of the volume list", () => {
    it("puts the gone volumes first, then each stack, the named ones of none, the anonymous ones, and the ones not in use last", () => {
        const sections = volumeSections(VOLUMES, ["gone_volume"]);

        expect(sections.map((section) => section.title)).toEqual(["No longer on this host", "immich", "nextcloud", "paperless", "wiki", "No stack", "Anonymous", "Not in use"]);
        // The named volumes of a stack before its anonymous ones.
        expect(sections[1].volumes.map((entry) => entry.name)).toEqual(["immich_pgdata", ANONYMOUS]);
    });

    it("says what a part holds, and how much of it a filter found", () => {
        const [, immich, nextcloud, , wiki, plain, anonymous, unused] = volumeSections(VOLUMES, ["gone_volume"]);

        expect(sectionMeta(immich, 2)).toBe("Compose · 2 volumes · 2 containers running");
        expect(sectionMeta(nextcloud, 3)).toBe("Compose · 3 volumes · 3 containers running");
        expect(sectionMeta(wiki, 1)).toBe("Compose · 1 volume · 1 container stopped");
        expect(sectionMeta(plain, 1)).toBe("1 volume · 1 container running");
        expect(sectionMeta(anonymous, 1)).toBe("1 volume · named by Docker, shown by the container that mounts it");
        expect(sectionMeta(unused, 1)).toBe("1 volume · no container mounts it");
        expect(sectionMeta(nextcloud, 1)).toBe("1 of 3 match");
    });

    it("finds a volume by its name, its stack, and the container, image or path that mounts it", () => {
        const found = (term: string) => VOLUMES.filter((entry) => matchesVolume(entry, term)).map((entry) => entry.name);

        expect(found("POSTGRES")).toEqual(["immich_pgdata", "wiki_db", "old_postgres_data"]);
        expect(found("grafana/")).toEqual(["3d962f26bbf9fc06a0f7aa935cbb084626c2aaf77252a0b553cddcda30581990"]);
        expect(found("paperless")).toEqual(["paperless_media"]);
        expect(found(" ")).toHaveLength(VOLUMES.length);
    });
});

describe("what the job reads", () => {
    it("reads the volumes of shared containers under one stop, where the earliest of them stands, and a volume read live on its own", () => {
        const groups = planGroups(
            [
                { name: "immich_pgdata", isNew: false, stops: true },
                { name: "nextcloud_config", isNew: true, stops: true },
                { name: "portainer_data", isNew: true, stops: false },
                { name: "nextcloud_html", isNew: true, stops: true },
            ],
            (name) => byName.get(name),
        );

        expect(groups.map((group) => group.volumes.map((entry) => entry.name))).toEqual([["immich_pgdata"], ["nextcloud_config", "nextcloud_html"], ["portainer_data"]]);
        expect(groups.map(groupText)).toEqual(["Stops immich_postgres", "Stops nextcloud-cron-1 and nextcloud-app-1", "Read while in use, nothing stops"]);
        expect(planSummary(groups, () => 1024 ** 3, () => "3 GB")).toBe("4 volumes · 3 GB · 3 running containers stop, one group at a time");
    });

    it("says which containers are stopped anyway, and leaves the size out while one is missing", () => {
        const groups = planGroups(
            [
                { name: "wiki_db", isNew: true, stops: true },
                { name: "old_postgres_data", isNew: true, stops: true },
            ],
            (name) => byName.get(name),
        );

        expect(groups.map(groupText)).toEqual(["wiki-db-1 is stopped and stays stopped", "No container mounts it"]);
        expect(planSummary(groups, (name) => (name === "wiki_db" ? 88 : undefined), String)).toBe("2 volumes · no container stops");
    });
});
