import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { TenantViewProvider } from "@/components/tenant/tenant-view";
import { SidebarProvider } from "@/components/ui/sidebar";

const push = vi.fn();
const refresh = vi.fn();
let pathname = "/dashboard/jobs";

vi.mock("next/navigation", () => ({ usePathname: () => pathname, useRouter: () => ({ push, refresh }) }));
vi.mock("next/image", () => ({
    // eslint-disable-next-line @next/next/no-img-element
    default: ({ alt, priority: _priority, ...props }: Record<string, unknown>) => <img alt={alt as string} {...props} />,
}));
vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "system", setTheme: vi.fn() }) }));
vi.mock("@/lib/auth/client", () => ({
    useSession: () => ({ data: { user: { name: "Manu", email: "manu@example.com", image: null } }, isPending: false }),
    signOut: vi.fn(),
}));
const switchTenant = vi.fn();
const getTenantSummaries = vi.fn();
vi.mock("@/app/actions/tenant/tenant", () => ({
    switchTenant: (id: string) => switchTenant(id),
    getTenantSummaries: () => getTenantSummaries(),
    createTenant: vi.fn(),
    renameTenant: vi.fn(),
    deleteTenant: vi.fn(),
}));
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: (message: string) => toastError(message), info: vi.fn() } }));

// cmdk scrolls the highlighted entry into view, which jsdom does not draw.
Element.prototype.scrollIntoView = vi.fn();

const HOME = { id: "default", name: "Platform" };
const ACME = { id: "t-acme", name: "Acme Corp" };

interface Viewer {
    tenants: { id: string; name: string }[];
    activeTenantId?: string | null;
    isPlatformAdmin?: boolean;
    allTenants?: boolean;
    tenantCount?: number;
    permissions?: string[];
    tenantAccess?: { opensAll: boolean; see: boolean; create: boolean };
}

const sidebar = ({ tenants, activeTenantId = "default", isPlatformAdmin = false, allTenants = false, tenantCount = tenants.length, permissions, tenantAccess }: Viewer) =>
    render(
        <SidebarProvider>
            <AppSidebar
                currentVersion="4.1.0"
                tenants={tenants}
                activeTenantId={activeTenantId}
                isPlatformAdmin={isPlatformAdmin}
                allTenants={allTenants}
                tenantCount={tenantCount}
                permissions={permissions}
                tenantAccess={tenantAccess}
            />
        </SidebarProvider>
    );

const headButton = () => screen.getByRole("button", { name: /Switch the tenant|Tenants$/ });

describe("the head of the sidebar as the tenant switcher", () => {
    beforeEach(() => {
        push.mockReset();
        refresh.mockReset();
        switchTenant.mockReset();
        getTenantSummaries.mockReset();
        getTenantSummaries.mockResolvedValue({ success: true, data: [] });
        pathname = "/dashboard/jobs";
    });

    it("stays a link to the Overview while the viewer may open one tenant only", () => {
        sidebar({ tenants: [HOME] });

        expect(screen.queryByRole("button", { name: /Switch the tenant/ })).not.toBeInTheDocument();
        expect(screen.getByRole("link", { name: /DBackup Logo/ })).toHaveAttribute("href", "/dashboard");
    });

    it("tells a customer of several tenants that these are their backups, without a switch", () => {
        sidebar({ tenants: [ACME], activeTenantId: "t-acme", tenantCount: 14 });

        expect(screen.getByRole("link", { name: /DBackup Logo/ })).toHaveTextContent("Acme CorpYour backups");
    });

    it("names the tenant the viewer works in and its place once there are two", () => {
        sidebar({ tenants: [HOME, ACME], activeTenantId: "t-acme" });

        expect(headButton()).toHaveTextContent("Acme CorpTenant 2 of 2");
    });

    it("switches the session and loads the page again", async () => {
        switchTenant.mockResolvedValue({ success: true, data: { name: "Acme Corp" } });
        sidebar({ tenants: [HOME, ACME] });

        await userEvent.click(headButton());
        await userEvent.click(await screen.findByRole("option", { name: /Acme Corp/ }));

        await waitFor(() => expect(refresh).toHaveBeenCalled());
        expect(switchTenant).toHaveBeenCalledWith("t-acme");
        expect(push).not.toHaveBeenCalled();
    });

    it("says in plain words that a tenant is gone meanwhile, and loads the list of the tenants again", async () => {
        switchTenant.mockResolvedValue({ success: false, error: "The tenant no longer exists, or you may not open it." });
        sidebar({ tenants: [HOME, ACME] });

        await userEvent.click(headButton());
        await userEvent.click(await screen.findByRole("option", { name: /Acme Corp/ }));

        await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
        expect(toastError).toHaveBeenCalledWith("The tenant no longer exists, or you may not open it.");
    });

    it("tells the other tabs of the browser which tenant the session works in now", async () => {
        switchTenant.mockResolvedValue({ success: true, data: { name: "Acme Corp" } });
        const heard: unknown[] = [];
        const otherTab = new BroadcastChannel("dbackup:tenant");
        otherTab.onmessage = (event) => heard.push(event.data);
        sidebar({ tenants: [HOME, ACME] });

        await userEvent.click(headButton());
        await userEvent.click(await screen.findByRole("option", { name: /Acme Corp/ }));

        await waitFor(() => expect(heard).toEqual([expect.objectContaining({ tenantId: "t-acme", name: "Acme Corp" })]));
        otherTab.close();
    });

    it("leads from the page of a run to the Overview", async () => {
        pathname = "/dashboard/history/run";
        switchTenant.mockResolvedValue({ success: true, data: { name: "Acme Corp" } });
        sidebar({ tenants: [HOME, ACME] });

        await userEvent.click(headButton());
        await userEvent.click(await screen.findByRole("option", { name: /Acme Corp/ }));

        await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
    });

    it("offers a member of several tenants only their tenants, without All tenants, counts or the platform's entries", async () => {
        sidebar({ tenants: [HOME, ACME] });

        await userEvent.click(headButton());
        const options = (await screen.findAllByRole("option")).map((option) => option.textContent ?? "");

        expect(options).toHaveLength(2);
        expect(options.some((text) => text.includes("All tenants"))).toBe(false);
        expect(screen.queryByRole("option", { name: /New tenant/ })).not.toBeInTheDocument();
        expect(getTenantSummaries).not.toHaveBeenCalled();
    });

    it("counts the tenants in All tenants and shows each with its jobs, databases and a dot when a backup failed", async () => {
        getTenantSummaries.mockResolvedValue({
            success: true,
            data: [
                { id: "default", jobs: 4, databases: 12, health: null },
                { id: "t-acme", jobs: 1, databases: 2, health: "failed" },
            ],
        });
        sidebar({ tenants: [HOME, ACME], activeTenantId: null, allTenants: true, isPlatformAdmin: true });

        expect(headButton()).toHaveTextContent("All tenants2 tenants");
        await userEvent.click(headButton());

        const acme = await screen.findByRole("option", { name: /Acme Corp/ });
        await waitFor(() => expect(acme).toHaveTextContent("1 job · 2 databases"));
        expect(within(acme).getByText(/The newest backup of a job failed/)).toBeInTheDocument();
        expect(screen.getByRole("option", { name: /Platform/ })).toHaveTextContent("Home · 4 jobs · 12 databases");
        expect(screen.getByRole("option", { name: /All tenants/ })).toHaveTextContent(/open now/);
    });

    it("switches a platform admin into All tenants from a tenant", async () => {
        switchTenant.mockResolvedValue({ success: true, data: { name: "All tenants" } });
        sidebar({ tenants: [HOME, ACME], activeTenantId: "t-acme", isPlatformAdmin: true });

        await userEvent.click(headButton());
        await userEvent.click(await screen.findByRole("option", { name: /All tenants/ }));

        await waitFor(() => expect(switchTenant).toHaveBeenCalledWith("*"));
    });

    it("leads from the Vault into All tenants to the Overview, since All tenants has no Vault", async () => {
        pathname = "/dashboard/vault";
        switchTenant.mockResolvedValue({ success: true, data: { name: "All tenants" } });
        sidebar({ tenants: [HOME, ACME], activeTenantId: "t-acme", isPlatformAdmin: true });

        await userEvent.click(headButton());
        await userEvent.click(await screen.findByRole("option", { name: /All tenants/ }));

        await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
    });

    it("leads a platform admin to the page of the tenants from Manage tenants", async () => {
        sidebar({ tenants: [HOME, ACME], isPlatformAdmin: true });

        await userEvent.click(headButton());
        await userEvent.click(await screen.findByRole("option", { name: /Manage tenants/ }));

        expect(push).toHaveBeenCalledWith("/dashboard/platform/tenants");
    });

    it("opens New tenant for a platform admin, also while the instance has one tenant", async () => {
        sidebar({ tenants: [HOME], isPlatformAdmin: true });

        // One tenant shows no arrows of a switch, but the menu holds the platform's entries.
        expect(headButton()).toHaveTextContent("DBackupv4.1.0");
        await userEvent.click(headButton());
        await userEvent.click(await screen.findByRole("option", { name: /New tenant/ }));

        expect(await screen.findByRole("dialog", { name: "New tenant" })).toBeInTheDocument();
    });
});

describe("the head of the sidebar for someone of a platform group", () => {
    beforeEach(() => {
        push.mockReset();
        getTenantSummaries.mockReset();
        getTenantSummaries.mockResolvedValue({ success: true, data: [{ id: "default", jobs: 4, databases: 12, health: null }, { id: "t-acme", jobs: 1, databases: 2, health: null }] });
    });

    it("offers All tenants, the numbers and Manage tenants to a group that reaches every tenant and sees the tenants, but never New tenant", async () => {
        sidebar({ tenants: [HOME, ACME], activeTenantId: "t-acme", tenantAccess: { opensAll: true, see: true, create: false } });

        await userEvent.click(headButton());

        expect(await screen.findByRole("option", { name: /All tenants/ })).toBeInTheDocument();
        expect(screen.getByRole("option", { name: /Manage tenants/ })).toBeInTheDocument();
        expect(screen.queryByRole("option", { name: /New tenant/ })).not.toBeInTheDocument();
        await waitFor(() => expect(screen.getByRole("option", { name: /Acme Corp/ })).toHaveTextContent("1 job · 2 databases"));
    });

    it("offers no All tenants to a group of some tenants, which would show the others too, and no numbers without the right to see the tenants", async () => {
        sidebar({ tenants: [HOME, ACME], activeTenantId: "t-acme", tenantAccess: { opensAll: false, see: false, create: false } });

        await userEvent.click(headButton());

        expect(await screen.findByRole("option", { name: /Platform/ })).toBeInTheDocument();
        expect(screen.queryByRole("option", { name: /All tenants/ })).not.toBeInTheDocument();
        expect(screen.queryByRole("option", { name: /Manage tenants/ })).not.toBeInTheDocument();
        expect(getTenantSummaries).not.toHaveBeenCalled();
    });

    it("shows Platform as the last section below Administration, with what the rights of a platform group open", () => {
        sidebar({ tenants: [HOME, ACME], tenantCount: 3, permissions: ["platform-tenants:read"], tenantAccess: { opensAll: false, see: true, create: false } });

        const labels = [...document.querySelectorAll('[data-sidebar="group-label"]')].map((label) => label.textContent);
        expect(labels.at(-1)).toBe("Platform");
        expect(screen.queryByText(/all \d+ tenants|through /)).not.toBeInTheDocument();
        const platform = screen.getByText("Platform", { selector: '[data-sidebar="group-label"]' }).closest<HTMLElement>('[data-sidebar="group"]')!;
        expect(within(platform).getByRole("link", { name: /Tenants/ })).toBeInTheDocument();
        expect(within(platform).queryByRole("link", { name: /Users & Groups/ })).not.toBeInTheDocument();
    });
});

describe("the entries of the sidebar that belong to one tenant, in All tenants", () => {
    beforeEach(() => {
        push.mockReset();
        refresh.mockReset();
        switchTenant.mockReset();
        pathname = "/dashboard";
    });

    const allTenantsSidebar = (allTenants: boolean) =>
        render(
            <TenantViewProvider value={{ tenants: [HOME, ACME], activeTenantId: allTenants ? null : "t-acme", allTenants, isPlatformAdmin: true, tenantCount: 2 }}>
                <SidebarProvider>
                    <AppSidebar tenants={[HOME, ACME]} activeTenantId={allTenants ? null : "t-acme"} isPlatformAdmin allTenants={allTenants} tenantCount={2} />
                </SidebarProvider>
            </TenantViewProvider>
        );

    it("asks for the tenant right where the Vault is clicked, instead of leading to a page that cannot show it", async () => {
        switchTenant.mockResolvedValue({ success: true, data: { name: "Acme Corp" } });
        allTenantsSidebar(true);

        expect(screen.queryByRole("link", { name: "Vault" })).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: "Vault" }));

        const dialog = await screen.findByRole("dialog", { name: "Vault" });
        await userEvent.click(within(dialog).getByRole("option", { name: /Acme Corp/ }));
        await waitFor(() => expect(switchTenant).toHaveBeenCalledWith("t-acme"));
        expect(push).toHaveBeenCalledWith("/dashboard/vault");
    });

    it("keeps the entries of every tenant and of the platform as links", () => {
        allTenantsSidebar(true);

        expect(screen.getByRole("link", { name: "Jobs" })).toHaveAttribute("href", "/dashboard/jobs");
        expect(screen.getByRole("link", { name: "Tenants" })).toHaveAttribute("href", "/dashboard/platform/tenants");
        for (const name of ["Templates", "Users & Groups", "Settings"]) {
            expect(screen.getAllByRole("button", { name }).length).toBeGreaterThan(0);
        }
    });

    it("leads straight to the Vault in a tenant", () => {
        allTenantsSidebar(false);

        expect(screen.getByRole("link", { name: "Vault" })).toHaveAttribute("href", "/dashboard/vault");
    });
});
