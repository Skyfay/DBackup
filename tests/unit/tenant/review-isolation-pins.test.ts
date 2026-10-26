/**
 * Rules of the tenant boundary a release review checked against the code, pinned so a change that
 * breaks one fails here: the filter of the Prisma extension for every scope, the folder of a
 * customer on a shared destination, the mark of a follower run, whose cancel reaches a run of
 * another tenant, and the name a customer downloads a shared dump under.
 */
import { describe, expect, it, vi } from "vitest";
import type { FileInfo } from "@/lib/core/interfaces";
import { TenantScopeError } from "@/lib/logging/errors";
import { allTenantsArgs, scopeArgs, scopeChildArgs, systemArgs } from "@/lib/tenant/prisma-scope";
import { innerPath, outerFiles, type StorageViewMode } from "@/lib/tenant/storage-view";

vi.mock("@/lib/logging/logger", () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) } }));
vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/services/storage/storage-service", () => ({ storageService: {} }));

const { FOLLOWS_KEY, LEADING_RUNS, leaderOf } = await import("@/lib/execution/follower-runs");
const { sharedDumpName } = await import("@/services/tenant/shared-backups");

const file = (path: string): FileInfo => ({ name: path.split("/").at(-1)!, path, size: 1, lastModified: new Date("2026-10-26T10:00:00.000Z") });
const ACME: StorageViewMode = { kind: "customer", tenantId: "acme" };

describe("the filter of a tenant", () => {
    it("never writes a row of one tenant into another, by an upsert or one row of a batch", () => {
        expect(() => scopeArgs("Execution", "upsert", { where: { id: "r" }, create: {}, update: { tenantId: "globex" } }, "acme")).toThrow(TenantScopeError);
        expect(() => scopeArgs("Execution", "upsert", { where: { id: "r" }, create: { tenantId: "globex" }, update: {} }, "acme")).toThrow(TenantScopeError);
        expect(() => scopeArgs("Execution", "createMany", { data: [{}, { tenantId: "globex" }] }, "acme")).toThrow(TenantScopeError);
        expect(() => scopeArgs("Job", "updateMany", { where: {}, data: { tenantId: "globex" } }, "acme")).toThrow(TenantScopeError);
    });

    it("narrows an upsert and a delete of a child row through its parent", () => {
        expect(scopeChildArgs("job", "deleteMany", { where: { configId: "nas" } }, "acme").where).toEqual({ configId: "nas", AND: [{ job: { tenantId: "acme" } }] });
        expect(scopeChildArgs("share", "upsert", { where: { id: "x" } }, "acme").where).toEqual({ id: "x", AND: [{ share: { tenantId: "acme" } }] });
    });

    it("refuses an operation it has no filter for, rather than running it unfiltered", () => {
        expect(() => scopeArgs("Job", "findRaw", {}, "acme")).toThrow(TenantScopeError);
        expect(() => scopeChildArgs("job", "aggregateRaw", {}, "acme")).toThrow(TenantScopeError);
    });
});

describe("the system scope and All tenants", () => {
    it("make the system scope name the tenant of every row it creates, an upsert too", () => {
        expect(() => systemArgs("Execution", "create", { data: {} })).toThrow(TenantScopeError);
        expect(() => systemArgs("Execution", "createMany", { data: [{ tenantId: "acme" }, {}] })).toThrow(TenantScopeError);
        expect(() => systemArgs("AuditLog", "upsert", { where: { id: "a" }, create: {}, update: {} })).toThrow(TenantScopeError);
        expect(() => systemArgs("Execution", "create", { data: { tenantId: "acme" } })).not.toThrow();
    });

    it("let All tenants write no tenant model, only the caches a read fills", () => {
        expect(() => allTenantsArgs("Job", "upsert", { where: {}, create: {}, update: {} })).toThrow(TenantScopeError);
        expect(() => allTenantsArgs("ConnectionShare", "delete", { where: {} })).toThrow(TenantScopeError);
        expect(() => allTenantsArgs("DatabaseAssignment", "create", { data: {} })).toThrow(TenantScopeError);
        expect(() => allTenantsArgs("StorageListCache", "upsert", { where: {}, create: {}, update: {} })).not.toThrow();
    });
});

describe("the folder of a customer on a shared destination", () => {
    it("never lists the folder of a tenant whose id starts with its own, nor a file beside the folders", () => {
        const stored = [file("tenants/acme/crm/a.tar"), file("tenants/acme2/crm/b.tar"), file("tenants/acme-old/c.tar"), file("tenants/acme"), file("tenantsacme/d.tar")];
        expect(outerFiles(ACME, stored).map((entry) => entry.path)).toEqual(["crm/a.tar"]);
    });

    it("keeps a path that looks like another customer's folder inside its own", () => {
        expect(innerPath(ACME, "tenants/globex/crm/a.tar")).toBe("tenants/acme/tenants/globex/crm/a.tar");
        expect(innerPath(ACME, "/tenants/globex")).toBe("tenants/acme/tenants/globex");
    });
});

describe("the mark of a follower run", () => {
    it("is never made by a name of a database or a destination with quotes in it, so no cancel reaches the run of another tenant", () => {
        const forged = `shop","${FOLLOWS_KEY}":"run-of-globex`;
        const metadata = JSON.stringify({ stage: "Uploading", target: { name: forged }, onlyDatabases: [forged], destinations: [{ name: forged }] });
        const mark = (LEADING_RUNS.OR as { NOT?: { metadata: { contains: string } } }[])[1].NOT!.metadata.contains;
        expect(metadata.includes(mark)).toBe(false);
        expect(leaderOf(metadata)).toBeNull();
    });

    it("names the run a real follower follows", () => {
        expect(leaderOf(JSON.stringify({ stage: "Queued", [FOLLOWS_KEY]: "run-1" }))).toBe("run-1");
    });
});

describe("the name a customer downloads the dump of a shared database under", () => {
    it("never names the job of the server's tenant, the time of the backup takes its place", () => {
        const name = sharedDumpName("Shared/msp-nightly-prod_2026-10-15_0214.tar", "msp-nightly-prod_2026-10-15_0214_shop_acme.sql", "2026-10-15T02:14:00.000Z");
        expect(name).toBe("2026-10-15_0214_shop_acme.sql");
        expect(name).not.toContain("msp-nightly");
    });
});
