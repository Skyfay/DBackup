/**
 * The Tenants page for someone of a platform group of some tenants. A membership opens a tenant,
 * but only the tenants their platform group reaches are theirs to change, and only a platform
 * admin or a platform group of all tenants reaches a new tenant. The page offers Edit, Delete and
 * New tenant only where the server lets them through.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TenantsClient } from "@/components/dashboard/tenants/tenants-client";
import { managesTenant, type TenantListRow } from "@/components/dashboard/tenants/tenant-words";
import { ALL_ALLOWED } from "@/lib/tenant/allowances";

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
    usePathname: () => "/dashboard/platform/tenants",
    useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/auth/client", () => ({ useSession: () => ({ data: null, isPending: false }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/actions/tenant/tenant", () => ({
    switchTenant: vi.fn(),
    createTenant: vi.fn(),
    renameTenant: vi.fn(),
    deleteTenant: vi.fn(),
    bulkDeleteTenants: vi.fn(),
    setTenantSharing: vi.fn(),
    setTenantAllowances: vi.fn(),
}));
vi.mock("@/app/actions/tenant/tenant-on-demand", () => ({
    getTenantOnDemand: vi.fn(async () => ({ success: true, data: { name: "Acme", perDay: null, overrides: [] } })),
    setTenantOnDemand: vi.fn(),
    followTenantOnDemand: vi.fn(),
}));
vi.mock("@/app/actions/tenant/members", () => ({ getTenantMembers: vi.fn(async () => ({ success: false, error: "The tenant no longer exists." })), setTenantMember: vi.fn(), setPlatformAdmin: vi.fn() }));

Element.prototype.scrollIntoView = vi.fn();

const row = (id: string, name: string): TenantListRow => ({
    id, name, isHome: false, sharesWithCustomers: false, logo: null, members: 0, connections: 0, jobs: 0, createdAt: "2026-10-01T00:00:00.000Z", databases: 0, health: null,
    allowances: ALL_ALLOWED, provided: { destinations: 0, channels: 0 }, gives: { destinations: 0, channels: 0 }, onDemand: { perDay: null, own: 0 }, network: { blocks: true, allowed: [] },
});

/** Acme is reached by the platform group of the viewer, Globex opens only through a membership. */
const ROWS = [row("t-acme", "Acme"), row("t-globex", "Globex")];

const menuOf = async (name: string) => {
    await userEvent.click(screen.getByRole("button", { name: `Open menu for ${name}` }));
    const entries = (await screen.findAllByRole("menuitem")).map((entry) => (entry.textContent ?? "").trim());
    await userEvent.keyboard("{Escape}");
    return entries;
};

describe("the Tenants page for a platform group of some tenants", () => {
    it("looks after a tenant only where the viewer may manage tenants and their platform group reaches it", () => {
        expect(managesTenant({ id: "t-acme" }, true, ["t-acme"])).toBe(true);
        expect(managesTenant({ id: "t-globex" }, true, ["t-acme"])).toBe(false);
        expect(managesTenant({ id: "t-globex" }, true, null)).toBe(true);
        expect(managesTenant({ id: "t-acme" }, false, null)).toBe(false);
    });

    it("offers Edit and Delete only for the tenant the platform group reaches", async () => {
        render(<TenantsClient rows={ROWS} activeTenantId={null} viewerId="nina" canManage managedIds={["t-acme"]} canCreate={false} viewerPlatformAdmin={false} />);

        const acme = await menuOf("Acme");
        expect(acme.some((text) => text.startsWith("Edit"))).toBe(true);
        expect(acme.some((text) => text.startsWith("Delete"))).toBe(true);

        const globex = await menuOf("Globex");
        expect(globex.some((text) => text.startsWith("View"))).toBe(true);
        expect(globex.some((text) => text.startsWith("Edit") || text.startsWith("Delete"))).toBe(false);
    });

    it("opens a tenant out of reach read only", async () => {
        render(<TenantsClient rows={ROWS} activeTenantId={null} viewerId="nina" canManage managedIds={["t-acme"]} canCreate={false} viewerPlatformAdmin={false} />);

        await userEvent.click(screen.getByRole("button", { name: "Globex" }));
        const dialog = await screen.findByRole("dialog", { name: "Globex" });
        expect(within(dialog).getByText("Read only")).toBeInTheDocument();
    });

    it("selects only the tenants the platform group reaches for a delete of several", () => {
        render(<TenantsClient rows={ROWS} activeTenantId={null} viewerId="nina" canManage managedIds={["t-acme"]} canCreate={false} viewerPlatformAdmin={false} />);

        const box = (name: string) => within(screen.getByRole("button", { name }).closest("tr") as HTMLElement).queryByRole("checkbox");
        expect(box("Acme")).not.toBeDisabled();
        expect(box("Globex")?.hasAttribute("disabled") ?? true).toBe(true);
    });

    it("offers New tenant only to whoever reaches a new tenant", () => {
        const { rerender } = render(<TenantsClient rows={ROWS} activeTenantId={null} viewerId="nina" canManage managedIds={["t-acme"]} canCreate={false} viewerPlatformAdmin={false} />);
        expect(screen.queryByRole("button", { name: "New tenant" })).not.toBeInTheDocument();

        rerender(<TenantsClient rows={ROWS} activeTenantId={null} viewerId="nina" canManage managedIds={null} canCreate viewerPlatformAdmin={false} />);
        expect(screen.getByRole("button", { name: "New tenant" })).toBeInTheDocument();
    });
});
