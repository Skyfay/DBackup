import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TenantsClient } from "@/components/dashboard/tenants/tenants-client";
import type { TenantListRow } from "@/components/dashboard/tenants/tenant-words";

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
    usePathname: () => "/dashboard/platform/tenants",
    useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/auth/client", () => ({ useSession: () => ({ data: null, isPending: false }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/actions/tenant/tenant", () => ({ switchTenant: vi.fn(), createTenant: vi.fn(), renameTenant: vi.fn(), deleteTenant: vi.fn() }));
const getTenantMembers = vi.fn();
vi.mock("@/app/actions/tenant/members", () => ({ getTenantMembers: (id: string) => getTenantMembers(id), setTenantMember: vi.fn(), setPlatformAdmin: vi.fn() }));

// cmdk and the table scroll entries into view, which jsdom does not draw.
Element.prototype.scrollIntoView = vi.fn();

const ROWS: TenantListRow[] = [
    { id: "default", name: "Platform", isHome: true, logo: null, members: 2, connections: 3, jobs: 4, createdAt: "2026-01-01T00:00:00.000Z", databases: 6, health: null },
    { id: "t-acme", name: "Acme", isHome: false, logo: null, members: 1, connections: 0, jobs: 1, createdAt: "2026-10-01T00:00:00.000Z", databases: 0, health: "failed" },
];

describe("the Tenants page", () => {
    beforeEach(() => {
        getTenantMembers.mockReset();
    });

    it("lists every tenant with the home tenant and the one the viewer works in marked", () => {
        render(<TenantsClient rows={ROWS} activeTenantId="default" viewerId="u1" canManage viewerPlatformAdmin />);

        expect(screen.getByRole("button", { name: "New tenant" })).toBeInTheDocument();
        expect(screen.getByText("Home")).toBeInTheDocument();
        expect(screen.getByText("You work here")).toBeInTheDocument();
        // Open only for the tenant the viewer does not work in.
        expect(screen.getAllByRole("button", { name: "Open" })).toHaveLength(1);
        // A tenant whose newest backup of a job failed says so beside its name.
        expect(screen.getAllByText("The newest backup of a job failed").length).toBeGreaterThan(0);
    });

    it("opens every tenant from All tenants, where the viewer works in none", () => {
        render(<TenantsClient rows={ROWS} activeTenantId={null} viewerId="u1" canManage viewerPlatformAdmin />);

        expect(screen.getAllByRole("button", { name: "Open" })).toHaveLength(2);
        expect(screen.queryByText("You work here")).not.toBeInTheDocument();
    });

    it("shows the members of a tenant with their group, and offers the accounts that are no member yet", async () => {
        getTenantMembers.mockResolvedValue({
            success: true,
            data: {
                members: [{ id: "u1", name: "Manu", email: "manu@example.com", image: null, group: { id: "g-admin", name: "Admin" }, platformAdmin: true }],
                accounts: [
                    { id: "u1", name: "Manu", email: "manu@example.com", platformAdmin: true },
                    { id: "u2", name: "Lena", email: "lena@example.com", platformAdmin: false },
                ],
                groups: [{ id: "g-admin", name: "Admin", fullAccess: true }, { id: "g-ops", name: "Operators", fullAccess: false }],
            },
        });
        render(<TenantsClient rows={ROWS} activeTenantId="default" viewerId="u1" canManage viewerPlatformAdmin />);

        await userEvent.click(screen.getByRole("button", { name: "Acme" }));
        const dialog = await screen.findByRole("dialog", { name: "Members of Acme" });

        expect(getTenantMembers).toHaveBeenCalledWith("t-acme");
        expect(await within(dialog).findByText("manu@example.com")).toBeInTheDocument();
        expect(within(dialog).getByRole("combobox", { name: "Group of Manu: Admin" })).toBeInTheDocument();

        await userEvent.click(within(dialog).getByRole("combobox", { name: "Add member" }));
        const options = (await screen.findAllByRole("option")).map((option) => option.textContent);
        expect(options.some((text) => text?.includes("Lena"))).toBe(true);
        expect(options.some((text) => text?.includes("Manu"))).toBe(false);
    });
});
