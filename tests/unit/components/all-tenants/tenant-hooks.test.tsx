import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { TenantViewProvider, type TenantView } from "@/components/tenant/tenant-view";

const mocks = vi.hoisted(() => ({
    params: new URLSearchParams(),
    push: vi.fn(),
    refresh: vi.fn(),
    switchTenant: vi.fn(),
}));

vi.mock("next/navigation", () => ({
    useSearchParams: () => mocks.params,
    useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
    usePathname: () => "/dashboard/history/run",
}));
vi.mock("@/app/actions/tenant/tenant", () => ({ switchTenant: (...args: unknown[]) => mocks.switchTenant(...args) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { useTenantColumns } = await import("@/components/tenant/tenant-column");
const { useNewInTenant, useOpenRecord } = await import("@/components/tenant/tenant-actions");
const { useNewFromLink } = await import("@/hooks/use-new-from-link");
const { AllTenantsNotice } = await import("@/components/tenant/all-tenants-notice");

const TENANTS = [{ id: "default", name: "Home" }, { id: "acme", name: "Acme GmbH" }];
const ALL: TenantView = { tenants: TENANTS, activeTenantId: null, allTenants: true, isPlatformAdmin: true };
const IN_ACME: TenantView = { tenants: TENANTS, activeTenantId: "acme", allTenants: false, isPlatformAdmin: true };

const within = (view: TenantView) => function Wrapper({ children }: { children: ReactNode }) {
    return <TenantViewProvider value={view}>{children}</TenantViewProvider>;
};

type Row = { id: string; tenantId: string };
const tenantOf = (row: Row) => row.tenantId;
const ROWS: Row[] = [{ id: "a", tenantId: "acme" }];

describe("a list in All tenants", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.params = new URLSearchParams();
        mocks.switchTenant.mockResolvedValue({ success: true, data: { name: "Acme GmbH" } });
    });

    it("gets a Tenant column and filter only in All tenants", () => {
        const all = renderHook(() => useTenantColumns(tenantOf, ROWS), { wrapper: within(ALL) }).result.current;
        const inTenant = renderHook(() => useTenantColumns(tenantOf, ROWS), { wrapper: within(IN_ACME) }).result.current;

        expect(all.column?.id).toBe("tenant");
        expect(all.filter?.options).toEqual([{ value: "acme", label: "Acme GmbH" }]);
        expect(all.nameOf("acme")).toBe("Acme GmbH");
        expect(inTenant.column).toBeNull();
        expect(inTenant.filter).toBeNull();
    });

    it("opens a row in its tenant in All tenants, and in place inside a tenant", async () => {
        const here = vi.fn();
        const all = renderHook(() => useOpenRecord(), { wrapper: within(ALL) }).result.current;
        const inTenant = renderHook(() => useOpenRecord(), { wrapper: within(IN_ACME) }).result.current;

        await act(async () => all("acme", "/dashboard/jobs?job=a", here));
        inTenant("acme", "/dashboard/jobs?job=a", here);

        expect(mocks.switchTenant).toHaveBeenCalledExactlyOnceWith("acme");
        expect(mocks.push).toHaveBeenCalledExactlyOnceWith("/dashboard/jobs?job=a");
        expect(here).toHaveBeenCalledOnce();
    });

    it("asks for the tenant before a new record in All tenants, and opens the form at once inside a tenant", () => {
        const onCreate = vi.fn();
        const options = { canCreate: false, title: "New job", description: "A job belongs to one tenant, pick the one it runs in.", href: "/dashboard/jobs?new=1", onCreate };
        const all = renderHook(() => useNewInTenant(options), { wrapper: within(ALL) }).result.current;
        const inTenant = renderHook(() => useNewInTenant({ ...options, canCreate: true }), { wrapper: within(IN_ACME) }).result.current;
        const mayNot = renderHook(() => useNewInTenant(options), { wrapper: within(IN_ACME) }).result.current;

        expect(all.available).toBe(true);
        expect(all.dialog).not.toBeNull();
        inTenant.start();
        expect(onCreate).toHaveBeenCalledOnce();
        expect(inTenant.dialog).toBeNull();
        expect(mayNot.available).toBe(false);
    });

    it("opens the form of a new record once the page asks for it with ?new=1, and takes it off the address", () => {
        const open = vi.fn();
        mocks.params = new URLSearchParams("tab=databases&new=1");
        window.history.replaceState(null, "", "/dashboard/connections?tab=databases&new=1");
        const { rerender } = renderHook(({ ready }) => useNewFromLink(ready, open), { initialProps: { ready: false } });

        expect(open).not.toHaveBeenCalled();
        rerender({ ready: true });
        rerender({ ready: true });

        expect(open).toHaveBeenCalledOnce();
        expect(window.location.search).toBe("?tab=databases");
    });
});

describe("the page of a record in All tenants", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.params = new URLSearchParams("id=r1");
    });

    it("offers to open the record in its tenant", () => {
        render(<AllTenantsNotice tenantId="acme" />, { wrapper: within(ALL) });

        expect(screen.getByText("You look at this in All tenants")).toBeTruthy();
        expect(screen.getByRole("button", { name: /Open in Acme GmbH/ })).toBeTruthy();
    });

    it("says nothing inside a tenant or before the record loaded", () => {
        const { container } = render(<AllTenantsNotice tenantId="acme" />, { wrapper: within(IN_ACME) });
        const loading = render(<AllTenantsNotice tenantId={null} />, { wrapper: within(ALL) });

        expect(container.innerHTML).toBe("");
        expect(loading.container.innerHTML).toBe("");
    });
});
