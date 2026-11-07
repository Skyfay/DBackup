/**
 * An account that works in no tenant yet, like everyone without a group after the upgrade from
 * v4.0.2: the frame of the dashboard and the Overview open for it without reading any data of a
 * tenant, which would refuse it and take every page down with it.
 */
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERMISSIONS } from "@/lib/auth/permissions";
import "@/lib/testing/prisma-mock";

const mocks = vi.hoisted(() => ({
    viewer: null as Record<string, unknown> | null,
    showsQuickSetup: vi.fn(),
    hasNothingToBackUp: vi.fn(),
    getDashboardOverview: vi.fn(),
    redirect: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({ redirect: (...args: unknown[]) => mocks.redirect(...args), usePathname: () => "/dashboard" }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => ({ user: { id: "u-anna" }, session: { id: "s-1" } }) } } }));
vi.mock("@/lib/auth/access-control", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/auth/access-control")>()),
    getViewer: async () => mocks.viewer,
    getUserPermissions: async () => (mocks.viewer?.permissions as string[] | undefined) ?? [],
}));
vi.mock("@/services/dashboard/start-page", () => ({
    showsQuickSetup: (...args: unknown[]) => mocks.showsQuickSetup(...args),
    hasNothingToBackUp: (...args: unknown[]) => mocks.hasNothingToBackUp(...args),
    // A tenant that backs up with jobs of its own, like every tenant before customers.
    ownBackupReach: async () => ({ jobs: true, databases: true }),
}));
vi.mock("@/services/dashboard/overview-service", () => ({ getDashboardOverview: (...args: unknown[]) => mocks.getDashboardOverview(...args) }));
vi.mock("@/app/actions/tenant/tenant", () => ({ getTenantSummaries: vi.fn() }));
vi.mock("@/services/system/update-service", () => ({ updateService: { getUpdateInfo: async () => ({ currentVersion: "4.1.0", latestVersion: null, updateAvailable: false }) } }));
vi.mock("@/services/user/preference-service", async () => {
    const { DEFAULT_TASK_COLORS } = await import("@/lib/core/task-colors");
    return { getTableDefaults: async () => ({}), getTaskColors: async () => DEFAULT_TASK_COLORS };
});
vi.mock("@/services/trash/trash-service", () => ({ getTrashDays: async () => 30 }));
vi.mock("@/services/system/system-settings-service", () => ({ getInstanceName: async () => null }));
// With two tenants the layout reads the name of the home tenant, which the platform goes by.
vi.mock("@/services/tenant/tenant-service", () => ({
    tenantService: { switchable: async () => [], count: async () => 2, find: async (id: string) => ({ id, name: "Platform" }) },
}));
vi.mock("@/components/layout/app-sidebar", () => ({ AppSidebar: () => null }));
vi.mock("@/components/layout/header", () => ({ Header: () => null }));

const { AppSidebar } = await import("@/components/layout/app-sidebar");
const { default: DashboardLayout } = await import("@/app/dashboard/layout");
const { default: DashboardPage } = await import("@/app/dashboard/(overview)/page");

/** The element of a component somewhere in a tree the layout returned, without rendering it. */
function findElement(node: ReactNode, type: unknown): ReactElement<Record<string, unknown>> | null {
    if (Array.isArray(node)) {
        for (const child of node) {
            const found = findElement(child, type);
            if (found) return found;
        }
        return null;
    }
    if (!isValidElement<{ children?: ReactNode }>(node)) return null;
    if (node.type === type) return node as ReactElement<Record<string, unknown>>;
    return findElement(node.props.children, type);
}

async function sidebarProps(): Promise<Record<string, unknown>> {
    const sidebar = findElement(await DashboardLayout({ children: null }), AppSidebar);
    if (!sidebar) throw new Error("The layout rendered no sidebar");
    return sidebar.props;
}

const viewer = (fields: Record<string, unknown>) => ({
    id: "u-anna",
    name: "Anna",
    tenantId: null,
    allTenants: false,
    isPlatformAdmin: false,
    permissions: [],
    role: null,
    platformGroup: null,
    opensAllTenants: false,
    ...fields,
});

beforeEach(() => {
    vi.clearAllMocks();
    mocks.showsQuickSetup.mockResolvedValue(true);
    mocks.hasNothingToBackUp.mockResolvedValue(true);
    mocks.getDashboardOverview.mockRejectedValue(new Error("TenantScopeError"));
});

describe("an account that works in no tenant", () => {
    it("opens the frame of the dashboard without asking a tenant whether it needs the Quick Setup", async () => {
        mocks.viewer = viewer({});

        expect(await sidebarProps()).toMatchObject({ showQuickSetup: false });
        expect(mocks.showsQuickSetup).not.toHaveBeenCalled();
    });

    it("sees a calm note with the way to the own profile on the Overview, also right after signing in", async () => {
        mocks.viewer = viewer({});

        render(await DashboardPage({ searchParams: Promise.resolve({ from: "sign-in" }) }));

        expect(screen.getByRole("heading", { name: "You work in no tenant yet" })).toBeInTheDocument();
        expect(screen.getByText(/invitation link/)).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Open your profile" })).toHaveAttribute("href", "/dashboard/profile");
        expect(mocks.getDashboardOverview).not.toHaveBeenCalled();
        expect(mocks.hasNothingToBackUp).not.toHaveBeenCalled();
        expect(mocks.redirect).not.toHaveBeenCalled();
    });

    it("still gets the Quick Setup by the data of the tenant once it works in one", async () => {
        mocks.viewer = viewer({ tenantId: "default" });

        expect(await sidebarProps()).toMatchObject({ showQuickSetup: true });
        expect(mocks.showsQuickSetup).toHaveBeenCalledTimes(1);
    });
});

describe("New tenant in the head of the sidebar", () => {
    const create = async () => ((await sidebarProps()).tenantAccess as { create: boolean }).create;
    const tenantsWrite = [PERMISSIONS.PLATFORM.TENANTS_READ, PERMISSIONS.PLATFORM.TENANTS_WRITE];

    it("is offered to a platform admin", async () => {
        mocks.viewer = viewer({ tenantId: "default", isPlatformAdmin: true });

        expect(await create()).toBe(true);
    });

    it("is offered to a platform group that reaches every tenant", async () => {
        mocks.viewer = viewer({ tenantId: "default", permissions: tenantsWrite, platformGroup: { id: "pg-1", name: "Support", allTenants: true } });

        expect(await create()).toBe(true);
    });

    it("is not offered to a platform group of some tenants, which could never open the new one", async () => {
        mocks.viewer = viewer({ tenantId: "acme", permissions: tenantsWrite, platformGroup: { id: "pg-2", name: "Acme team", allTenants: false } });

        expect(await create()).toBe(false);
    });
});
