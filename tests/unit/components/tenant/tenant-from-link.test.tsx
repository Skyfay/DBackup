import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { TenantViewProvider, type TenantView } from "@/components/tenant/tenant-view";

const mocks = vi.hoisted(() => ({
    params: new URLSearchParams(),
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    switchTenant: vi.fn(),
}));

vi.mock("next/navigation", () => ({
    useSearchParams: () => mocks.params,
    useRouter: () => ({ push: mocks.push, replace: mocks.replace, refresh: mocks.refresh }),
    usePathname: () => "/dashboard/history/run",
}));
vi.mock("@/app/actions/tenant/tenant", () => ({ switchTenant: (...args: unknown[]) => mocks.switchTenant(...args) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { TenantFromLink, linkTenantMove } = await import("@/components/tenant/tenant-from-link");
const { useOpenFromLink } = await import("@/hooks/use-open-from-link");
const { missingRunText } = await import("@/components/dashboard/history/run-page");

const TENANTS = [{ id: "default", name: "Home" }, { id: "acme", name: "Acme GmbH" }, { id: "shop", name: "Shop AG" }];
const IN_HOME: TenantView = { tenants: TENANTS.slice(0, 2), activeTenantId: "default", allTenants: false, isPlatformAdmin: false };
const IN_ACME: TenantView = { ...IN_HOME, activeTenantId: "acme" };
const ALL: TenantView = { tenants: TENANTS, activeTenantId: null, allTenants: true, isPlatformAdmin: true };

/** The address a link of a notification opened, as the browser and Next.js both report it. */
function openAddress(query: string) {
    mocks.params = new URLSearchParams(query);
    window.history.replaceState(null, "", `/dashboard/history/run?${query}`);
}

/** Next.js follows a change of the history of the browser in useSearchParams. */
function followAddress() {
    mocks.params = new URLSearchParams(window.location.search);
}

const within = (view: TenantView) => function Wrapper({ children }: { children: ReactNode }) {
    return <TenantViewProvider value={view}>{children}</TenantViewProvider>;
};

describe("the tenant a link of a notification names", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        openAddress("");
        mocks.switchTenant.mockResolvedValue({ success: true, data: { name: "Acme GmbH" } });
    });

    it("switches only into another tenant the viewer may open, and never in All tenants", () => {
        const mayOpen = (id: string) => id !== "shop";
        expect(linkTenantMove("acme", { allTenants: false, activeTenantId: "default" }, mayOpen)).toBe("switch");
        expect(linkTenantMove("acme", { allTenants: false, activeTenantId: "acme" }, mayOpen)).toBe("drop");
        expect(linkTenantMove("shop", { allTenants: false, activeTenantId: "default" }, mayOpen)).toBe("drop");
        expect(linkTenantMove("acme", { allTenants: true, activeTenantId: null }, mayOpen)).toBe("drop");
    });

    it("switches the session into the tenant of the run, then takes the tenant off the address", async () => {
        openAddress("id=run-1&from=history&tenant=acme");
        const { rerender } = render(<TenantViewProvider value={IN_HOME}><TenantFromLink /></TenantViewProvider>);

        await waitFor(() => expect(mocks.switchTenant).toHaveBeenCalledExactlyOnceWith("acme"));
        // The same page loads in the tenant, and the address keeps naming it until the tenant shows.
        await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/dashboard/history/run?id=run-1&from=history&tenant=acme"));
        expect(window.location.search).toContain("tenant=acme");

        rerender(<TenantViewProvider value={IN_ACME}><TenantFromLink /></TenantViewProvider>);

        expect(window.location.search).toBe("?id=run-1&from=history");
        expect(mocks.switchTenant).toHaveBeenCalledOnce();
    });

    it("only takes the tenant off the address in All tenants, which reads every tenant", () => {
        openAddress("job=j1&tenant=acme");
        render(<TenantViewProvider value={ALL}><TenantFromLink /></TenantViewProvider>);

        expect(mocks.switchTenant).not.toHaveBeenCalled();
        expect(window.location.search).toBe("?job=j1");
    });

    it("leaves the session alone for a tenant the viewer may not open, or the one open already", () => {
        openAddress("open=c1&tenant=shop");
        render(<TenantViewProvider value={IN_HOME}><TenantFromLink /></TenantViewProvider>);
        expect(window.location.search).toBe("?open=c1");

        openAddress("open=c1&tenant=acme");
        render(<TenantViewProvider value={IN_ACME}><TenantFromLink /></TenantViewProvider>);
        expect(window.location.search).toBe("?open=c1");

        expect(mocks.switchTenant).not.toHaveBeenCalled();
    });

    it("stays in the tenant open and drops the tenant when the switch is refused", async () => {
        mocks.switchTenant.mockResolvedValue({ success: false, error: "That tenant is gone." });
        openAddress("id=run-1&tenant=acme");
        render(<TenantViewProvider value={IN_HOME}><TenantFromLink /></TenantViewProvider>);

        await waitFor(() => expect(window.location.search).toBe("?id=run-1"));
        expect(mocks.replace).not.toHaveBeenCalled();
    });
});

describe("a record a link opens in another tenant", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        openAddress("");
    });

    it("waits until the dashboard switched into its tenant, so the list of the tenant before never drops it", () => {
        const open = vi.fn();
        const rowsOfHome = [{ id: "other" }];
        const rowsOfAcme = [{ id: "j1" }];
        openAddress("job=j1&tenant=acme");
        let view = IN_HOME;
        const { rerender } = renderHook(({ rows }) => useOpenFromLink(rows, open, "job"), {
            initialProps: { rows: rowsOfHome },
            wrapper: ({ children }) => within(view)({ children }),
        });

        expect(open).not.toHaveBeenCalled();
        expect(window.location.search).toBe("?job=j1&tenant=acme");

        view = IN_ACME;
        act(() => rerender({ rows: rowsOfAcme }));

        expect(open).toHaveBeenCalledExactlyOnceWith(rowsOfAcme[0]);
        followAddress();
    });

    it("opens at once when the link names the tenant open already", () => {
        const open = vi.fn();
        openAddress("job=j1&tenant=acme");
        renderHook(() => useOpenFromLink([{ id: "j1" }], open, "job"), { wrapper: within(IN_ACME) });

        expect(open).toHaveBeenCalledOnce();
    });
});

describe("a run that is not found", () => {
    it("names another tenant while the instance has several and the viewer works in one", () => {
        expect(missingRunText(true)).toBe("It may belong to another tenant than the one you work in, or data retention may have removed it.");
        expect(missingRunText(false)).toBe("Data retention may have removed it.");
    });
});
