/**
 * The empty Database Explorer of a tenant the platform adds the database connections for says who
 * adds them, instead of pointing to the Connections page where the tenant may add none.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TenantViewProvider } from "@/components/tenant/tenant-view";
import { ALL_ALLOWED } from "@/lib/tenant/allowances";
import { overview, serve } from "./database-fixtures";

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    useSearchParams: () => new URLSearchParams(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/auth/client", () => ({
    useSession: () => ({ data: { user: { timezone: "UTC", dateFormat: "yyyy-MM-dd", timeFormat: "HH:mm" } } }),
}));
vi.mock("@/app/actions/auth/table-preferences", () => ({ saveViewLayout: vi.fn().mockResolvedValue({ success: true }) }));

const { DatabaseExplorer } = await import("@/components/dashboard/explorer/database-explorer");

function page(addsDatabases: boolean) {
    render(
        <TenantViewProvider value={{
            tenants: [{ id: "acme", name: "Acme GmbH", allowances: { ...ALL_ALLOWED, databases: addsDatabases } }],
            activeTenantId: "acme",
            allTenants: false,
            isPlatformAdmin: false,
            platformName: "Skyfay MSP",
        }}>
            <DatabaseExplorer canOpenBackups canRestore canDownload canDelete={false} canManageVault={false} canViewHistory canExecute initialView="table" />
        </TenantViewProvider>
    );
}

describe("the empty Database Explorer", () => {
    beforeEach(() => {
        serve({ data: { ...overview, servers: [], jobs: [], databases: [] } });
    });

    it("says who adds the database connections of a tenant that may add none", async () => {
        page(false);

        expect(await screen.findByText(/Skyfay MSP adds the database connections of this tenant/)).toBeInTheDocument();
        expect(screen.queryByText(/Add a database on the Connections page/)).not.toBeInTheDocument();
    });

    it("points to the Connections page while the tenant may add one", async () => {
        page(true);

        expect(await screen.findByText(/Add a database on the Connections page/)).toBeInTheDocument();
    });
});
