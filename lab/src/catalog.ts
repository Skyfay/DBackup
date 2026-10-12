/**
 * Every service of the dev lab with its port and its test credentials. The database services come
 * from the engine files under lab/src/engines. The Compose files under lab/compose define the same
 * services, and `tests/unit/lab/lab-parts.test.ts` checks that both agree.
 */

import { ENGINES, engineOf } from "./engines";
import type { Engine } from "./engines/types";

export type { Engine } from "./engines/types";

export interface DatabaseService {
    /** The Compose service, also its host name inside the lab network. */
    service: string;
    engine: Engine;
    /** The version as the connection name shows it. */
    version: string;
    port: number;
    profile: "core" | "full";
}

export const DATABASES: DatabaseService[] = ENGINES.flatMap((spec) => spec.versions.map((entry) => ({ ...entry, engine: spec.id })));

export const STORAGE = {
    ssh: { service: "ssh", port: 22220, username: "dbackup", password: "dbackup-password", home: "/home/dbackup" },
    s3: { service: "s3", port: 19000, accessKey: "lab", secretKey: "lab-password", bucket: "dbackup-lab" },
    webdav: { service: "webdav", port: 18080, username: "lab", password: "lab-password" },
    samba: { service: "samba", port: 445, share: "backups", username: "lab", password: "lab-password" },
    ftp: { service: "ftp", port: 2121, username: "lab", password: "lab-password", home: "/ftp/lab" },
} as const;

/** The customer server of the end-to-end tests, lab/compose/customer, with one login for OpenSSH and every database. */
export const CUSTOMER = { service: "customer", username: "dbackup", password: "customer-password" } as const;

export const NOTIFY = {
    mailpit: { service: "mailpit", smtpPort: 1025, uiPort: 8025 },
    ntfy: { service: "ntfy", port: 18081 },
    gotify: { service: "gotify", port: 18082, username: "lab", password: "lab-password" },
    webhook: { service: "webhook", port: 18083 },
} as const;

/** The name of the source of a database service, like "Lab PostgreSQL 18". */
export function sourceName(database: DatabaseService, suffix = ""): string {
    return `Lab ${engineOf(database.engine).name} ${database.version}${suffix}`;
}

/** The services a profile starts. */
export function databasesOf(profile: "core" | "full"): DatabaseService[] {
    return profile === "full" ? DATABASES : DATABASES.filter((database) => database.profile === "core");
}
