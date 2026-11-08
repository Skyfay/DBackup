/**
 * The connections of the dev lab: the sources, the destinations with a folder of this workspace
 * each, and the notification channels. Each is found by its name and brought up to date, so the
 * seed can run as often as it likes.
 */

import type { LabConfig } from "../config";
import { seedChannels, seedDestinations } from "./destinations";
import { ensureConnection } from "./records";
import { seedSources, type Note } from "./sources";

export interface SeededConnections {
    sources: Map<string, string>;
    destinations: Map<string, string>;
    channels: Map<string, string>;
    log: string[];
}

export async function seedConnections(config: LabConfig, workspace: string): Promise<SeededConnections> {
    const seeded: SeededConnections = { sources: new Map(), destinations: new Map(), channels: new Map(), log: [] };
    const into = (map: Map<string, string>): Note => async (spec, key) => {
        const result = await ensureConnection(spec);
        map.set(key, result.id);
        seeded.log.push(`${result.created ? "created" : "updated"} ${spec.type} ${spec.name}`);
    };

    await seedSources(config, into(seeded.sources), seeded.log);
    await seedDestinations(config, workspace, into(seeded.destinations), seeded.log);
    await seedChannels(config, workspace, into(seeded.channels), seeded.log);
    return seeded;
}
