import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ViewMode } from "@/lib/core/table-preferences";
import type { ExplorerIndex } from "@/services/storage/explorer-types";
import type { SharedBackup, SharedDatabase } from "@/services/tenant/shared-databases";
import { destination, hoursAgo, index, measureTimeline, ok, runs } from "./explorer-fixtures";

let search = new URLSearchParams();
const replace = vi.fn((url: string) => {
    search = new URLSearchParams(url.split("?")[1] ?? "");
});
const push = vi.fn();
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push, replace, refresh: vi.fn() }),
    useSearchParams: () => search,
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/lib/auth/client", () => ({
    useSession: () => ({ data: { user: { timezone: "UTC", dateFormat: "yyyy-MM-dd", timeFormat: "HH:mm" } } }),
}));
vi.mock("@/app/actions/storage/lock", () => ({ lockBackup: vi.fn() }));
vi.mock("@/app/actions/auth/table-preferences", () => ({
    saveTableLayout: vi.fn().mockResolvedValue({ success: true }),
    saveViewLayout: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock("@/components/dashboard/storage/download/download-dialog", () => ({ DownloadDialog: () => null }));
vi.mock("@/components/dashboard/storage/integrity/integrity-dialog", () => ({ IntegrityDialog: () => null }));
vi.mock("@/components/common/encryption-key-resolution-dialog", () => ({ EncryptionKeyResolutionDialog: () => null }));
vi.mock("@/app/actions/storage/storage-alerts", () => ({ updateStorageAlertSettings: vi.fn(), updateStorageAlertsOfMany: vi.fn() }));
const actions = vi.hoisted(() => ({
    getSharedOverview: vi.fn(),
    downloadSharedBackup: vi.fn(),
    restoreSharedDatabase: vi.fn(),
    backUpSharedDatabase: vi.fn(),
    getSharedBackupRun: vi.fn(),
}));
vi.mock("@/app/actions/tenant/shared-databases", () => actions);

import { StorageClient } from "@/app/dashboard/backups/storage-client";

// The lists of the filters scroll their active option into view, which jsdom cannot do.
Element.prototype.scrollIntoView = vi.fn();

const SHOP: SharedDatabase = { sourceId: "my", serverName: "MySQL shop", adapterId: "mysql", databaseName: "shop_a", providerName: "Skyfay Hosting", since: "2026-01-01T00:00:00.000Z", until: null, serverGone: false, serverDeletedAt: null, movedFrom: [], onDemand: null };
const CRM: SharedDatabase = { ...SHOP, databaseName: "crm_a" };
const OLD: SharedDatabase = { ...SHOP, sourceId: "pg", serverName: "Postgres main", adapterId: "postgres", databaseName: "shop_old", until: hoursAgo(300) };

const ID = (n: number) => String(n).repeat(32);
const BACKUPS: SharedBackup[] = [
    { id: ID(1), sourceId: "my", databaseName: "shop_a", databaseKey: "my/shop_a", createdAt: hoursAgo(2), encrypted: true, verification: { at: hoursAgo(1.9), passed: true }, dump: { stored: 412 * 1024 * 1024, unpacked: 2.4 * 1024 ** 3 }, requestedBy: null },
    { id: ID(2), sourceId: "my", databaseName: "crm_a", databaseKey: "my/crm_a", createdAt: hoursAgo(5), encrypted: true, verification: null, dump: null, requestedBy: { name: "Sara Nguyen" } },
    { id: ID(3), sourceId: "pg", databaseName: "shop_old", databaseKey: "pg/shop_old", createdAt: hoursAgo(400), encrypted: false, verification: null, dump: null, requestedBy: null },
];

const ALL = { canDownload: true, canRestore: true, canDelete: true, canViewHistory: true, canBackUpShared: true };
type Access = typeof ALL;

function element(hasShared: boolean, view: ViewMode = "table", access: Partial<Access> = {}) {
    return <StorageClient {...ALL} {...access} hasShared={hasShared} initialLayout={null} initialViews={{ backups: view, destinations: "table" }} />;
}

function page(hasShared: boolean, options: { own?: ExplorerIndex; view?: ViewMode; access?: Partial<Access> } = {}) {
    const own = options.own ?? index;
    vi.stubGlobal("fetch", vi.fn((url: string) => {
        if (url === "/api/storage/explorer") return ok(own);
        if (url === "/api/storage/explorer/runs") return ok({ runs: own === index ? runs : [] });
        return ok(null);
    }));
    return render(element(hasShared, options.view, options.access));
}

const table = () => screen.getByRole("table");
/** The row of a backup in the list, by a text in it. */
const rowOf = async (text: string) => (await screen.findAllByText(text)).map((entry) => entry.closest("tr")).find((row): row is HTMLTableRowElement => row !== null)!;
const quickFilter = () => screen.findByRole("group", { name: "Filter by whose backups they are" });

describe("the Backups page with databases shared with the tenant", () => {
    beforeEach(() => {
        search = new URLSearchParams();
        replace.mockClear();
        push.mockReset();
        for (const action of Object.values(actions)) action.mockReset();
        for (const call of Object.values(toast)) call.mockReset();
        actions.getSharedOverview.mockResolvedValue({ success: true, data: { databases: [SHOP, CRM, OLD], backups: BACKUPS } });
    });

    it("keeps the list as it was and asks for nothing shared while no other tenant shares a database", async () => {
        page(false);
        expect(await screen.findByText("Cloudflare R2 missing")).toBeInTheDocument();
        expect(screen.queryByRole("group", { name: "Filter by whose backups they are" })).not.toBeInTheDocument();
        expect(actions.getSharedOverview).not.toHaveBeenCalled();
    });

    it("has only the tabs Backups and Destinations", async () => {
        page(true);
        await rowOf("shop_a");
        expect(screen.getByRole("tab", { name: /^Backups/ })).toBeInTheDocument();
        expect(screen.getByRole("tab", { name: /^Destinations/ })).toBeInTheDocument();
        expect(screen.queryByRole("tab", { name: /Shared with you/ })).not.toBeInTheDocument();
    });

    it("lists the shared backups among the own ones with their database, provider, starter and dump", async () => {
        page(true);
        const row = await rowOf("shop_a");
        expect(within(row).getByText("Shared")).toBeInTheDocument();
        expect(within(row).getByText("MySQL shop · Skyfay Hosting")).toBeInTheDocument();
        expect(within(row).getByText("Database")).toBeInTheDocument();
        expect(within(row).getByText("Schedule")).toBeInTheDocument();
        expect(within(row).getByText("412 MB")).toBeInTheDocument();
        expect(within(row).getByText("Verified")).toBeInTheDocument();
        // Stored at names the provider, never one of its destinations.
        expect(within(row).getAllByText(/Skyfay Hosting/).length).toBeGreaterThan(0);

        expect(within(await rowOf("crm_a")).getByText("Back up now")).toBeInTheDocument();
        expect(within(await rowOf("crm_a")).getByText("· Sara Nguyen")).toBeInTheDocument();
        const old = await rowOf("shop_old");
        expect(within(old).getByText("Former")).toBeInTheDocument();
        expect(within(old).getByText("-")).toBeInTheDocument();

        // The own backups stay, and the numbers count both, the bytes only the own.
        expect(within(table()).getAllByText("Shop nightly")).toHaveLength(2);
        expect(screen.getByText("from 2 jobs and 1 deleted job, 3 of shared databases")).toBeInTheDocument();
        expect(screen.getByText(/shared ones not counted/)).toBeInTheDocument();
    });

    it("tells the own backups from the shared ones with a quick filter that counts each", async () => {
        const user = userEvent.setup();
        const view = page(true);
        const quick = await quickFilter();
        expect(within(quick).getByRole("button", { name: /^All/ })).toHaveTextContent("All11");
        expect(within(quick).getByRole("button", { name: /^Yours/ })).toHaveTextContent("Yours8");
        expect(within(quick).getByRole("button", { name: /^Shared with you/ })).toHaveTextContent("Shared with you3");

        await user.click(within(quick).getByRole("button", { name: /^Shared with you/ }));
        expect(replace).toHaveBeenLastCalledWith("/dashboard/backups?quick=shared", { scroll: false });
        view.rerender(element(true));
        await waitFor(() => expect(within(table()).queryByText("Shop nightly")).not.toBeInTheDocument());
        expect(within(table()).getByText("shop_a")).toBeInTheDocument();
    });

    it("lands a link to the old tab Shared with you on the Backups tab with Shared with you picked", async () => {
        search = new URLSearchParams("tab=shared");
        page(true);
        expect(within(await quickFilter()).getByRole("button", { name: /^Shared with you/ })).toHaveAttribute("aria-pressed", "true");
        expect(screen.getByRole("tab", { name: /Backups/ })).toHaveAttribute("aria-selected", "true");
        expect(within(table()).getByText("shop_a")).toBeInTheDocument();
        expect(within(table()).queryByText("Shop nightly")).not.toBeInTheDocument();
    });

    it("narrows the list to one shared database a link names", async () => {
        search = new URLSearchParams("quick=shared&shared=my%2Fcrm_a");
        page(true);
        expect(await rowOf("crm_a")).toBeInTheDocument();
        expect(within(table()).queryByText("shop_a")).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: /^Job/ })).toHaveTextContent("crm_a");
    });

    it("lists the shared backups for a tenant with nothing of its own, not an empty page", async () => {
        page(true, { own: { jobs: [], destinations: [] } });
        expect(await rowOf("shop_a")).toBeInTheDocument();
        expect(screen.getByRole("tab", { name: /Backups/ })).toHaveAttribute("aria-selected", "true");
    });

    it("offers on a shared backup only what the tenant may do, and on an own backup its whole menu", async () => {
        const user = userEvent.setup();
        actions.getSharedOverview.mockResolvedValue({ success: true, data: { databases: [{ ...SHOP, onDemand: { perDay: 4, usedToday: 2, active: null } }, CRM, OLD], backups: BACKUPS } });
        page(true);
        await user.click(within(await rowOf("shop_a")).getByRole("button", { name: "Open menu for shop_a" }));
        expect(await screen.findByRole("menuitem", { name: /Restore into shop_a/ })).toHaveTextContent("on MySQL shop, nothing else changes");
        expect(screen.getByRole("menuitem", { name: /Download the dump/ })).toBeInTheDocument();
        expect(screen.getByRole("menuitem", { name: /Back up shop_a now/ })).toHaveTextContent("2 of 4 left today");
        expect(screen.getByText("Skyfay Hosting keeps the archive. Verify, lock and delete stay with them.")).toBeInTheDocument();
        expect(screen.queryByRole("menuitem", { name: /Verify integrity|Lock|Delete/ })).not.toBeInTheDocument();
        await user.keyboard("{Escape}");

        await user.click(within(await rowOf("shop_old")).getByRole("button", { name: "Open menu for shop_old" }));
        expect(await screen.findByRole("menuitem", { name: /Download the dump/ })).toBeInTheDocument();
        expect(screen.queryByRole("menuitem", { name: /Restore/ })).not.toBeInTheDocument();
        await user.keyboard("{Escape}");

        const own = within(table()).getAllByText("Shop nightly")[0].closest("tr")!;
        await user.click(within(own).getByRole("button", { name: /Open menu for/ }));
        expect(await screen.findByRole("menuitem", { name: /Verify integrity/ })).toBeInTheDocument();
        expect(screen.getByRole("menuitem", { name: /Delete/ })).toBeInTheDocument();
    });

    it("restores a shared backup into its database after the dialog said what changes, and links the run", async () => {
        const user = userEvent.setup();
        actions.restoreSharedDatabase.mockResolvedValue({ success: true, data: { executionId: "run-7" } });
        page(true);
        await user.click(within(await rowOf("shop_a")).getByRole("button", { name: "Open menu for shop_a" }));
        await user.click(await screen.findByRole("menuitem", { name: /Restore into shop_a/ }));

        const dialog = await screen.findByRole("alertdialog", { name: "Restore shop_a" });
        expect(within(dialog).getByText("Fixed")).toBeInTheDocument();
        expect(within(dialog).getByText("crm_a stays as it is")).toBeInTheDocument();
        await user.click(within(dialog).getByRole("button", { name: "Restore shop_a" }));
        await waitFor(() => expect(actions.restoreSharedDatabase).toHaveBeenCalledWith({ sourceId: "my", databaseName: "shop_a", backupId: ID(1) }));
        const [, options] = toast.success.mock.calls[0];
        options.action.onClick();
        expect(push).toHaveBeenCalledWith("/dashboard/history/run?id=run-7&from=shared");
    });

    it("opens the panel of a shared backup on a click, with who started it", async () => {
        const user = userEvent.setup();
        page(true);
        await user.click(await rowOf("crm_a"));
        const panel = await screen.findByRole("dialog");
        expect(within(panel).getByText("Where it comes from")).toBeInTheDocument();
        expect(within(panel).getByText("Back up now · Sara Nguyen")).toBeInTheDocument();
        expect(within(panel).getByRole("button", { name: "Restore into crm_a" })).toBeInTheDocument();
    });

    it("never lets a shared backup be selected for a bulk action", async () => {
        page(true);
        expect(within(await rowOf("shop_a")).getByRole("checkbox", { name: "Select row" })).toBeDisabled();
        const own = within(table()).getAllByText("Shop nightly")[0].closest("tr")!;
        expect(within(own).getByRole("checkbox", { name: "Select row" })).toBeEnabled();
    });

    it("starts a backup its provider allows and loads the shared backups again", async () => {
        const user = userEvent.setup();
        actions.getSharedOverview.mockResolvedValue({ success: true, data: { databases: [{ ...SHOP, onDemand: { perDay: 3, usedToday: 1, active: null } }, CRM, OLD], backups: BACKUPS } });
        actions.backUpSharedDatabase.mockResolvedValue({ success: true, data: { requestId: "req-1" } });
        page(true);
        await user.click(within(await rowOf("shop_a")).getByRole("button", { name: "Open menu for shop_a" }));
        await user.click(await screen.findByRole("menuitem", { name: /Back up shop_a now/ }));
        await waitFor(() => expect(actions.backUpSharedDatabase).toHaveBeenCalledWith({ sourceId: "my", databaseName: "shop_a" }));
        await waitFor(() => expect(actions.getSharedOverview).toHaveBeenCalledTimes(2));
    });

    it("hides restore and download from a viewer who may do neither", async () => {
        page(true, { access: { canDownload: false, canRestore: false } });
        const row = await rowOf("shop_a");
        expect(within(row).queryByRole("button", { name: "Open menu for shop_a" })).not.toBeInTheDocument();
    });

    it("draws each shared database as a dashed row of its own in the timeline, and opens a backup from its day", async () => {
        const user = userEvent.setup();
        measureTimeline();
        page(true, { view: "timeline" });
        expect(await screen.findByText("Every job")).toBeInTheDocument();
        expect(screen.getByText("A backup of a shared database")).toBeInTheDocument();
        const days = (await screen.findAllByRole("button", { name: /^shop_a, / })).filter((button) => button.getAttribute("aria-haspopup") === "dialog");
        expect(days).toHaveLength(1);
        await user.click(days[0]);
        expect(await screen.findByText("Where it comes from")).toBeInTheDocument();
    });
});

describe("the Destinations tab with destinations another tenant shares", () => {
    beforeEach(() => {
        search = new URLSearchParams("tab=destinations");
        replace.mockClear();
    });

    it("tells the own destinations from the provided ones with a quick filter", async () => {
        const user = userEvent.setup();
        const provided = destination("zurich", "Skyfay Cloud Zurich", { provider: "Skyfay Hosting" });
        page(false, { own: { ...index, destinations: [...index.destinations, provided] } });
        const quick = await screen.findByRole("group", { name: "Filter by whose destination it is" });
        expect(within(quick).getByRole("button", { name: /^Provided/ })).toHaveTextContent("Provided1");
        await user.click(within(quick).getByRole("button", { name: /^Provided/ }));
        expect(within(table()).getByText("Skyfay Cloud Zurich")).toBeInTheDocument();
        expect(within(table()).queryByText("NAS Backups")).not.toBeInTheDocument();
    });

    it("has no such filter while every destination is the tenant's own", async () => {
        page(false);
        expect(await screen.findByText("NAS Backups")).toBeInTheDocument();
        expect(screen.queryByRole("group", { name: "Filter by whose destination it is" })).not.toBeInTheDocument();
    });
});
