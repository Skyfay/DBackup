import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TenantViewProvider, type TenantView, type ViewTenant } from "@/components/tenant/tenant-view";
import { ALL_ALLOWED } from "@/lib/tenant/allowances";
import { PERMISSIONS } from "@/lib/auth/permissions";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), usePathname: () => "/dashboard" }));
vi.mock("@/app/actions/tenant/tenant", () => ({ switchTenant: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { quickSetupTenants, tenantsForPage } = await import("@/components/tenant/new-record");
const { TenantPickDialog } = await import("@/components/tenant/tenant-pick");

const ALL_WRITES = [PERMISSIONS.SOURCES.WRITE, PERMISSIONS.DESTINATIONS.WRITE, PERMISSIONS.JOBS.WRITE];

/** Acme may do all of it, Shop adds no databases itself, Viewer lets the viewer write no job. */
const TENANTS: ViewTenant[] = [
    { id: "acme", name: "Acme GmbH", writes: ALL_WRITES, allowances: ALL_ALLOWED },
    { id: "shop", name: "Shop AG", writes: ALL_WRITES, allowances: { ...ALL_ALLOWED, databases: false } },
    { id: "viewer", name: "Viewer Ltd", writes: [PERMISSIONS.SOURCES.WRITE, PERMISSIONS.DESTINATIONS.WRITE], allowances: ALL_ALLOWED },
];

describe("the tenants Quick Setup opens in from All tenants", () => {
    beforeAll(() => {
        Element.prototype.scrollIntoView = vi.fn();
    });
    beforeEach(() => vi.clearAllMocks());

    it("are those where the viewer writes sources, destinations and jobs and that add databases themselves", () => {
        expect(quickSetupTenants(TENANTS, false).map((tenant) => tenant.id)).toEqual(["acme"]);
        // A platform admin writes everywhere, the allowances of a tenant still count.
        expect(quickSetupTenants(TENANTS, true).map((tenant) => tenant.id)).toEqual(["acme", "viewer"]);
    });

    it("leave the pick of every other page of one tenant as it is", () => {
        expect(tenantsForPage("/dashboard/setup", TENANTS, false).map((tenant) => tenant.id)).toEqual(["acme"]);
        expect(tenantsForPage("/dashboard/vault?tab=keys", TENANTS, false)).toHaveLength(3);
    });

    it("are the only ones the pick of Quick Setup lists", () => {
        const view: TenantView = { tenants: TENANTS, activeTenantId: null, allTenants: true, isPlatformAdmin: false };
        render(
            <TenantViewProvider value={view}>
                <TenantPickDialog open onOpenChange={vi.fn()} title="Quick Setup" description="Pick the tenant." href="/dashboard/setup" />
            </TenantViewProvider>
        );

        expect(screen.getByText("Acme GmbH")).toBeInTheDocument();
        expect(screen.queryByText("Shop AG")).not.toBeInTheDocument();
        expect(screen.queryByText("Viewer Ltd")).not.toBeInTheDocument();
    });
});
