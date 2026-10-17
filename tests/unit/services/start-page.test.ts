import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { hasNothingToBackUp, ownBackupReach } from "@/services/dashboard/start-page";
import { canUseQuickSetup } from "@/lib/auth/sign-in-target";
import { PERMISSIONS } from "@/lib/auth/permissions";

const tenant = vi.hoisted(() => ({ id: null as string | null }));
const provided = vi.hoisted(() => ({ destinations: [] as unknown[] }));
vi.mock("@/lib/tenant/current", () => ({ currentTenantId: async () => tenant.id }));
vi.mock("@/services/sharing/provided", () => ({ providedTo: vi.fn(async () => provided.destinations) }));

/** A tenant that may add what `adds` says and has as many connections of each kind as `has`. */
function mockTenant(adds: { addsDatabases: boolean; addsDirectorySources: boolean; addsDestinations: boolean }, has: { database: number; source: number; destination: number }) {
    prismaMock.tenant.findUnique.mockResolvedValue(adds as never);
    prismaMock.adapterConfig.count.mockImplementation((async (args: { where: { type: string; storageRole?: string } }) => {
        if (args.where.type === "database") return has.database;
        return args.where.storageRole === "SOURCE" ? has.source : has.destination;
    }) as never);
}

beforeEach(() => {
    tenant.id = null;
    provided.destinations = [];
});

describe("where someone starts after signing in", () => {
    it("sends a fresh instance to the Quick Setup", async () => {
        prismaMock.adapterConfig.count.mockResolvedValue(0);
        prismaMock.job.count.mockResolvedValue(0);

        expect(await hasNothingToBackUp()).toBe(true);
        // A notification channel alone backs nothing up, so only databases and storage count.
        expect(prismaMock.adapterConfig.count).toHaveBeenCalledWith({ where: { type: { in: ["database", "storage"] } } });
    });

    it("keeps the Overview once there is a connection to back up from or to", async () => {
        prismaMock.adapterConfig.count.mockResolvedValue(1);
        prismaMock.job.count.mockResolvedValue(0);

        expect(await hasNothingToBackUp()).toBe(false);
    });

    it("keeps the Overview once there is a job", async () => {
        prismaMock.adapterConfig.count.mockResolvedValue(0);
        prismaMock.job.count.mockResolvedValue(2);

        expect(await hasNothingToBackUp()).toBe(false);
    });

    it("never sends a tenant there that has nothing to back up itself", async () => {
        tenant.id = "acme";
        mockTenant({ addsDatabases: false, addsDirectorySources: false, addsDestinations: false }, { database: 0, source: 0, destination: 0 });
        expect(await ownBackupReach()).toEqual({ jobs: false, databases: false });
    });

    it("offers the Quick Setup only to someone who may add a source, a destination and a job", () => {
        const all = [PERMISSIONS.SOURCES.WRITE, PERMISSIONS.DESTINATIONS.WRITE, PERMISSIONS.JOBS.WRITE];

        expect(canUseQuickSetup(all)).toBe(true);
        expect(canUseQuickSetup(all.slice(0, 2))).toBe(false);
        expect(canUseQuickSetup([])).toBe(false);
    });
});

describe("what a tenant can back up with jobs of its own", () => {
    it("counts everything outside a tenant, like in All tenants", async () => {
        expect(await ownBackupReach()).toEqual({ jobs: true, databases: true });
    });

    it("has jobs and the Database Explorer while it may add databases and destinations", async () => {
        tenant.id = "acme";
        mockTenant({ addsDatabases: true, addsDirectorySources: true, addsDestinations: true }, { database: 0, source: 0, destination: 0 });
        expect(await ownBackupReach()).toEqual({ jobs: true, databases: true });
    });

    it("has neither as a customer whose databases another tenant backs up and that adds nothing itself", async () => {
        tenant.id = "acme";
        mockTenant({ addsDatabases: false, addsDirectorySources: false, addsDestinations: false }, { database: 0, source: 0, destination: 0 });
        provided.destinations = [{ id: "msp-nas" }];
        expect(await ownBackupReach()).toEqual({ jobs: false, databases: false });
    });

    it("has jobs with a database the platform added for it and a destination another tenant shares", async () => {
        tenant.id = "acme";
        mockTenant({ addsDatabases: false, addsDirectorySources: false, addsDestinations: false }, { database: 1, source: 0, destination: 0 });
        provided.destinations = [{ id: "msp-nas" }];
        expect(await ownBackupReach()).toEqual({ jobs: true, databases: true });
    });

    it("has no jobs with a source but nowhere to write to", async () => {
        tenant.id = "acme";
        mockTenant({ addsDatabases: false, addsDirectorySources: true, addsDestinations: false }, { database: 0, source: 0, destination: 0 });
        expect(await ownBackupReach()).toEqual({ jobs: false, databases: false });
    });
});
