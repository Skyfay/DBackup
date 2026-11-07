/**
 * The Quick Setup needs a database, so a tenant that has none and may add none is never sent there
 * after signing in and is led away from its address, instead of a wizard it can never finish.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERMISSIONS } from "@/lib/auth/permissions";
import "@/lib/testing/prisma-mock";

const SETUP_RIGHTS = [PERMISSIONS.SOURCES.WRITE, PERMISSIONS.DESTINATIONS.WRITE, PERMISSIONS.JOBS.WRITE];

const mocks = vi.hoisted(() => ({
    reach: { jobs: true, databases: true },
    redirect: vi.fn((target: string) => {
        throw new Error(`redirect:${target}`);
    }),
}));

vi.mock("next/navigation", () => ({ redirect: (target: string) => mocks.redirect(target), useRouter: () => ({ push: vi.fn() }), usePathname: () => "/dashboard" }));
vi.mock("@/lib/auth/access-control", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/auth/access-control")>()),
    getViewer: async () => ({ id: "u-1", tenantId: "acme", allTenants: false, isPlatformAdmin: false, permissions: SETUP_RIGHTS }),
    getUserPermissions: async () => SETUP_RIGHTS,
}));
vi.mock("@/services/dashboard/start-page", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/services/dashboard/start-page")>()),
    ownBackupReach: async () => mocks.reach,
    hasNothingToBackUp: async () => true,
}));
vi.mock("@/services/backup/encryption-service", () => ({ getEncryptionProfiles: async () => [] }));
vi.mock("@/services/dashboard/overview-service", () => ({ getDashboardOverview: vi.fn() }));
vi.mock("@/app/actions/tenant/tenant", () => ({ getTenantSummaries: vi.fn() }));
vi.mock("@/services/tenant/shared-databases", () => ({ listSharedDatabases: vi.fn(async () => []) }));

const { default: SetupPage } = await import("@/app/dashboard/setup/page");
const { default: DashboardPage } = await import("@/app/dashboard/(overview)/page");

const afterSignIn = () => DashboardPage({ searchParams: Promise.resolve({ from: "sign-in" }) });

beforeEach(() => {
    mocks.redirect.mockClear();
});

describe("the Quick Setup of a tenant without a database it may add", () => {
    beforeEach(() => {
        // Folders to back up and a destination, but no database and none it may add.
        mocks.reach = { jobs: true, databases: false };
    });

    it("is not where signing in leads", async () => {
        await expect(afterSignIn()).rejects.toThrow("redirect:/dashboard");
        expect(mocks.redirect).not.toHaveBeenCalledWith("/dashboard/setup");
    });

    it("leads its address back to the Overview", async () => {
        await expect(SetupPage()).rejects.toThrow("redirect:/dashboard");
    });
});

describe("the Quick Setup of a tenant that may add a database", () => {
    beforeEach(() => {
        mocks.reach = { jobs: true, databases: true };
    });

    it("is where signing in leads while there is nothing to back up", async () => {
        await expect(afterSignIn()).rejects.toThrow("redirect:/dashboard/setup");
    });

    it("opens", async () => {
        await expect(SetupPage()).resolves.toBeTruthy();
        expect(mocks.redirect).not.toHaveBeenCalled();
    });
});
