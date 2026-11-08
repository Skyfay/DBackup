import fs from "fs/promises";
import os from "os";
import type { ContainerDetail } from "./engine/types";

/**
 * Which container of a Docker host DBackup itself runs in, so a job never reads the volume that
 * holds DBackup's own database through Docker Volumes without SSH, see `ownVolumeRefusal` in
 * `own-data.ts`.
 *
 * Docker and Podman lay `/etc/hostname`, `/etc/hosts` and `/etc/resolv.conf` into a container from
 * a folder named after the full id of the container, `.../containers/<id>/` or
 * `.../overlay-containers/<id>/userdata/`, which `/proc/self/mountinfo` shows with cgroup v1 and v2
 * alike. `/proc/self/cgroup` names the id as well under cgroup v1 and on some hosts with v2. The
 * hostname is the first twelve characters of the id unless the container sets its own. A process
 * outside of any container finds none of them and no marker file.
 */

/** What this process knows of the container it may run in. */
export interface OwnContainerHints {
    /** Whether anything says this process runs in a container. */
    inContainer: boolean;
    /** Full container ids found in the files of the process. */
    ids: string[];
    /** The hostname, which Docker sets to the short id unless told otherwise. */
    hostname: string;
}

const FULL_ID = /(?:^|[/_-])([0-9a-f]{64})(?=$|[/.])/g;
const SHORT_ID = /^[0-9a-f]{12,64}$/;

async function readOrEmpty(file: string): Promise<string> {
    return fs.readFile(file, "utf8").catch(() => "");
}

async function exists(file: string): Promise<boolean> {
    return fs.access(file).then(() => true, () => false);
}

/** The ids a text names, from the paths of mounts or the lines of cgroups. */
export function containerIdsIn(text: string): string[] {
    const ids = new Set<string>();
    for (const line of text.split("\n")) {
        for (const part of line.split(/\s+/)) {
            if (!/containers?|docker|libpod|crio|cri-containerd/.test(part)) continue;
            for (const match of part.matchAll(FULL_ID)) ids.add(match[1]);
        }
    }
    return [...ids];
}

/** Reads what this process knows of its own container. */
export async function ownContainerHints(): Promise<OwnContainerHints> {
    const [mountinfo, cgroup] = await Promise.all([readOrEmpty("/proc/self/mountinfo"), readOrEmpty("/proc/self/cgroup")]);
    const ids = [...new Set([...containerIdsIn(mountinfo), ...containerIdsIn(cgroup)])];
    const marker = (await exists("/.dockerenv")) || (await exists("/run/.containerenv"));
    return { inContainer: ids.length > 0 || marker, ids, hostname: os.hostname() };
}

/**
 * The container of the list DBackup runs in, by its full id, or by the short id Docker gives as
 * the hostname. Never by name, since a name says nothing about which process runs inside.
 */
export function findOwnContainer(containers: readonly ContainerDetail[], hints: OwnContainerHints): ContainerDetail | null {
    for (const id of hints.ids) {
        const found = containers.find((container) => container.id === id);
        if (found) return found;
    }
    const hostname = hints.hostname.toLowerCase();
    if (SHORT_ID.test(hostname)) {
        const matches = containers.filter((container) => container.id.startsWith(hostname));
        if (matches.length === 1) return matches[0];
    }
    return null;
}
