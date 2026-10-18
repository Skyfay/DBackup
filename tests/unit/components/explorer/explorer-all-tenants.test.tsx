import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TenantViewProvider, type TenantView } from "@/components/tenant/tenant-view";
import type { DatabaseOverview } from "@/services/databases/database-explorer-types";
import { destination, file, job, run, stored } from "../storage/explorer-fixtures";
import { dbRun, fetchMock, onPhone, overview, serve } from "./database-fixtures";

let search = new URLSearchParams();
let pathname = "/dashboard/explorer";
const replace = vi.fn((url: string) => {
    search = new URLSearchParams(url.split("?")[1] ?? "");
});
const push = vi.fn();
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push, replace, refresh: vi.fn() }),
    useSearchParams: () => search,
    usePathname: () => pathname,
}));
const switchTenant = vi.hoisted(() => vi.fn());
vi.mock("@/app/actions/tenant/tenant", () => ({ switchTenant }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/auth/client", () => ({
    useSession: () => ({ data: { user: { timezone: "UTC", dateFormat: "yyyy-MM-dd", timeFormat: "HH:mm" } } }),
}));
vi.mock("@/app/actions/auth/table-preferences", () => ({ saveViewLayout: vi.fn().mockResolvedValue({ success: true }) }));
vi.mock("@/components/dashboard/widgets/use-run-job", () => ({ useRunJob: () => ({ runJob: vi.fn(), startingJobId: null }) }));

import { DatabaseDayPanel, type DayPanelAccess } from "@/components/dashboard/explorer/database-day-panel";
import { DatabaseExplorer } from "@/components/dashboard/explorer/database-explorer";
import { DatabasePage } from "@/components/dashboard/explorer/database-page";
import { ServerPage } from "@/components/dashboard/explorer/server-page";

const ALL: TenantView = { tenants: [{ id: "default", name: "Home" }, { id: "acme", name: "Acme GmbH" }], activeTenantId: null, allTenants: true, isPlatformAdmin: true };
const IN_ACME: TenantView = { ...ALL, activeTenantId: "acme", allTenants: false };

// The shop cluster belongs to Acme, ERP and the cache to the home tenant.
const TENANT_OF: Record<string, string> = { s1: "acme", s2: "default", s3: "default" };
const everyTenant: DatabaseOverview = {
    ...overview,
    servers: overview.servers.map((server) => ({ ...server, tenantId: TENANT_OF[server.id] })),
    databases: overview.databases.map((database) => ({ ...database, tenantId: TENANT_OF[database.serverId] })),
};

/** What All tenants grants: every read, no restore, download, delete or run. */
const READ_ONLY: DayPanelAccess = { canOpenBackups: true, canRestore: false, canDownload: false, canDelete: false, canManageVault: false, canViewHistory: true, canExecute: false };

const inView = (view: TenantView, node: React.ReactNode) => render(<TenantViewProvider value={view}>{node}</TenantViewProvider>);
const explorer = (view: TenantView) => inView(view, <DatabaseExplorer {...READ_ONLY} initialView="table" />);

describe("the Database Explorer in All tenants", () => {
    beforeAll(() => {
        // cmdk and Radix Select scroll the highlighted row into view, which jsdom does not implement.
        Element.prototype.scrollIntoView = vi.fn();
        Element.prototype.hasPointerCapture = () => false;
        Element.prototype.releasePointerCapture = () => {};
    });

    beforeEach(() => {
        search = new URLSearchParams();
        pathname = "/dashboard/explorer";
        push.mockClear();
        replace.mockClear();
        switchTenant.mockReset().mockResolvedValue({ success: true, data: { id: "acme", name: "Acme GmbH" } });
        serve({ data: everyTenant });
    });

    it("lists the databases of every tenant with their tenant, and narrows them to one", async () => {
        const user = userEvent.setup();
        explorer(ALL);

        expect(await screen.findByRole("columnheader", { name: "Tenant" })).toBeInTheDocument();
        const shop = screen.getByRole("link", { name: "shop" }).closest("tr")!;
        expect(within(shop).getByText("Acme GmbH")).toBeInTheDocument();
        expect(within(screen.getByRole("link", { name: "erp" }).closest("tr")!).getByText("Home")).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Tenant" }));
        await user.click(await screen.findByRole("option", { name: /Acme GmbH/ }));
        await user.keyboard("{Escape}");

        // The server narrows the list, and the page asks it again.
        await waitFor(() => expect(screen.queryByRole("link", { name: "erp" })).not.toBeInTheDocument());
        expect(screen.getByRole("link", { name: "shop" })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "analytics" })).toBeInTheDocument();
        expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith("/api/databases/list?") && String(url).includes("tenant=acme"))).toBe(true);
    });

    it("opens a database in its tenant, from its name and from its menu", async () => {
        const user = userEvent.setup();
        explorer(ALL);

        await user.click(await screen.findByRole("link", { name: "shop" }));
        await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/explorer/database?server=s1&database=shop"));
        expect(switchTenant).toHaveBeenCalledWith("acme");

        switchTenant.mockClear();
        await user.click(screen.getByRole("button", { name: "Open menu for erp" }));
        expect(screen.queryByRole("menuitem", { name: "Open" })).not.toBeInTheDocument();
        await user.click(await screen.findByRole("menuitem", { name: "Open in Home" }));
        await waitFor(() => expect(switchTenant).toHaveBeenCalledWith("default"));
    });

    it("names the tenant on the card of each database on a phone", async () => {
        await onPhone(async () => {
            explorer(ALL);
            const card = await screen.findByRole("link", { name: /^shop/ });
            expect(within(card).getByText("Acme GmbH")).toBeInTheDocument();
        });
    });

    it("lists the servers of every tenant with their tenant, each opening in its tenant", async () => {
        search = new URLSearchParams("tab=servers");
        const user = userEvent.setup();
        explorer(ALL);

        // The columns change once the servers call answers, so the row is looked up by what only that call brings.
        const shop = (await screen.findByText("38 kept")).closest("tr")!;
        expect(screen.getByRole("columnheader", { name: "Tenant" })).toBeInTheDocument();
        expect(within(shop).getByText("Acme GmbH")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Tenant" })).toBeInTheDocument();

        await user.click(within(shop).getByRole("link", { name: "Shop cluster" }));
        await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/explorer/server?server=s1"));
        expect(switchTenant).toHaveBeenCalledWith("acme");
    });

    it("stays as it was inside one tenant, without a Tenant column and with Open in the menu", async () => {
        const user = userEvent.setup();
        explorer(IN_ACME);

        await screen.findByRole("link", { name: "shop" });
        expect(screen.queryByRole("columnheader", { name: "Tenant" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Tenant" })).not.toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Open menu for shop" }));
        expect(await screen.findByRole("menuitem", { name: "Open" })).toBeInTheDocument();
        expect(switchTenant).not.toHaveBeenCalled();
    });

    it("shows the backups of a day without the check of their copies, which would write a run", async () => {
        const late = file("Shop_nightly_late.tar", 1, { path: "Shop nightly/Shop_nightly_late.tar", databases: ["shop"] });
        serve({
            data: everyTenant,
            runs: { runs: [dbRun({ id: "late", startedAt: "2026-09-22T00:15:00Z", path: late.path })], versionChanges: [], planned: [] },
            backup: { run: run(late, "job-shop", [stored(late)]), job: job({}), chain: null, destinations: [destination("nas", "NAS Backups")] },
        });
        const day = (view: TenantView) => inView(view, (
            <DatabaseDayPanel pick={{ key: "s1/shop", day: "2026-09-22", run: null }} overview={everyTenant} access={READ_ONLY} onRun={vi.fn()} onShow={vi.fn()} onClose={vi.fn()} />
        ));

        const { unmount } = day(IN_ACME);
        expect((await screen.findAllByRole("button", { name: /^Verify/ })).length).toBeGreaterThan(0);
        unmount();

        day(ALL);
        expect(await screen.findByText("Picked on the timeline")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /^Verify/ })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Restore shop" })).not.toBeInTheDocument();
    });
});

describe("the page of a database or a server in All tenants", () => {
    beforeEach(() => {
        switchTenant.mockReset().mockResolvedValue({ success: true, data: { id: "acme", name: "Acme GmbH" } });
        push.mockClear();
        serve({ data: everyTenant });
    });

    it("says the database is only looked at and opens it in the tenant of its server", async () => {
        search = new URLSearchParams("server=s1&database=shop");
        pathname = "/dashboard/explorer/database";
        const user = userEvent.setup();
        inView(ALL, <DatabasePage canBrowse canOpenBackups />);

        expect(await screen.findByText("You look at this in All tenants")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Open in Acme GmbH" }));
        await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/explorer/database?server=s1&database=shop"));
        expect(switchTenant).toHaveBeenCalledWith("acme");
    });

    it("says the server is only looked at, and leaves the note out inside its tenant", async () => {
        search = new URLSearchParams("server=s2");
        pathname = "/dashboard/explorer/server";
        const { unmount } = inView(ALL, <ServerPage canOpenBackups />);

        expect(await screen.findByText("You look at this in All tenants")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Open in Home" })).toBeInTheDocument();
        unmount();

        inView(IN_ACME, <ServerPage canOpenBackups />);
        expect(await screen.findByRole("heading", { name: "ERP" })).toBeInTheDocument();
        expect(screen.queryByText("You look at this in All tenants")).not.toBeInTheDocument();
    });
});
