import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { AllowanceCell, OnDemandCell, ProvidedCell } from "@/components/dashboard/tenants/tenant-columns";
import { TenantsClient } from "@/components/dashboard/tenants/tenants-client";
import type { TenantListRow } from "@/components/dashboard/tenants/tenant-words";
import { ALL_ALLOWED } from "@/lib/tenant/allowances";

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
    usePathname: () => "/dashboard/platform/tenants",
    useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/auth/client", () => ({ useSession: () => ({ data: null, isPending: false }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const setTenantAllowances = vi.fn();
vi.mock("@/app/actions/tenant/tenant", () => ({
    switchTenant: vi.fn(),
    createTenant: vi.fn(),
    renameTenant: vi.fn(),
    deleteTenant: vi.fn(),
    setTenantSharing: vi.fn(),
    setTenantAllowances: (...args: unknown[]) => setTenantAllowances(...args),
}));
vi.mock("@/app/actions/tenant/tenant-on-demand", () => ({
    getTenantOnDemand: vi.fn(async () => ({ success: true, data: { name: "Acme", perDay: null, overrides: [] } })),
    setTenantOnDemand: vi.fn(),
    followTenantOnDemand: vi.fn(),
}));
const getTenantMembers = vi.fn();
vi.mock("@/app/actions/tenant/members", () => ({ getTenantMembers: (id: string) => getTenantMembers(id), setTenantMember: vi.fn(), setPlatformAdmin: vi.fn() }));

// cmdk and the table scroll entries into view, which jsdom does not draw.
Element.prototype.scrollIntoView = vi.fn();

const ROWS: TenantListRow[] = [
    {
        id: "default", name: "Platform", isHome: true, sharesWithCustomers: true, logo: null, members: 2, connections: 3, jobs: 4, createdAt: "2026-01-01T00:00:00.000Z", databases: 6, health: null,
        allowances: ALL_ALLOWED, provided: { destinations: 0, channels: 0 }, gives: { destinations: 2, channels: 1 }, onDemand: { perDay: null, own: 0 },
    },
    {
        id: "t-acme", name: "Acme", isHome: false, sharesWithCustomers: false, logo: null, members: 1, connections: 0, jobs: 1, createdAt: "2026-10-01T00:00:00.000Z", databases: 0, health: "failed",
        allowances: { ...ALL_ALLOWED, destinations: false, channels: false }, provided: { destinations: 2, channels: 2 }, gives: { destinations: 0, channels: 0 }, onDemand: { perDay: null, own: 0 },
    },
];

/** The row of a tenant in the table, found by the button on its name. */
const rowOf = (name: string) => screen.getByRole("button", { name }).closest("tr") as HTMLElement;

describe("the Tenants page", () => {
    beforeEach(() => {
        getTenantMembers.mockReset();
        setTenantAllowances.mockReset();
        vi.mocked(toast.success).mockReset();
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
        const dialog = await screen.findByRole("dialog", { name: "Edit Acme" });
        await userEvent.click(within(dialog).getByRole("tab", { name: "Members" }));

        expect(getTenantMembers).toHaveBeenCalledWith("t-acme");
        expect(await within(dialog).findByText("manu@example.com")).toBeInTheDocument();
        expect(within(dialog).getByRole("combobox", { name: "Group of Manu: Admin" })).toBeInTheDocument();

        await userEvent.click(within(dialog).getByRole("combobox", { name: "Add member" }));
        const options = (await screen.findAllByRole("option")).map((option) => option.textContent);
        expect(options.some((text) => text?.includes("Lena"))).toBe(true);
        expect(options.some((text) => text?.includes("Manu"))).toBe(false);
    });

    it("shows what other tenants share with a tenant and what it may not add itself", () => {
        render(<TenantsClient rows={ROWS} activeTenantId="default" viewerId="u1" canManage viewerPlatformAdmin />);

        expect(screen.getByRole("columnheader", { name: "Provided to it" })).toBeInTheDocument();
        expect(screen.getByRole("columnheader", { name: "May add itself" })).toBeInTheDocument();
        const acme = rowOf("Acme");
        expect(within(acme).getByText("2 destinations")).toBeInTheDocument();
        expect(within(acme).getByText("2 channels")).toBeInTheDocument();
        expect(within(acme).getByText("No own destinations, channels")).toBeInTheDocument();
        // The home tenant gets nothing, so it says what it gives, and it adds everything.
        const home = rowOf("Platform");
        expect(within(home).getByText("Gives 2 destinations, 1 channel")).toBeInTheDocument();
        expect(within(home).getByText("Everything")).toBeInTheDocument();
    });

    it("decides what a customer may add in Edit of it, and saves only what changed", async () => {
        const user = userEvent.setup();
        setTenantAllowances.mockResolvedValue({ success: true });
        render(<TenantsClient rows={ROWS} activeTenantId="default" viewerId="u1" canManage viewerPlatformAdmin />);

        await user.click(screen.getByRole("button", { name: "Open menu for Acme" }));
        await user.click(await screen.findByRole("menuitem", { name: /^Edit/ }));
        const dialog = await screen.findByRole("dialog", { name: "Edit Acme" });
        await user.click(within(dialog).getByRole("tab", { name: "What it may add" }));
        expect(within(dialog).getByText("2 destinations and 2 channels of other tenants")).toBeInTheDocument();
        expect(within(dialog).getByRole("switch", { name: "Destinations" })).not.toBeChecked();
        expect(within(dialog).queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();

        await user.click(within(dialog).getByRole("switch", { name: "Destinations" }));
        expect(within(dialog).getByText("Changed: what it may add")).toBeInTheDocument();
        await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

        await waitFor(() => expect(setTenantAllowances).toHaveBeenCalledWith("t-acme", { destinations: true }));
        expect(toast.success).toHaveBeenCalledWith("Acme saved");
    });

    it("never offers to limit the home tenant or its backups on demand, and keeps its sharing on", async () => {
        const user = userEvent.setup();
        render(<TenantsClient rows={ROWS} activeTenantId="default" viewerId="u1" canManage viewerPlatformAdmin />);

        await user.click(screen.getByRole("button", { name: "Open menu for Platform" }));
        await user.click(await screen.findByRole("menuitem", { name: /^Edit/ }));
        const dialog = await screen.findByRole("dialog", { name: "Edit Platform" });
        expect(within(dialog).getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["General", "Members", "Sharing"]);
        await user.click(within(dialog).getByRole("tab", { name: "Sharing" }));
        expect(within(dialog).getByRole("switch", { name: "Shares with customers" })).toBeDisabled();
    });
});

describe("the cells of what a tenant gets and adds", () => {
    it("shows a muted dash for a tenant that neither gets nor gives anything", () => {
        render(<ProvidedCell row={{ provided: { destinations: 0, channels: 0 }, gives: { destinations: 0, channels: 0 } }} />);

        expect(screen.getByText("-")).toHaveClass("text-muted-foreground");
    });

    it("counts only the kinds other tenants share with it, in the singular and the plural", () => {
        render(<ProvidedCell row={{ provided: { destinations: 1, channels: 0 }, gives: { destinations: 3, channels: 0 } }} />);

        expect(screen.getByText("1 destination")).toBeInTheDocument();
        expect(screen.queryByText(/channel/)).not.toBeInTheDocument();
        expect(screen.queryByText(/Gives/)).not.toBeInTheDocument();
    });

    it("says how many backups on demand a customer may start of each database, and how many set their own", () => {
        const { rerender } = render(<OnDemandCell row={{ isHome: false, onDemand: { perDay: 3, own: 2 } }} />);
        expect(screen.getByText("3 a day per database")).toBeInTheDocument();
        expect(screen.getByText("2 set on their own")).toBeInTheDocument();

        rerender(<OnDemandCell row={{ isHome: false, onDemand: { perDay: null, own: 0 } }} />);
        expect(screen.getByText("Off")).toBeInTheDocument();
        expect(screen.queryByText(/on their own|on its own/)).not.toBeInTheDocument();
    });

    it("says Everything for a tenant without limits, and names a limit with a lock and in full on hover", () => {
        const { rerender } = render(<AllowanceCell row={{ isHome: false, allowances: ALL_ALLOWED }} />);
        expect(screen.getByText("Everything")).toBeInTheDocument();

        rerender(<AllowanceCell row={{ isHome: false, allowances: { ...ALL_ALLOWED, databases: false } }} />);
        expect(screen.getByText("No own databases")).toHaveAttribute("title", "Adds no database connections of its own.");
    });
});
