import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PermissionsProvider } from "@/components/permissions/permissions-context";
import { TenantViewProvider, type TenantView } from "@/components/tenant/tenant-view";
import { PERMISSIONS } from "@/lib/auth/permissions";
import type { SearchHit } from "@/services/search/search-types";

const mocks = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), switchTenant: vi.fn(), hits: [] as unknown[] }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }), usePathname: () => "/dashboard" }));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "dark", setTheme: vi.fn() }) }));
vi.mock("@/components/dashboard/history/run-actions", () => ({ startRun: vi.fn() }));
vi.mock("@/app/actions/tenant/tenant", () => ({ switchTenant: (...args: unknown[]) => mocks.switchTenant(...args) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { GlobalSearch } = await import("@/components/layout/global-search");
const { hitItems } = await import("@/components/layout/search-items");
const { pageItems } = await import("@/components/layout/search-offers");

const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ success: true, data: { hits: mocks.hits } }) }));

// Node 25 has a localStorage of its own that does nothing without a file, over the one of jsdom.
function memoryStorage(): Storage {
    const data = new Map<string, string>();
    return {
        get length() {
            return data.size;
        },
        clear: () => data.clear(),
        getItem: (key) => data.get(key) ?? null,
        key: (index) => [...data.keys()][index] ?? null,
        removeItem: (key) => void data.delete(key),
        setItem: (key, value) => void data.set(key, String(value)),
    };
}

const TENANTS = [{ id: "default", name: "Home" }, { id: "acme", name: "Acme GmbH" }];
const IN_HOME: TenantView = { tenants: TENANTS, activeTenantId: "default", allTenants: false, isPlatformAdmin: false, tenantCount: 3 };

/** A run of Acme opened from the search before, and one of a tenant the viewer may no longer open. */
const keptAcmeRun = { key: "recent:/dashboard/history/run?id=r1&from=history", group: "recent", title: "Run of Nightly", sub: "", kind: "Run", href: "/dashboard/history/run?id=r1&from=history", needs: [PERMISSIONS.HISTORY.READ], tenantId: "acme" };
const keptShopRun = { ...keptAcmeRun, key: "recent:/dashboard/history/run?id=r2&from=history", title: "Run of Shop", href: "/dashboard/history/run?id=r2&from=history", tenantId: "shop" };

function renderSearch(view: TenantView, permissions: string[] = [PERMISSIONS.HISTORY.READ, PERMISSIONS.JOBS.READ]) {
    render(
        <PermissionsProvider permissions={permissions}>
            <TenantViewProvider value={view}>
                <GlobalSearch userId="u1" />
            </TenantViewProvider>
        </PermissionsProvider>
    );
    return userEvent.setup();
}

describe("the search in the header across tenants", () => {
    beforeAll(() => {
        Element.prototype.scrollIntoView = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
    });

    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal("localStorage", memoryStorage());
        mocks.hits = [];
        mocks.switchTenant.mockResolvedValue({ success: true, data: { name: "Acme GmbH" } });
    });

    it("opens a recent entry of another tenant in its tenant, not in the one open", async () => {
        localStorage.setItem("dbackup.search.recent:u1", JSON.stringify([keptAcmeRun]));
        const user = renderSearch(IN_HOME);

        await user.click(screen.getByRole("button", { name: /^Search jobs, connections/ }));
        const recent = await screen.findByRole("group", { name: "Recent" });
        await user.click(within(recent).getByRole("option", { name: /^Run of Nightly/ }));

        await waitFor(() => expect(mocks.switchTenant).toHaveBeenCalledExactlyOnceWith("acme"));
        expect(mocks.push).toHaveBeenCalledWith("/dashboard/history/run?id=r1&from=history");
    });

    it("opens a hit of the tenant open in place", async () => {
        mocks.hits = [{ kind: "job", id: "j1", name: "Nightly", enabled: true, schedule: "0 2 * * *", adapterId: "mysql", lastStatus: null, tenantId: "default" } satisfies SearchHit];
        const user = renderSearch(IN_HOME);

        await user.click(screen.getByRole("button", { name: /^Search jobs, connections/ }));
        await user.type(await screen.findByRole("combobox"), "nightly");
        await user.click(await screen.findByRole("option", { name: /^Nightly/ }));

        expect(mocks.switchTenant).not.toHaveBeenCalled();
        expect(mocks.push).toHaveBeenCalledWith("/dashboard/jobs?job=j1");
    });

    it("drops a recent entry of a tenant the viewer may not open", async () => {
        localStorage.setItem("dbackup.search.recent:u1", JSON.stringify([keptShopRun, keptAcmeRun]));
        const user = renderSearch(IN_HOME);

        await user.click(screen.getByRole("button", { name: /^Search jobs, connections/ }));
        const recent = await screen.findByRole("group", { name: "Recent" });

        expect(within(recent).getByRole("option", { name: /^Run of Nightly/ })).toBeInTheDocument();
        expect(screen.queryByText("Run of Shop")).not.toBeInTheDocument();
    });

    it("offers Quick Setup and the Database Explorer only where the sidebar does", async () => {
        const permissions = [PERMISSIONS.SOURCES.VIEW, PERMISSIONS.SOURCES.WRITE, PERMISSIONS.DESTINATIONS.WRITE, PERMISSIONS.JOBS.WRITE];
        const user = renderSearch({ ...IN_HOME, showQuickSetup: false, ownDatabases: false }, permissions);

        await user.click(screen.getByRole("button", { name: /^Search jobs, connections/ }));
        expect(await screen.findByRole("option", { name: /^Overview/ })).toBeInTheDocument();
        expect(screen.queryByRole("option", { name: /^Quick Setup/ })).not.toBeInTheDocument();
        expect(screen.queryByRole("option", { name: /^Database Explorer/ })).not.toBeInTheDocument();
    });
});

describe("the pages and hits the search offers", () => {
    const can = () => true;

    it("follows the sidebar for Quick Setup and the Database Explorer", () => {
        const titles = (view: Parameters<typeof pageItems>[2]) => pageItems("", can, view).map((item) => item.title);

        expect(titles({ showQuickSetup: true, ownDatabases: true })).toEqual(expect.arrayContaining(["Quick Setup", "Database Explorer"]));
        expect(titles({ showQuickSetup: false, ownDatabases: false })).not.toContain("Quick Setup");
        expect(titles({ showQuickSetup: false, ownDatabases: false })).not.toContain("Database Explorer");
    });

    it("opens a group in its tenant", () => {
        const [item] = hitItems({ kind: "group", id: "g1", name: "Operators", people: 2, tenantId: "acme" });

        expect(item.tenantId).toBe("acme");
        expect(item.href).toBe("/dashboard/users?tab=groups&open=g1");
    });

    it("leads to the accounts of the platform for a person found in All tenants", () => {
        const [inAll] = hitItems({ kind: "user", id: "u1", name: "Ada", email: "ada@example.ch", group: null, tenants: 2 });
        const [inTenant] = hitItems({ kind: "user", id: "u1", name: "Ada", email: "ada@example.ch", group: "Admin" });

        expect(inAll.href).toBe("/dashboard/platform/users?tab=users&open=u1");
        expect(inAll.needs).toEqual([PERMISSIONS.PLATFORM.ACCOUNTS_READ]);
        expect(inTenant.href).toBe("/dashboard/users?tab=users&open=u1");
    });
});
