/**
 * The checks of `lab:status` that look at this machine: the dev database of this workspace, the
 * client tools DBackup runs, and what answers on port 3000.
 */

import { existsSync, readdirSync, readFileSync, readlinkSync } from "fs";
import path from "path";
import { devDatabaseFile } from "./app-env";
import { REPO_ROOT, type LabConfig } from "./config";
import { attempt } from "./docker";
import { localBackupDir } from "./folders";
import { LAB_SUPPORT, LAB_TENANTS } from "./tenants";

export type Mark = "ok" | "warn" | "fail" | "info";

export interface Row {
    mark: Mark;
    name: string;
    /** An address or a version, shown in a column of its own. */
    where?: string;
    detail: string;
}

export interface Section {
    title: string;
    rows: Row[];
    /** What to run to fix what the section found. */
    next: string[];
}

/** Whether the dev database of this workspace is there, migrated and seeded for this workspace. */
export async function checkDevDatabase(config: LabConfig, workspace: string): Promise<Section> {
    const file = devDatabaseFile();
    const section: Section = { title: `Dev database ${path.relative(REPO_ROOT, file) || file}`, rows: [], next: [] };
    if (!existsSync(file)) {
        section.rows.push({ mark: "fail", name: "database", detail: "not created yet" });
        section.next.push("pnpm lab:reset   creates it from the migrations and seeds it");
        return section;
    }

    // Imported only now: loadAppEnv() ran before, so Prisma opens the database of this checkout.
    const { default: prisma } = await import("@/lib/prisma");
    try {
        const applied = await prisma.$queryRawUnsafe<{ migration_name: string }[]>("SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL")
            .catch(() => null);
        if (!applied) {
            section.rows.push({ mark: "fail", name: "migrations", detail: "the database was never migrated" });
            section.next.push("pnpm lab:reset   creates it from the migrations and seeds it");
            return section;
        }
        const known = new Set(applied.map((row) => row.migration_name));
        const folders = readdirSync(path.join(REPO_ROOT, "prisma", "migrations"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
        const pending = folders.filter((name) => !known.has(name));
        section.rows.push(pending.length
            ? { mark: "warn", name: "migrations", detail: `${pending.length} not applied yet, pnpm dev applies them on start` }
            : { mark: "ok", name: "migrations", detail: `all ${folders.length} applied` });
        if (pending.length) return section;

        const admin = await prisma.user.findFirst({ where: { email: config.admin.email }, select: { email: true } });
        const users = await prisma.user.count();
        if (admin) section.rows.push({ mark: "ok", name: "admin", detail: `${admin.email} can sign in` });
        else if (users > 0) section.rows.push({ mark: "info", name: "admin", detail: `${users} users, but none is ${config.admin.email}` });
        else {
            section.rows.push({ mark: "fail", name: "admin", detail: "no user yet" });
            section.next.push("pnpm lab:seed    adds the admin and every lab connection");
        }

        // The seed puts the lab into the home tenant, and a connection or a job is only read inside a tenant.
        const { runAsTenant } = await import("@/lib/tenant/context");
        const { HOME_TENANT_ID } = await import("@/lib/tenant/home");
        const [connections, jobs] = await runAsTenant(HOME_TENANT_ID, async () => [
            await prisma.adapterConfig.findMany({ where: { name: { startsWith: "Lab " } }, select: { name: true, config: true } }),
            await prisma.job.count({ where: { name: { startsWith: "Lab " } } }),
        ] as const);
        if (connections.length === 0) {
            section.rows.push({ mark: "fail", name: "lab", detail: "no lab connections, the seed never ran here" });
            section.next.push("pnpm lab:seed    adds the admin and every lab connection");
            return section;
        }
        section.rows.push({ mark: "ok", name: "lab", detail: `${connections.length} connections, ${jobs} jobs` });

        const local = connections.find((connection) => connection.name === "Lab Local");
        const folder = local ? (JSON.parse(local.config) as { basePath?: string }).basePath : undefined;
        const expected = localBackupDir(config, workspace);
        if (folder && folder !== expected) {
            section.rows.push({ mark: "warn", name: "backups", detail: `Lab Local writes to ${folder}, not to the folder of this workspace` });
            section.next.push("pnpm lab:seed    points the destinations at this workspace");
        } else if (folder) {
            section.rows.push({ mark: "ok", name: "backups", detail: `go to ${folder} and the folders of ${workspace} on every server` });
        }

        // The customers span tenants, so they are read in the system scope.
        const { runAsSystem } = await import("@/lib/tenant/context");
        const customers = customerRows(await runAsSystem(() => readCustomers(prisma as unknown as CustomerReader)));
        section.rows.push(...customers.rows);
        section.next.push(...customers.next);
        return section;
    } finally {
        await prisma.$disconnect();
    }
}

/** What the seed made of a customer tenant. */
export interface CustomerFacts {
    name: string;
    people: string[];
    jobs: number;
    /** The databases of servers of other tenants it holds now. */
    given: string[];
    /** The destinations and channels other tenants share with it. */
    provided: number;
    blocks: boolean;
    allowed: number;
}

export interface SupportFacts {
    people: string[];
    tenants: number;
}

export interface Customers {
    /** In the order of `LAB_TENANTS`, null for a tenant the seed never made. */
    tenants: (CustomerFacts | null)[];
    support: SupportFacts | null;
}

type Counted = { tenantId: string; _count: { _all: number } }[];

/** The part of the Prisma client the read of the customers takes. */
export interface CustomerReader {
    tenant: { findMany(args: object): Promise<{ id: string; name: string; blocksLocalNetwork: boolean; allowedNetworks: string; memberships: { user: { email: string } }[] }[]> };
    job: { groupBy(args: object): Promise<Counted> };
    databaseAssignment: { findMany(args: object): Promise<{ tenantId: string | null; databaseName: string }[]> };
    connectionShareTenant: { groupBy(args: object): Promise<Counted> };
    platformGroup: { findFirst(args: object): Promise<{ members: { email: string }[]; tenants: { tenantId: string }[] } | null> };
}

const customerNames = () => Object.values(LAB_TENANTS).map((tenant) => tenant.name);

/** Reads the customers of the seed and its platform group. Runs in the system scope, since they span tenants. */
export async function readCustomers(client: CustomerReader): Promise<Customers> {
    const names = customerNames();
    const rows = await client.tenant.findMany({
        where: { name: { in: names } },
        select: { id: true, name: true, blocksLocalNetwork: true, allowedNetworks: true, memberships: { select: { user: { select: { email: true } } } } },
    });
    const ids = rows.map((row) => row.id);
    const [jobs, given, provided, group] = await Promise.all([
        client.job.groupBy({ by: ["tenantId"], where: { tenantId: { in: ids } }, _count: { _all: true } }),
        client.databaseAssignment.findMany({ where: { tenantId: { in: ids }, validUntil: null }, select: { tenantId: true, databaseName: true } }),
        client.connectionShareTenant.groupBy({ by: ["tenantId"], where: { tenantId: { in: ids } }, _count: { _all: true } }),
        client.platformGroup.findFirst({ where: { name: LAB_SUPPORT.group }, select: { members: { select: { email: true } }, tenants: { select: { tenantId: true } } } }),
    ]);
    const count = (list: Counted, id: string) => list.find((entry) => entry.tenantId === id)?._count._all ?? 0;
    const tenants = names.map((name): CustomerFacts | null => {
        const row = rows.find((candidate) => candidate.name === name);
        if (!row) return null;
        let allowed: unknown;
        try {
            allowed = JSON.parse(row.allowedNetworks);
        } catch {
            allowed = [];
        }
        return {
            name,
            people: row.memberships.map((membership) => membership.user.email),
            jobs: count(jobs, row.id),
            given: [...new Set(given.filter((entry) => entry.tenantId === row.id).map((entry) => entry.databaseName))],
            provided: count(provided, row.id),
            blocks: row.blocksLocalNetwork,
            allowed: Array.isArray(allowed) ? allowed.length : 0,
        };
    });
    return { tenants, support: group ? { people: group.members.map((member) => member.email), tenants: group.tenants.length } : null };
}

const plural = (count: number, one: string) => `${count} ${count === 1 ? one : `${one}s`}`;

/** A row per customer of the seed and one for its platform group, with the seed as the next step while one is missing. */
export function customerRows(customers: Customers): { rows: Row[]; next: string[] } {
    const names = customerNames();
    const rows: Row[] = customers.tenants.map((tenant, index): Row => {
        if (!tenant) return { mark: "warn", name: names[index], detail: "no such tenant yet" };
        const network = !tenant.blocks ? "reaches the local network" : tenant.allowed ? `blocks the local network but ${plural(tenant.allowed, "range")}` : "blocks the local network";
        const parts = [
            tenant.people.join(", ") || "nobody works here",
            ...(tenant.jobs ? [plural(tenant.jobs, "job")] : []),
            ...(tenant.given.length ? [`${tenant.given.join(", ")} given to it`] : []),
            ...(tenant.provided ? [`${plural(tenant.provided, "connection")} shared with it`] : []),
            network,
        ];
        return { mark: tenant.people.length ? "ok" : "warn", name: tenant.name, detail: parts.join(", ") };
    });
    const support = customers.support;
    rows.push(support
        ? { mark: support.people.length ? "ok" : "warn", name: LAB_SUPPORT.group, detail: `${support.people.join(", ") || "nobody in it"}, platform group of ${plural(support.tenants, "tenant")}` }
        : { mark: "warn", name: LAB_SUPPORT.group, detail: "no such platform group yet" });
    if (rows.some((row) => row.mark === "warn")) {
        return { rows, next: [`pnpm lab:seed    adds the customers ${names.join(" and ")} with a person each and the platform group ${LAB_SUPPORT.group}`] };
    }
    rows.push({ mark: "info", name: "people", detail: "each signs in with the password of the admin in the lab config" });
    return { rows, next: [] };
}

interface Tool {
    label: string;
    /** The first one that is installed counts, like DBackup picks it. */
    binaries: string[];
    args: string[];
    /** The version the Docker image ships, read from the Dockerfile. */
    image?: (dockerfile: string) => string | undefined;
}

const TOOLS: Tool[] = [
    { label: "MySQL", binaries: ["mariadb-dump", "mysqldump"], args: ["--version"], image: () => "MariaDB of Debian 12" },
    { label: "PostgreSQL", binaries: ["pg_dump"], args: ["--version"], image: (text) => text.match(/postgresql-client-(\d+)/)?.[1] },
    { label: "MongoDB", binaries: ["mongodump"], args: ["--version"], image: (text) => text.match(/mongodb-database-tools-debian\d+-x86_64-([\d.]+)\.deb/)?.[1] },
    { label: "Redis", binaries: ["redis-cli"], args: ["--version"] },
    { label: "Firebird", binaries: ["gbak"], args: ["-z"], image: (text) => text.match(/FIREBIRD_RELEASE_TAG=([\d.]+)/)?.[1] },
    { label: "SQLite", binaries: ["sqlite3"], args: ["--version"] },
    { label: "SMB", binaries: ["smbclient"], args: ["--version"] },
    { label: "rsync", binaries: ["rsync"], args: ["--version"] },
];

/** "Distrib 10.11.6" for the MariaDB build of mysqldump, else the first version in the output. */
export function versionOf(output: string): string | undefined {
    return output.match(/Distrib (\d+\.\d+\.\d+)/)?.[1] ?? output.match(/(\d+\.\d+(?:\.\d+)?)/)?.[1];
}

/** The client tools DBackup runs when it backs up from this machine, as `pnpm dev` does. */
export async function checkTools(): Promise<Section> {
    const dockerfile = existsSync(path.join(REPO_ROOT, "Dockerfile")) ? readFileSync(path.join(REPO_ROOT, "Dockerfile"), "utf8") : "";
    const section: Section = { title: "Client tools on this machine", rows: [], next: [] };
    const found = await Promise.all(TOOLS.map(async (tool) => {
        for (const binary of tool.binaries) {
            const result = await attempt(binary, tool.args, { timeoutMs: 5_000 });
            if (result.code !== 127) return { tool, binary, version: versionOf(`${result.stdout}\n${result.stderr}`) };
        }
        return { tool, binary: undefined, version: undefined };
    }));
    for (const { tool, binary, version } of found) {
        const image = tool.image?.(dockerfile);
        if (!binary) {
            section.rows.push({ mark: "warn", name: tool.label, detail: `${tool.binaries.join(" or ")} missing, backups of it fail in pnpm dev` });
            continue;
        }
        const differs = image && version && /^\d/.test(image) && !version.startsWith(image);
        section.rows.push({
            mark: differs ? "info" : "ok",
            name: tool.label,
            where: `${binary} ${version ?? ""}`.trim(),
            detail: differs ? `the image ships ${image}` : image && !/^\d/.test(image) ? `the image ships the ${image}` : "",
        });
    }
    if (section.rows.some((row) => row.mark === "warn")) section.next.push("scripts/setup-dev-debian.sh   installs the client tools (setup-dev-macos.sh on a Mac)");
    return section;
}

/** What answers on port 3000, and from which checkout when the system tells. */
export async function checkApp(): Promise<Section> {
    const section: Section = { title: "DBackup on port 3000", rows: [], next: [] };
    const health = await fetch("http://localhost:3000/api/health", { signal: AbortSignal.timeout(3_000) })
        .then((response) => response.status)
        .catch(() => null);
    if (health === null) {
        section.rows.push({ mark: "info", name: "app", detail: "nothing answers, pnpm dev starts it" });
        return section;
    }
    const checkout = await checkoutOnPort(3000);
    const here = checkout === undefined || path.resolve(checkout) === path.resolve(REPO_ROOT);
    section.rows.push({
        mark: health === 200 && here ? "ok" : "warn",
        name: "app",
        where: "http://localhost:3000",
        detail: `${health === 200 ? "healthy" : `answers ${health}`}${checkout ? `, runs from ${here ? "this workspace" : checkout}` : ""}`,
    });
    return section;
}

/** The working directory of the process listening on a port. Linux only, undefined elsewhere. */
async function checkoutOnPort(port: number): Promise<string | undefined> {
    const listening = await attempt("ss", ["-Htlnp", `sport = :${port}`], { timeoutMs: 3_000 });
    const pid = listening.stdout.match(/pid=(\d+)/)?.[1];
    if (!pid) return undefined;
    try {
        return readlinkSync(`/proc/${pid}/cwd`);
    } catch {
        return undefined;
    }
}
