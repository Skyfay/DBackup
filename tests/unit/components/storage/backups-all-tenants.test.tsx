import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TenantViewProvider } from "@/components/tenant/tenant-view";
import { encodeUrlPayload } from "@/lib/url-payload";
import type { ExplorerIndex } from "@/services/storage/explorer-types";
import { destination, file, index, job, newest, ok, run, runs, stored } from "./explorer-fixtures";

let search = new URLSearchParams();
const replace = vi.fn((url: string) => {
    search = new URLSearchParams(url.split("?")[1] ?? "");
});
const push = vi.fn();
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push, replace, refresh: vi.fn() }),
    useSearchParams: () => search,
    usePathname: () => "/dashboard/backups/restore",
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/auth/client", () => ({
    useSession: () => ({ data: { user: { timezone: "UTC", dateFormat: "yyyy-MM-dd", timeFormat: "HH:mm" } } }),
}));
const switchTenant = vi.fn();
vi.mock("@/app/actions/tenant/tenant", () => ({ switchTenant: (...args: unknown[]) => switchTenant(...args) }));
vi.mock("@/app/actions/storage/lock", () => ({ lockBackup: vi.fn() }));
vi.mock("@/app/actions/auth/table-preferences", () => ({
    saveTableLayout: vi.fn().mockResolvedValue({ success: true }),
    saveViewLayout: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock("@/components/dashboard/storage/download/download-dialog", () => ({ DownloadDialog: () => null }));
vi.mock("@/components/dashboard/storage/integrity/integrity-dialog", () => ({ IntegrityDialog: () => null }));
vi.mock("@/components/common/encryption-key-resolution-dialog", () => ({ EncryptionKeyResolutionDialog: () => null }));
vi.mock("@/app/actions/storage/storage-alerts", () => ({ updateStorageAlertSettings: vi.fn(), updateStorageAlertsOfMany: vi.fn() }));

import { StorageClient } from "@/app/dashboard/backups/storage-client";
import { RestoreAllTenants } from "@/app/dashboard/backups/restore/restore-all-tenants";

Element.prototype.scrollIntoView = vi.fn();

const TENANTS = [{ id: "acme", name: "Acme GmbH" }, { id: "beta", name: "Beta AG" }];

// The three jobs of the fixtures belong to Acme, a job of the same name and its destination to Beta.
const betaFile = file("Beta_shop.tar", 5, { path: "Shop nightly/Beta_shop.tar", jobId: "job-beta" });
const everyTenant: ExplorerIndex = {
    destinations: [...index.destinations.map((entry) => ({ ...entry, tenantId: "acme" })), destination("beta-nas", "Beta NAS", { tenantId: "beta" })],
    jobs: [
        ...index.jobs.map((entry) => ({ ...entry, tenantId: "acme" })),
        job({ key: "job-beta", jobId: "job-beta", tenantId: "beta", configuredDestinationIds: ["beta-nas"], destinationIds: ["beta-nas"], runs: 1, missingCopies: 0 }),
    ],
};
const everyRun = [...runs.map((entry) => ({ ...entry, tenantId: "acme" })), { ...run(betaFile, "job-beta", [stored(betaFile, "beta-nas")]), tenantId: "beta" }];

function inAllTenants(children: React.ReactNode) {
    return <TenantViewProvider value={{ tenants: TENANTS, activeTenantId: null, allTenants: true, isPlatformAdmin: true }}>{children}</TenantViewProvider>;
}

/** The page as All tenants hands it over: every read, no write. */
const page = (tab: "table" = "table") => (
    <StorageClient canDownload={false} canRestore={false} canDelete={false} canViewHistory canEditAlerts={false} initialLayout={null} initialViews={{ backups: tab, destinations: tab }} />
);

const table = () => screen.getByRole("table");

describe("Backups page in All tenants", () => {
    beforeEach(() => {
        search = new URLSearchParams();
        replace.mockClear();
        push.mockClear();
        switchTenant.mockReset().mockImplementation(async (id: string) => ({ success: true, data: { name: TENANTS.find((tenant) => tenant.id === id)?.name } }));
        vi.stubGlobal("fetch", vi.fn((url: string) => {
            if (url === "/api/storage/explorer") return ok(everyTenant);
            if (url === "/api/storage/explorer/runs") return ok({ runs: everyRun });
            return ok(null);
        }));
    });

    it("shows the tenant of every backup and filters by it, the jobs of the same name told apart", async () => {
        const user = userEvent.setup();
        render(inAllTenants(page()));

        await screen.findByText("Beta AG");
        expect(within(table()).getByRole("columnheader", { name: /Tenant/ })).toBeInTheDocument();
        expect(within(table()).getAllByText("Acme GmbH")).toHaveLength(8);

        await user.click(screen.getByRole("button", { name: "Job" }));
        expect(await screen.findByRole("option", { name: /Shop nightly · Beta AG/ })).toBeInTheDocument();
        expect(screen.getByRole("option", { name: /Shop nightly · Acme GmbH/ })).toBeInTheDocument();
        await user.keyboard("{Escape}");

        await user.click(screen.getByRole("button", { name: "Tenant" }));
        await user.click(await screen.findByRole("option", { name: /Beta AG/ }));
        await waitFor(() => expect(within(table()).queryByText("Media sync")).not.toBeInTheDocument());
        expect(within(table()).getAllByText("Shop nightly")).toHaveLength(1);
    });

    it("reads the details of a backup without a check and opens it in its tenant", async () => {
        const user = userEvent.setup();
        render(inAllTenants(page()));

        await user.click((await screen.findByText("Beta AG")).closest("tr")!);
        const panel = await screen.findByRole("dialog");
        expect(within(panel).queryByRole("button", { name: /Verify/ })).not.toBeInTheDocument();
        expect(within(panel).queryByRole("button", { name: "Restore" })).not.toBeInTheDocument();
        expect(within(panel).queryByRole("button", { name: "Download" })).not.toBeInTheDocument();

        await user.click(within(panel).getByRole("button", { name: "Open in Beta AG" }));
        await waitFor(() => expect(switchTenant).toHaveBeenCalledWith("beta"));
        expect(push).toHaveBeenCalledWith(`/dashboard/backups?backup=${encodeURIComponent(betaFile.path)}`);
    });

    it("shows the tenant of every destination and offers no change of its alerts", async () => {
        const user = userEvent.setup();
        search = new URLSearchParams("tab=destinations");
        render(inAllTenants(page()));

        const row = (await screen.findByText("Beta NAS")).closest("tr")!;
        expect(within(row).getByText("Beta AG")).toBeInTheDocument();

        await user.click(within(row).getByRole("button", { name: "Open menu for Beta NAS" }));
        expect(await screen.findByRole("menuitem", { name: "Open in Beta AG" })).toBeInTheDocument();
        expect(screen.getByRole("menuitem", { name: "Check now" })).toBeInTheDocument();
        expect(screen.queryByRole("menuitem", { name: "Edit alerts" })).not.toBeInTheDocument();
    });
});

describe("Backups page in one tenant", () => {
    beforeEach(() => {
        search = new URLSearchParams();
        vi.stubGlobal("fetch", vi.fn((url: string) => {
            if (url === "/api/storage/explorer") return ok(index);
            if (url === "/api/storage/explorer/runs") return ok({ runs });
            return ok(null);
        }));
    });

    it("opens the details of the backup a link names by its path, and has no Tenant column", async () => {
        search = new URLSearchParams(`backup=${encodeURIComponent(newest.path)}`);
        render(page());

        const panel = await screen.findByRole("dialog");
        expect(within(panel).getByText("Shop nightly · Shop_nightly_newest.tar")).toBeInTheDocument();
        // The open panel hides the page behind it from screen readers.
        const list = screen.getByRole("table", { hidden: true });
        expect(within(list).getAllByRole("columnheader", { hidden: true }).length).toBeGreaterThan(3);
        expect(within(list).queryByRole("columnheader", { name: /Tenant/, hidden: true })).not.toBeInTheDocument();
    });
});

describe("Restore page in All tenants", () => {
    beforeEach(() => {
        switchTenant.mockReset().mockResolvedValue({ success: true, data: { name: "Beta AG" } });
        vi.stubGlobal("fetch", vi.fn((url: string) => {
            if (url === "/api/storage/explorer") return ok(everyTenant);
            if (url === "/api/storage/explorer/runs") return ok({ runs: everyRun });
            throw new Error(`Unexpected request ${url}`);
        }));
    });

    it("names the tenant of the backup, offers to open it there and starts nothing", async () => {
        const user = userEvent.setup();
        search = new URLSearchParams({ destinationId: "beta-nas", file: encodeUrlPayload(betaFile) });
        render(inAllTenants(<RestoreAllTenants />));

        expect(await screen.findByText("You look at this in All tenants")).toBeInTheDocument();
        expect(screen.getByText("Open it in Beta AG to pick what comes back and where it goes.")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /^Restore/ })).not.toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Open in Beta AG" }));
        await waitFor(() => expect(switchTenant).toHaveBeenCalledWith("beta"));
        expect(push).toHaveBeenCalledWith(expect.stringMatching(/^\/dashboard\/backups\/restore\?destinationId=beta-nas&file=/));
        // Only the explorer is read, never the archive.
        expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url).startsWith("/api/storage/explorer"))).toBe(true);
    });
});
