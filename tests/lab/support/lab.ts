/**
 * What the tests know about the lab: the connections the global setup made, and for each source
 * where its databases live, so a test can read what a restore wrote.
 */

import path from "path";
import { inject } from "vitest";
import { loadConfig, type Host } from "../../../lab/src/config";
import { FIREBIRD_DATABASE, STORAGE, databasesOf, type Engine } from "../../../lab/src/catalog";
import type { Place } from "./places";

/** The ids of the connections the global setup seeded, by the keys of the seed. */
export interface LabState {
    workspace: string;
    sources: Record<string, string>;
    destinations: Record<string, string>;
    channels: Record<string, string>;
}

declare module "vitest" {
    export interface ProvidedContext {
        lab: LabState;
    }
}

export const lab = inject("lab");
export const config = loadConfig();

export type SourceEngine = Engine | "sqlite";

/** A source of the lab with a database the tests back up. */
export interface LabSource {
    /** The key of the seed, like `postgres-18` or `postgres-12-ssh`. */
    key: string;
    engine: SourceEngine;
    /** Where the database lives, for reading it from outside of DBackup. */
    place: Place;
    /** The database of the dataset, as the archive names it. */
    database: string;
    /** Where the tools of the engine find that database: its name, or a path for Firebird and SQLite. */
    location: string;
    /** A restore of it under another name: the name the restore gets, and where the tools of the engine find it then. */
    restoreAs: (suffix: string) => { name: string; location: string };
}

const sameName = (suffix: string) => ({ name: `shop_${suffix}`, location: `shop_${suffix}` });

function containerSource(key: string, engine: Engine, service: string): LabSource {
    const place: Place = { kind: "service", group: "databases", service };
    if (engine === "firebird") {
        const folder = path.posix.dirname(FIREBIRD_DATABASE.path);
        // The target of a Firebird restore is the path of the new file on the server.
        const restoreAs = (suffix: string) => ({ name: `${folder}/shop_${suffix}.fdb`, location: `${folder}/shop_${suffix}.fdb` });
        return { key, engine, place, database: FIREBIRD_DATABASE.name, location: FIREBIRD_DATABASE.path, restoreAs };
    }
    return { key, engine, place, database: "shop", location: "shop", restoreAs: sameName };
}

function sqliteSource(key: string, place: Place, file: string): LabSource {
    const folder = path.posix.dirname(file);
    // A SQLite restore takes a file name and writes it next to the database of the source.
    const restoreAs = (suffix: string) => ({ name: `shop_${suffix}.db`, location: `${folder}/shop_${suffix}.db` });
    return { key, engine: "sqlite", place, database: path.posix.basename(file), location: file, restoreAs };
}

function nativeSources(host: Host): LabSource[] {
    const place: Place = { kind: "host", host };
    const sources: LabSource[] = (["postgres", "mysql", "mongodb", "redis"] as const).map((engine) => ({
        key: `${host.name}-${engine}`, engine, place, database: "shop", location: "shop", restoreAs: sameName,
    }));
    return [...sources, sqliteSource(`${host.name}-sqlite`, place, `/home/${host.native!.ssh.user}/shop.db`)];
}

/** Every database source the seed made, in the order of the catalog. */
export function labSources(): LabSource[] {
    const databases = databasesOf(config.profile);
    const all: LabSource[] = [
        ...databases.map((database) => containerSource(database.service, database.engine, database.service)),
        // The SSH twins reach the same containers through the SSH host.
        ...databases.map((database) => containerSource(`${database.service}-ssh`, database.engine, database.service)),
        ...Object.values(config.hosts).filter((host) => host.native).flatMap(nativeSources),
        sqliteSource("sqlite", { kind: "local" }, path.join(config.storageRoot, "lab", "sqlite", "shop.db")),
        sqliteSource("sqlite-ssh", { kind: "service", group: "storage", service: STORAGE.ssh.service }, `${STORAGE.ssh.home}/shop.db`),
    ];
    return all.filter((source) => lab.sources[source.key]);
}

/** Redis and Valkey restore by hand, so their backups are only checked to be complete. */
export const restoresItself = (source: LabSource) => source.engine !== "redis" && source.engine !== "valkey";
