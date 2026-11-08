// @vitest-environment node
/**
 * The storage trend of the dashboard against a real SQLite database migrated with the migrations of
 * this version, since the newest snapshot of each day is picked by raw SQL. A refresh writes one
 * snapshot per destination for each tenant whose backups it holds, so on a destination the MSP
 * shares with its customers each tenant has a series of its own, and the trend of a tenant sums its
 * own while All tenants sums every tenant.
 */
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { runAsSystem, runAsTenant, type TenantScope } from "@/lib/tenant/context";
import { tenantScopeExtension } from "@/lib/tenant/prisma-scope";
import { invalidateDashboardCache } from "@/services/dashboard/cache";
import { getAggregates } from "@/services/dashboard/aggregates";

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));

const app = vi.hoisted(() => ({ client: null as unknown as object, scope: null as TenantScope | null }));
vi.mock("@/lib/prisma", () => ({
    default: new Proxy({}, {
        get: (_target, key) => {
            const value = Reflect.get(app.client, key);
            return typeof value === "function" ? value.bind(app.client) : value;
        },
    }),
}));

let root = "";
let base: PrismaClient;

beforeAll(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), "dbackup-trend-"));
    const file = path.join(root, "trend.db");
    execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["migrate", "deploy"], {
        env: { ...process.env, DATABASE_URL: `file:${file}` },
        stdio: "pipe",
    });
    base = new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
    // Outside a request no tenant is known. A test of All tenants sets the scope its request would name.
    app.client = base.$extends(tenantScopeExtension(async () => app.scope));

    const now = new Date();
    /** Ten in the morning `daysAgo` days ago, in UTC like the scheduler without a time zone. */
    const morning = (daysAgo: number, ms = 0) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo, 10, 0, 0, ms));

    await runAsSystem(async () => {
        await base.tenant.createMany({
            data: [
                { id: "msp", name: "MSP", sharesWithCustomers: true },
                { id: "acme", name: "Acme" },
                { id: "shop", name: "Shop" },
            ],
        });
        await base.adapterConfig.createMany({
            data: [
                { id: "msp-s3", name: "S3", type: "storage", adapterId: "s3", config: "{}", tenantId: "msp" },
                { id: "acme-nas", name: "NAS", type: "storage", adapterId: "local-filesystem", config: "{}", tenantId: "acme" },
            ],
        });
        await base.connectionShare.create({ data: { id: "msp-s3", tenantId: "msp", allTenants: true } });

        // Three days of refreshes. On the shared S3 the rows of one refresh lie a millisecond apart,
        // like an older version wrote them, so the newest of each day belongs to a customer.
        const sizes: [number, number, number, number][] = [[100, 300, 50, 900], [120, 310, 55, 950], [130, 320, 60, 1000]];
        for (const [index, [msp, acme, shop, nas]] of sizes.entries()) {
            const daysAgo = 3 - index;
            await base.storageSnapshot.createMany({
                data: [
                    { adapterConfigId: "msp-s3", adapterName: "S3", adapterId: "s3", tenantId: "msp", size: BigInt(msp), count: 1, createdAt: morning(daysAgo) },
                    { adapterConfigId: "msp-s3", adapterName: "S3", adapterId: "s3", tenantId: "acme", size: BigInt(acme), count: 2, createdAt: morning(daysAgo, 1) },
                    { adapterConfigId: "msp-s3", adapterName: "S3", adapterId: "s3", tenantId: "shop", size: BigInt(shop), count: 3, createdAt: morning(daysAgo, 2) },
                    { adapterConfigId: "acme-nas", adapterName: "NAS", adapterId: "local-filesystem", tenantId: "acme", size: BigInt(nas), count: 4, createdAt: morning(daysAgo) },
                ],
            });
        }
        await base.systemSetting.createMany({
            data: [
                {
                    key: "cache.storageVolume",
                    value: JSON.stringify([
                        { configId: "msp-s3", tenantId: "msp", name: "S3", adapterId: "s3", size: 130, count: 1 },
                        { configId: "msp-s3", tenantId: "acme", name: "S3", adapterId: "s3", size: 320, count: 2 },
                        { configId: "msp-s3", tenantId: "shop", name: "S3", adapterId: "s3", size: 60, count: 3 },
                        { configId: "acme-nas", tenantId: "acme", name: "NAS", adapterId: "local-filesystem", size: 1000, count: 4 },
                    ]),
                },
                { key: "cache.storageVolume.updatedAt", value: now.toISOString() },
            ],
        });
    });
}, 120_000);

afterAll(async () => {
    await base?.$disconnect();
    if (root) rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
    invalidateDashboardCache();
    app.scope = null;
});

/** The last four days of the trend, the oldest of the snapshots first and today last. */
const lastDays = (series: (number | null)[]) => series.slice(-4);

describe("the storage trend of the dashboard", () => {
    it("keeps every day of the MSP's own backups on the destination it shares", async () => {
        const { storage } = await runAsTenant("msp", () => getAggregates());

        expect(lastDays(storage.size)).toEqual([100, 120, 130, 130]);
        expect(lastDays(storage.count)).toEqual([1, 1, 1, 1]);
    });

    it("sums a customer's own backups on its destinations and on the destination provided to it", async () => {
        const { storage } = await runAsTenant("acme", () => getAggregates());

        expect(lastDays(storage.size)).toEqual([300 + 900, 310 + 950, 320 + 1000, 320 + 1000]);
        expect(lastDays(storage.count)).toEqual([6, 6, 6, 6]);
    });

    it("shows another customer only its own backups on the shared destination", async () => {
        const { storage } = await runAsTenant("shop", () => getAggregates());

        expect(lastDays(storage.size)).toEqual([50, 55, 60, 60]);
    });

    it("sums every tenant of each destination in All tenants", async () => {
        app.scope = { kind: "all" };

        const { storage } = await getAggregates();

        expect(lastDays(storage.size)).toEqual([1350, 1435, 1510, 1510]);
        expect(lastDays(storage.count)).toEqual([10, 10, 10, 10]);
        // Before the first snapshot nothing was measured.
        expect(storage.size.slice(0, -4).every((value) => value === null)).toBe(true);
    });
});
