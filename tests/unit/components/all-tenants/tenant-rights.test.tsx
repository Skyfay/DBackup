import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { TenantNamesProvider, TenantViewProvider, type TenantView, type ViewTenant } from "@/components/tenant/tenant-view";

const mocks = vi.hoisted(() => ({
    params: new URLSearchParams(),
    push: vi.fn(),
    refresh: vi.fn(),
    switchTenant: vi.fn(),
    error: vi.fn(),
}));

vi.mock("next/navigation", () => ({
    useSearchParams: () => mocks.params,
    useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
    usePathname: () => "/dashboard/jobs",
}));
vi.mock("@/app/actions/tenant/tenant", () => ({ switchTenant: (...args: unknown[]) => mocks.switchTenant(...args) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: (...args: unknown[]) => mocks.error(...args), info: vi.fn() } }));

const { useNewInTenant } = await import("@/components/tenant/tenant-actions");
const { newRecordPermission } = await import("@/components/tenant/new-record");
const { useNewFromLink } = await import("@/hooks/use-new-from-link");
const { useTenantColumns } = await import("@/components/tenant/tenant-column");
const { useMayOpenTenant, useOpenInTenant, useTenantName } = await import("@/components/tenant/tenant-view");

/** Support of the MSP: may add jobs at Acme only, and see the rest. */
const TENANTS: ViewTenant[] = [
    { id: "default", name: "Skyfay", writes: [] },
    { id: "acme", name: "Acme GmbH", writes: ["jobs:write"] },
    { id: "globex", name: "Globex", writes: ["groups:write"] },
];
const SUPPORT_ALL: TenantView = { tenants: TENANTS, activeTenantId: null, allTenants: true, isPlatformAdmin: false };
const ADMIN_ALL: TenantView = { tenants: TENANTS.map(({ id, name }) => ({ id, name })), activeTenantId: null, allTenants: true, isPlatformAdmin: true };
const IN_ACME: TenantView = { ...SUPPORT_ALL, activeTenantId: "acme", allTenants: false };

const within = (view: TenantView, names: { id: string; name: string }[] = []) => function Wrapper({ children }: { children: ReactNode }) {
    return (
        <TenantViewProvider value={view}>
            <TenantNamesProvider names={names}>{children}</TenantNamesProvider>
        </TenantViewProvider>
    );
};

const options = (href: string) => ({ canCreate: false, title: "New job", description: "A job belongs to one tenant, pick the one it runs in.", href, onCreate: vi.fn() });

beforeEach(() => {
    vi.clearAllMocks();
    mocks.params = new URLSearchParams();
});

describe("New in All tenants", () => {
    it("knows the right each form of a new record needs", () => {
        expect(newRecordPermission("/dashboard/jobs?new=1")).toBe("jobs:write");
        expect(newRecordPermission("/dashboard/connections?tab=databases&new=1")).toBe("sources:write");
        expect(newRecordPermission("/dashboard/connections?tab=directory-sources&new=1")).toBe("destinations:write");
        expect(newRecordPermission("/dashboard/connections?tab=notifications&new=1")).toBe("notifications:write");
        expect(newRecordPermission("/dashboard/users?tab=users&new=1")).toBe("users:write");
        expect(newRecordPermission("/dashboard/users?tab=apikeys&new=1")).toBe("api-keys:write");
        expect(newRecordPermission("/dashboard/vault?new=1")).toBeNull();
    });

    it("offers New only while the viewer may add that kind of record in some tenant", () => {
        const job = renderHook(() => useNewInTenant(options("/dashboard/jobs?new=1")), { wrapper: within(SUPPORT_ALL) }).result.current;
        const database = renderHook(() => useNewInTenant(options("/dashboard/connections?tab=databases&new=1")), { wrapper: within(SUPPORT_ALL) }).result.current;

        expect(job.available).toBe(true);
        expect(database.available).toBe(false);
    });

    it("lists only the tenants the viewer may add the record in once the pick opens", () => {
        function NewJob() {
            const newJob = useNewInTenant(options("/dashboard/jobs?new=1"));
            return (
                <>
                    <button type="button" onClick={newJob.start}>New job</button>
                    {newJob.dialog}
                </>
            );
        }
        Element.prototype.scrollIntoView = vi.fn();
        render(<NewJob />, { wrapper: within(SUPPORT_ALL) });

        act(() => screen.getByRole("button", { name: "New job" }).click());

        expect(screen.getByText("Acme GmbH")).toBeTruthy();
        expect(screen.queryByText("Globex")).toBeNull();
        expect(screen.queryByText("Skyfay")).toBeNull();
    });

    it("offers every tenant to a platform admin, and keeps the own right inside a tenant", () => {
        const admin = renderHook(() => useNewInTenant(options("/dashboard/connections?tab=databases&new=1")), { wrapper: within(ADMIN_ALL) }).result.current;
        const inTenant = renderHook(() => useNewInTenant({ ...options("/dashboard/jobs?new=1"), canCreate: false }), { wrapper: within(IN_ACME) }).result.current;

        expect(admin.available).toBe(true);
        expect(inTenant.available).toBe(false);
    });

    it("opens the form of the link only once the page shows the picked tenant, not on the page of All tenants it leaves", () => {
        const open = vi.fn();
        mocks.params = new URLSearchParams("new=1");
        window.history.replaceState(null, "", "/dashboard/jobs?new=1");

        renderHook(() => useNewFromLink(true, open), { wrapper: within(SUPPORT_ALL) });
        expect(open).not.toHaveBeenCalled();
        expect(window.location.search).toBe("?new=1");

        renderHook(() => useNewFromLink(true, open), { wrapper: within(IN_ACME) });
        expect(open).toHaveBeenCalledOnce();
        expect(window.location.search).toBe("");
    });
});

describe("the tenants on the lists of the Platform", () => {
    const SCOPED: TenantView = { tenants: [{ id: "acme", name: "Acme GmbH" }], activeTenantId: "acme", allTenants: false, isPlatformAdmin: false };
    const EVERY = [{ id: "acme", name: "Acme GmbH" }, { id: "globex", name: "Globex" }];

    it("names a tenant the viewer may not open by its name, and opens only the ones they may", () => {
        const nameOf = renderHook(() => useTenantName(), { wrapper: within(SCOPED, EVERY) }).result.current;
        const mayOpen = renderHook(() => useMayOpenTenant(), { wrapper: within(SCOPED, EVERY) }).result.current;
        const columns = renderHook(() => useTenantColumns((row: { tenantId: string }) => row.tenantId, [{ tenantId: "acme" }, { tenantId: "globex" }], { always: true }), { wrapper: within(SCOPED, EVERY) }).result.current;

        expect(nameOf("globex")).toBe("Globex");
        expect(columns.filter?.options.map((option) => option.label)).toEqual(["Acme GmbH", "Globex"]);
        expect(mayOpen("acme")).toBe(true);
        expect(mayOpen("globex")).toBe(false);
    });

    it("keeps the id of a tenant nobody named, like one deleted meanwhile", () => {
        const nameOf = renderHook(() => useTenantName(), { wrapper: within(SCOPED) }).result.current;

        expect(nameOf("globex")).toBeNull();
    });
});

describe("a pick of a tenant that is gone meanwhile", () => {
    it("says so in the words of the server and loads the tenants again", async () => {
        mocks.switchTenant.mockResolvedValue({ success: false, error: "The tenant no longer exists, or you may not open it." });
        const openInTenant = renderHook(() => useOpenInTenant(), { wrapper: within(ADMIN_ALL) }).result.current;

        let opened = true;
        await act(async () => {
            opened = await openInTenant("globex", "/dashboard/jobs");
        });

        expect(opened).toBe(false);
        expect(mocks.error).toHaveBeenCalledWith("The tenant no longer exists, or you may not open it.");
        expect(mocks.refresh).toHaveBeenCalledOnce();
        expect(mocks.push).not.toHaveBeenCalled();
    });
});
