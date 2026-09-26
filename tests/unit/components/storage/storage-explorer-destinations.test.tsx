import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ViewMode } from "@/lib/core/table-preferences";
import type { ExplorerIndex } from "@/services/storage/explorer-types";
import { destination, erp, erpOlder, hoursAgo, index, measureTimeline, ok, runs } from "./explorer-fixtures";

let search = new URLSearchParams();
const replace = vi.fn((url: string) => {
    search = new URLSearchParams(url.split("?")[1] ?? "");
});
const push = vi.fn();
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push, replace }),
    useSearchParams: () => search,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/auth/client", () => ({
    useSession: () => ({ data: { user: { timezone: "UTC", dateFormat: "yyyy-MM-dd", timeFormat: "HH:mm" } } }),
}));
vi.mock("@/app/actions/storage/lock", () => ({ lockBackup: vi.fn() }));
vi.mock("@/app/actions/auth/table-preferences", () => ({
    saveTableLayout: vi.fn().mockResolvedValue({ success: true }),
    saveViewLayout: vi.fn().mockResolvedValue({ success: true }),
}));
// The dialogs behind the actions and the chart of the history have tests of their own. Here they only have to mount.
vi.mock("@/components/dashboard/storage/download/download-dialog", () => ({ DownloadDialog: () => null }));
vi.mock("@/components/dashboard/storage/integrity-modal", () => ({ IntegrityModal: () => null }));
vi.mock("@/components/common/encryption-key-resolution-dialog", () => ({ EncryptionKeyResolutionDialog: () => null }));
vi.mock("@/components/dashboard/storage/explorer/destination-history", () => ({ DestinationHistory: () => <p>History of the destination</p> }));
vi.mock("@/app/actions/storage/storage-alerts", () => ({ updateStorageAlertSettings: vi.fn().mockResolvedValue({ success: true }) }));

import { StorageClient } from "@/app/dashboard/storage/storage-client";

// The list of a filter scrolls its active option into view, which jsdom cannot do, and so do the details.
Element.prototype.scrollIntoView = vi.fn();

/** The NAS with its alerts on, the one for missing backups firing. */
const withAlerts: ExplorerIndex = {
    ...index,
    destinations: [
        destination("nas", "NAS Backups", {
            growth: 120,
            alerts: {
                usageSpike: { enabled: false, percent: 50, active: false },
                storageLimit: { enabled: true, bytes: 1_000, active: false },
                missingBackup: { enabled: true, hours: 48, active: true },
            },
        }),
        index.destinations[1],
    ],
};

function page(destinationsView: ViewMode = "table", canEditAlerts = true) {
    return <StorageClient canDownload canRestore canDelete canViewHistory canEditAlerts={canEditAlerts} initialLayout={null} initialViews={{ backups: "table", destinations: destinationsView }} />;
}

function serve(data: ExplorerIndex = index) {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
        if (url === "/api/storage/explorer") return ok(data);
        if (url === "/api/storage/explorer/runs") return ok({ runs });
        if (url === "/api/storage/explorer/plan") {
            return ok({ timezone: "UTC", days: 7, jobs: [{ jobKey: "job-shop", schedule: "0 3 * * *", enabled: true, createdAt: hoursAgo(2000), retention: null, planned: [{ at: hoursAgo(-24) }], missed: [], truncated: false }] });
        }
        if (url.endsWith("/files/bulk")) return ok({ succeeded: [erp.path, erpOlder.path], failed: [] });
        return ok(null);
    }));
}

const details = (name: string) => screen.findByRole("region", { name: `Details of ${name}` });

describe("Storage Explorer, Destinations tab", () => {
    beforeEach(() => {
        search = new URLSearchParams("tab=destinations");
        replace.mockClear();
        push.mockClear();
        serve();
    });

    it("lists every destination with whether it answers and shows the details of a clicked one under the list", async () => {
        const user = userEvent.setup();
        const { rerender } = render(page());

        const nas = await screen.findByRole("row", { name: /NAS Backups/ });
        expect(within(nas).getByText("Online · 12 ms")).toBeInTheDocument();
        expect(within(screen.getByRole("row", { name: /Cloudflare R2/ })).getByText(/Offline since/)).toBeInTheDocument();
        expect(screen.getByRole("tab", { name: /Destinations/ })).toHaveAttribute("aria-selected", "true");
        expect(screen.queryByRole("region", { name: /Details of/ })).not.toBeInTheDocument();

        await user.click(within(nas).getByText("NAS Backups"));
        expect(search.get("destination")).toBe("nas");
        rerender(page());

        const panel = await details("NAS Backups");
        expect(within(panel).getByText("History of the destination")).toBeInTheDocument();
        expect(within(panel).getByText("3 jobs with backups at NAS Backups. Show backups lists them in the Backups tab.")).toBeInTheDocument();
        expect(screen.getByRole("row", { name: /NAS Backups/ })).toHaveAttribute("data-active", "true");

        await user.click(within(panel).getByRole("button", { name: "Hide the details" }));
        expect(search.get("destination")).toBeNull();
        expect(search.get("tab")).toBe("destinations");
    });

    it("lists the jobs of a destination with a link to their backups and the retention there", async () => {
        search = new URLSearchParams("tab=destinations&destination=nas");
        render(page());

        const jobs = within(await details("NAS Backups")).getByRole("table");
        const shop = within(jobs).getByRole("row", { name: /Shop nightly/ });
        expect(within(shop).getByRole("link", { name: /Show backups/ })).toHaveAttribute("href", "/dashboard/storage?job=job-shop&at=nas");
        expect(within(shop).getByText("Keeps everything")).toBeInTheDocument();
        expect(within(within(jobs).getByRole("row", { name: /ERP invoices/ })).getByText("Kept until you delete them")).toBeInTheDocument();
    });

    it("finds a job at a destination by its state and deletes the backups a deleted job left there", async () => {
        const user = userEvent.setup();
        search = new URLSearchParams("tab=destinations&destination=nas");
        render(page());

        const panel = await details("NAS Backups");
        await user.click(within(panel).getByRole("button", { name: /^State/ }));
        await user.click(await screen.findByRole("option", { name: /Job deleted/ }));

        const jobs = within(panel).getByRole("table");
        await waitFor(() => expect(within(jobs).queryByText("Shop nightly")).not.toBeInTheDocument());
        expect(within(jobs).queryByText("Media sync")).not.toBeInTheDocument();

        await user.click(within(jobs).getByRole("button", { name: "Delete 2" }));
        expect(await screen.findByText("Delete the 2 backups of ERP invoices at NAS Backups?")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Delete 2 backups" }));

        await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/storage/nas/files/bulk", expect.anything()));
        expect(vi.mocked(fetch)).not.toHaveBeenCalledWith("/api/storage/r2/files/bulk", expect.anything());
    });

    it("searches the jobs of a destination by name", async () => {
        const user = userEvent.setup();
        search = new URLSearchParams("tab=destinations&destination=nas");
        render(page());

        const panel = await details("NAS Backups");
        await user.type(within(panel).getByPlaceholderText("Search jobs"), "media");

        const jobs = within(panel).getByRole("table");
        await waitFor(() => expect(within(jobs).queryByText("Shop nightly")).not.toBeInTheDocument());
        expect(within(jobs).getByText("Media sync")).toBeInTheDocument();
    });

    it("opens the backups of a destination in the Backups tab from its menu", async () => {
        const user = userEvent.setup();
        render(page());

        await user.click(await screen.findByRole("button", { name: "Open menu for NAS Backups" }));
        await user.click(await screen.findByRole("menuitem", { name: "Open backups" }));

        expect(push).toHaveBeenCalledWith("/dashboard/storage?at=nas");
    });

    it("shows the alerts of a destination in the list and in its details, where they can be changed", async () => {
        const user = userEvent.setup();
        serve(withAlerts);
        search = new URLSearchParams("tab=destinations&destination=nas");
        render(page());

        const panel = await details("NAS Backups");
        expect(within(screen.getByRole("row", { name: /NAS Backups/ })).getByText("Missing backup")).toBeInTheDocument();
        expect(within(panel).getByText("2 on, 1 active")).toBeInTheDocument();
        expect(within(panel).getByText("Active")).toBeInTheDocument();
        expect(within(panel).getByText("All well")).toBeInTheDocument();

        await user.click(within(panel).getByRole("button", { name: "Edit alerts" }));
        expect(await screen.findByRole("dialog", { name: "Alerts of NAS Backups" })).toBeInTheDocument();
    });

    it("hides the way to change the alerts from someone who may not change settings", async () => {
        serve(withAlerts);
        search = new URLSearchParams("tab=destinations&destination=nas");
        render(page("table", false));

        const panel = await details("NAS Backups");
        expect(within(panel).getByText("2 on, 1 active")).toBeInTheDocument();
        expect(within(panel).queryByRole("button", { name: "Edit alerts" })).not.toBeInTheDocument();
        expect(within(panel).queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    });

    it("shows every destination by day on the timeline and the details of a picked one under it", async () => {
        const user = userEvent.setup();
        measureTimeline();
        const { rerender } = render(page("timeline"));

        expect(await screen.findByText("Every destination")).toBeInTheDocument();
        // The table waits under the timeline, a pick shows the details instead.
        expect(screen.queryByRole("table")).not.toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: /NAS Backups/, pressed: false }));
        expect(search.get("destination")).toBe("nas");
        rerender(page("timeline"));

        expect(await details("NAS Backups")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /NAS Backups/, pressed: true })).toBeInTheDocument();
    });

    it("shows the destinations as cards on a phone and the details of a tapped one under them", async () => {
        const width = window.innerWidth;
        Object.defineProperty(window, "innerWidth", { value: 375, configurable: true });
        try {
            const user = userEvent.setup();
            const { rerender } = render(page());

            const card = await screen.findByRole("button", { name: "NAS Backups" });
            expect(screen.queryByRole("table")).not.toBeInTheDocument();
            await user.click(card);
            expect(search.get("destination")).toBe("nas");
            rerender(page());

            expect(await details("NAS Backups")).toBeInTheDocument();
        } finally {
            Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
        }
    });

    it("turns an older link to a destination into its details in the Destinations tab", async () => {
        search = new URLSearchParams("destination=nas");
        render(page());

        expect(await details("NAS Backups")).toBeInTheDocument();
        expect(screen.getByRole("tab", { name: /Destinations/ })).toHaveAttribute("aria-selected", "true");
    });
});
