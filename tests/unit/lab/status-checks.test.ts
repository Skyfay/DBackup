// @vitest-environment node
/**
 * `pnpm lab:status` reads the lab connections and jobs of the dev database. Both belong to a tenant,
 * so a read without a scope threw "AdapterConfig was queried outside a tenant" and the command
 * crashed. The seed puts the lab into the home tenant, and the status reads it there. The customers
 * of the seed span tenants and are read in the system scope.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { explicitScope, type TenantScope } from "@/lib/tenant/context";
import { REPO_ROOT, type LabConfig } from "../../../lab/src/config";

const reads = vi.hoisted(() => ({ scopes: {} as Record<string, TenantScope | undefined> }));

vi.mock("@/lib/prisma", () => {
    const migrations = () => readdirSync(path.join(REPO_ROOT, "prisma", "migrations"), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => ({ migration_name: entry.name }));
    return {
        default: {
            $queryRawUnsafe: vi.fn(async () => migrations()),
            user: {
                findFirst: vi.fn(async () => ({ email: "admin@lab.test" })),
                count: vi.fn(async () => 1),
            },
            adapterConfig: {
                findMany: vi.fn(async () => {
                    reads.scopes.connections = explicitScope();
                    return [{ name: "Lab Local", config: JSON.stringify({ basePath: "/srv/lab/workspaces/msp" }) }, { name: "Lab MySQL 8", config: "{}" }];
                }),
            },
            job: {
                count: vi.fn(async () => {
                    reads.scopes.jobs = explicitScope();
                    return 3;
                }),
                groupBy: vi.fn(async () => []),
            },
            // A dev database seeded before the seed made customers.
            tenant: {
                findMany: vi.fn(async () => {
                    reads.scopes.customers = explicitScope();
                    return [];
                }),
            },
            databaseAssignment: { findMany: vi.fn(async () => []) },
            connectionShareTenant: { groupBy: vi.fn(async () => []) },
            platformGroup: { findFirst: vi.fn(async () => null) },
            $disconnect: vi.fn(async () => undefined),
        },
    };
});

const { checkDevDatabase } = await import("../../../lab/src/status-checks");

const CONFIG = { admin: { email: "admin@lab.test" }, storageRoot: "/srv/lab" } as unknown as LabConfig;

describe("the dev database part of lab:status", () => {
    let dir: string;
    let databaseUrl: string | undefined;

    beforeEach(() => {
        reads.scopes = {};
        dir = mkdtempSync(path.join(os.tmpdir(), "lab-status-"));
        const file = path.join(dir, "dev.db");
        writeFileSync(file, "");
        databaseUrl = process.env.DATABASE_URL;
        process.env.DATABASE_URL = `file:${file}`;
    });

    afterEach(() => {
        if (databaseUrl === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = databaseUrl;
        rmSync(dir, { recursive: true, force: true });
    });

    it("reads the lab connections and jobs in the home tenant, where the seed put them", async () => {
        const section = await checkDevDatabase(CONFIG, "msp");

        expect(reads.scopes).toEqual({ connections: { kind: "tenant", tenantId: "default" }, jobs: { kind: "tenant", tenantId: "default" }, customers: { kind: "system" } });
        expect(section.rows).toEqual(expect.arrayContaining([
            expect.objectContaining({ mark: "ok", name: "lab", detail: "2 connections, 3 jobs" }),
            expect.objectContaining({ mark: "ok", name: "backups" }),
        ]));
    });

    it("asks for the seed again while the customer tenants are missing", async () => {
        const section = await checkDevDatabase(CONFIG, "msp");

        expect(section.rows.filter((row) => row.mark === "warn").map((row) => row.name)).toEqual(["Acme", "Globex", "Lab Support"]);
        expect(section.next).toEqual([expect.stringMatching(/^pnpm lab:seed +adds the customers Acme and Globex/)]);
    });
});
