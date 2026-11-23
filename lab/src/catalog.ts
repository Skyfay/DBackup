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

/**
 * The identity provider of the SSO tests, Dex in lab/compose/e2e.yml, with one static client and
 * people with a password. It listens on the same port inside and outside, since DBackup and the
 * browser both reach it by its service name. Every attempt of a test gets a provider ID and people
 * of its own, `attempts` of them, see `dexPerson`. `tests/unit/lab/lab-parts.test.ts` checks the
 * Compose file against this.
 */
export const DEX = {
    service: "dex",
    port: 5556,
    issuer: "http://dex:5556/dex",
    clientId: "dbackup-e2e",
    clientSecret: "dex-client-e2e-only-not-a-secret",
    password: "Dex-Lantern-6042",
    attempts: 2,
} as const;

/** A person of Dex for one attempt: a newcomer without an account in DBackup, or a member who has one. */
export function dexPerson(kind: "newcomer" | "member", attempt: number): { name: string; email: string } {
    const name = `${kind}-${attempt % DEX.attempts}`;
    return { name, email: `${name}@sso.e2e.dbackup.test` };
}

/** The provider ID of the SSO tests for one attempt, the end of a redirect URI of the client. */
export const dexProviderId = (attempt: number): string => `dex-${attempt % DEX.attempts}`;

/**
 * The domain the provider of a tenant claims in the SSO test of a tenant that blocks the local
 * network. Apart from the people of `dexPerson`, since the provider of the platform adds nobody of
 * a domain a tenant claims.
 */
export const DEX_TENANT_DOMAIN = "tenant.e2e.dbackup.test";

/** The person of Dex of that tenant for one attempt, new to DBackup. */
export function dexTenantPerson(attempt: number): { name: string; email: string } {
    const name = `tenant-${attempt % DEX.attempts}`;
    return { name, email: `${name}@${DEX_TENANT_DOMAIN}` };
}

/** The provider ID of that tenant's provider for one attempt. */
export const dexTenantProviderId = (attempt: number): string => `dex-tenant-${attempt % DEX.attempts}`;

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
