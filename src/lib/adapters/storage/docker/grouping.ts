/**
 * Which volumes have to be prepared together.
 *
 * Backing up a volume means stopping the containers that hold it. Two volumes of the same
 * container must stop it once rather than twice, and a container whose volumes are done
 * should start again immediately rather than waiting out the rest of the job. Both fall out
 * of one observation: volumes and containers form a bipartite graph, and its connected
 * components are exactly the groups.
 *
 * That is not a preference among several workable answers. It is the only partition that
 * holds both promises at once:
 *
 *  - Two volumes of one container in different groups would stop it twice.
 *  - Two components share no container by construction, so nothing finer exists that avoids
 *    a double stop.
 *
 * A volume on two containers pulls both in, and with them every other volume either of them
 * holds - which is the answer to "what if a volume is shared", arrived at rather than added.
 */

import type { DockerEngine } from "./engine/types";

/** Volume names grouped so that no container appears in two groups. */
export async function planVolumeGroups(
    engine: DockerEngine,
    volumes: readonly string[]
): Promise<string[][]> {
    const users = new Map<string, string[]>();
    for (const volume of volumes) {
        users.set(volume, (await engine.containersUsingVolume(volume)).map((container) => container.id));
    }
    return groupVolumes(volumes, (volume) => users.get(volume) ?? []);
}

/**
 * The same partition from what is already known about each volume, without asking the daemon.
 * The volume picker of the job form uses it to show what a run will stop, so the two can never
 * disagree. Containers only have to be told apart, by id or by name.
 */
export function groupVolumes(
    volumes: readonly string[],
    containersOf: (volume: string) => readonly string[]
): string[][] {
    const parent = new Map<string, string>();

    const find = (key: string): string => {
        let root = parent.get(key) ?? key;
        while (root !== (parent.get(root) ?? root)) root = parent.get(root) ?? root;
        // Path compression, so a long chain does not make later lookups walk it again.
        let cursor = key;
        while (cursor !== root) {
            const next = parent.get(cursor) ?? cursor;
            parent.set(cursor, root);
            cursor = next;
        }
        return root;
    };

    const union = (a: string, b: string) => {
        const rootA = find(a);
        const rootB = find(b);
        if (rootA !== rootB) parent.set(rootB, rootA);
    };

    // Prefixed because a volume and a container can share a name, and merging them by
    // accident would silently glue two unrelated groups together.
    const volumeKey = (name: string) => `v:${name}`;
    const containerKey = (id: string) => `c:${id}`;

    for (const volume of volumes) {
        parent.set(volumeKey(volume), volumeKey(volume));
        for (const container of containersOf(volume)) {
            union(volumeKey(volume), containerKey(container));
        }
    }

    // Built in input order so a group lands where its earliest volume was, and the ordering
    // the user gave the job survives as far as the grouping allows.
    const byRoot = new Map<string, string[]>();
    for (const volume of volumes) {
        const root = find(volumeKey(volume));
        const existing = byRoot.get(root);
        if (existing) existing.push(volume);
        else byRoot.set(root, [volume]);
    }

    return [...byRoot.values()];
}
