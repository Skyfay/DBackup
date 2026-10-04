/**
 * The volume picker of the job form as plain data: which part of the list a volume goes into,
 * what the filter finds, and what the job reads in which order with what it stops.
 */
import { groupVolumes } from "@/lib/adapters/storage/docker/grouping";
import type { DockerVolumeEntry, DockerVolumeUser } from "@/lib/adapters/storage/docker/inventory";

export type VolumeSectionKind = "missing" | "stack" | "plain" | "anonymous" | "unused";

export interface VolumeSection {
    key: string;
    kind: VolumeSectionKind;
    title: string;
    volumes: DockerVolumeEntry[];
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** Joins names like a sentence does: "a", "a and b", "a, b and c". */
export function listOf(names: string[]): string {
    return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** A 64 character name of an anonymous volume, cut to its ends. */
export function shortName(volume: Pick<DockerVolumeEntry, "name" | "anonymous">): string {
    return volume.anonymous ? `${volume.name.slice(0, 12)}…${volume.name.slice(-7)}` : volume.name;
}

/**
 * The parts of the list. The volumes of the job the host no longer has come first, so they can be
 * unticked. Then each Compose project, the named volumes of none, the anonymous ones, and last the
 * ones no container mounts, which only show when asked for.
 */
export function volumeSections(volumes: DockerVolumeEntry[], missing: string[]): VolumeSection[] {
    const stacks = new Map<string, DockerVolumeEntry[]>();
    const plain: DockerVolumeEntry[] = [];
    const anonymous: DockerVolumeEntry[] = [];
    const unused: DockerVolumeEntry[] = [];
    for (const volume of volumes) {
        if (volume.stack) stacks.set(volume.stack, [...(stacks.get(volume.stack) ?? []), volume]);
        else if (volume.users.length === 0) unused.push(volume);
        else if (volume.anonymous) anonymous.push(volume);
        else plain.push(volume);
    }

    const sections: VolumeSection[] = [];
    if (missing.length > 0) {
        const gone = missing.map((name) => ({ name, anonymous: /^[0-9a-f]{64}$/.test(name), stack: null, createdAt: null, users: [] }));
        sections.push({ key: "missing", kind: "missing", title: "No longer on this host", volumes: gone });
    }
    for (const [stack, list] of [...stacks].sort(([a], [b]) => a.localeCompare(b))) {
        // The named volumes of a project first, its anonymous ones after them.
        const ordered = [...list].sort((a, b) => Number(a.anonymous) - Number(b.anonymous) || a.name.localeCompare(b.name));
        sections.push({ key: `stack:${stack}`, kind: "stack", title: stack, volumes: ordered });
    }
    if (plain.length > 0) sections.push({ key: "plain", kind: "plain", title: "No stack", volumes: plain });
    if (anonymous.length > 0) sections.push({ key: "anonymous", kind: "anonymous", title: "Anonymous", volumes: anonymous });
    if (unused.length > 0) sections.push({ key: "unused", kind: "unused", title: "Not in use", volumes: unused });
    return sections;
}

/** Whether the filter finds a volume by its name, its project, or a container, image or path that mounts it. */
export function matchesVolume(volume: DockerVolumeEntry, term: string): boolean {
    const query = term.trim().toLowerCase();
    if (!query) return true;
    const texts = [volume.name, volume.stack ?? "", ...volume.users.flatMap((user) => [user.container, user.image, user.mount])];
    return texts.some((text) => text.toLowerCase().includes(query));
}

/** Every container of the users, once, with whether it runs. */
function containersOf(users: DockerVolumeUser[]): { running: string[]; stopped: string[] } {
    const running = new Set<string>();
    const stopped = new Set<string>();
    for (const user of users) (user.running ? running : stopped).add(user.container);
    return { running: [...running], stopped: [...stopped].filter((name) => !running.has(name)) };
}

/** What a part of the list holds, next to its title. */
export function sectionMeta(section: VolumeSection, shown: number): string {
    const total = section.volumes.length;
    if (shown < total) return `${shown} of ${total} match`;
    const volumes = plural(total, "volume");
    if (section.kind === "missing") return `${volumes} of the job`;
    if (section.kind === "unused") return `${volumes} · no container mounts ${total === 1 ? "it" : "them"}`;
    if (section.kind === "anonymous") return `${volumes} · named by Docker, shown by the container that mounts ${total === 1 ? "it" : "them"}`;

    const { running, stopped } = containersOf(section.volumes.flatMap((volume) => volume.users));
    const count = running.length + stopped.length;
    const state =
        count === 0 ? "no container mounts them"
        : stopped.length === 0 ? `${plural(count, "container")} running`
        : running.length === 0 ? `${plural(count, "container")} stopped`
        : `${running.length} of ${plural(count, "container")} running`;
    return section.kind === "stack" ? `Compose · ${volumes} · ${state}` : `${volumes} · ${state}`;
}

/** A picked volume, whether the job has it already, and whether its containers stop while it is read. */
export interface PlanEntry {
    name: string;
    isNew: boolean;
    stops: boolean;
}

/** One step of the run: volumes read under one stop of their containers, or one volume read while in use. */
export interface PlanGroup {
    volumes: { name: string; anonymous: boolean; isNew: boolean }[];
    /** Its containers keep running while it is read. */
    live: boolean;
    running: string[];
    stopped: string[];
}

/**
 * What the job reads in which order, as the run plans it: the volumes whose containers stop are
 * grouped by the containers they share, each group where its earliest volume stands, and a volume
 * read while in use is a step of its own. See `planCollectionGroups` in the runner.
 */
export function planGroups(entries: PlanEntry[], volumeOf: (name: string) => DockerVolumeEntry | undefined): PlanGroup[] {
    const position = new Map(entries.map((entry, index) => [entry.name, index]));
    const isNew = new Map(entries.map((entry) => [entry.name, entry.isNew]));
    const usersOf = (name: string) => volumeOf(name)?.users ?? [];
    const step = (names: string[], live: boolean) => ({
        at: Math.min(...names.map((name) => position.get(name) ?? 0)),
        group: {
            volumes: names.map((name) => ({ name, anonymous: volumeOf(name)?.anonymous ?? false, isNew: isNew.get(name) ?? false })),
            live,
            ...containersOf(names.flatMap(usersOf)),
        },
    });

    const stopping = entries.filter((entry) => entry.stops).map((entry) => entry.name);
    const steps = [
        ...groupVolumes(stopping, (name) => usersOf(name).map((user) => user.container)).map((names) => step(names, false)),
        ...entries.filter((entry) => !entry.stops).map((entry) => step([entry.name], true)),
    ];
    return steps.sort((a, b) => a.at - b.at).map((entry) => entry.group);
}

/** What a step of the run does to the containers. */
export function groupText(group: PlanGroup): string {
    const { running, stopped } = group;
    if (running.length === 0 && stopped.length === 0) return group.volumes.length === 1 ? "No container mounts it" : "No container mounts them";
    if (group.live) return running.length > 0 ? "Read while in use, nothing stops" : "Read as it is, no container runs";
    const parts: string[] = [];
    if (running.length > 0) parts.push(`Stops ${listOf(running)}`);
    if (stopped.length > 0) parts.push(`${listOf(stopped)} ${stopped.length === 1 ? "is stopped and stays" : "are stopped and stay"} stopped`);
    return parts.join(". ");
}

/** The whole run in a line: how many volumes, how big together, and how many containers stop. */
export function planSummary(groups: PlanGroup[], sizeOf: (name: string) => number | undefined, formatSize: (bytes: number) => string): string {
    const volumes = groups.flatMap((group) => group.volumes);
    const sizes = volumes.map((volume) => sizeOf(volume.name));
    const stopping = groups.filter((group) => !group.live).flatMap((group) => group.running);
    const steps = groups.filter((group) => !group.live && group.running.length > 0).length;
    const parts = [plural(volumes.length, "volume")];
    if (sizes.every((size) => size !== undefined)) parts.push(formatSize(sizes.reduce<number>((sum, size) => sum + (size ?? 0), 0)));
    if (stopping.length === 0) parts.push("no container stops");
    else parts.push(`${plural(stopping.length, "running container")} ${stopping.length === 1 ? "stops" : "stop"}${steps > 1 ? ", one group at a time" : ""}`);
    return parts.join(" · ");
}
