import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SharedBackup, SharedDatabase } from "@/services/tenant/shared-databases";
import { measureTimeline } from "../storage/explorer-fixtures";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/auth/client", () => ({ useSession: () => ({ data: { user: { timezone: "UTC", dateFormat: "yyyy-MM-dd", timeFormat: "HH:mm" } } }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const actions = vi.hoisted(() => ({
    getSharedOverview: vi.fn(),
    downloadSharedBackup: vi.fn(),
    restoreSharedDatabase: vi.fn(),
    backUpSharedDatabase: vi.fn(),
    getSharedBackupRun: vi.fn(),
}));
vi.mock("@/app/actions/tenant/shared-databases", () => actions);

import { SharedTab } from "@/components/dashboard/shared/shared-tab";

// The lists of the filters scroll their active option into view, which jsdom cannot do.
Element.prototype.scrollIntoView = vi.fn();

const SHOP: SharedDatabase = { sourceId: "my", serverName: "MySQL shop", adapterId: "mysql", databaseName: "shop_a", providerName: "Skyfay Hosting", since: "2026-10-01T00:00:00.000Z", until: null, serverGone: false, serverDeletedAt: null, movedFrom: [], onDemand: null };
const CRM: SharedDatabase = { ...SHOP, databaseName: "crm_a" };
const OLD: SharedDatabase = { sourceId: "pg", serverName: "Postgres main", adapterId: "postgres", databaseName: "shop_old", providerName: "Skyfay Hosting", since: "2026-09-01T00:00:00.000Z", until: "2026-10-08T00:00:00.000Z", serverGone: false, serverDeletedAt: null, movedFrom: [], onDemand: null };

const ID = (n: number) => String(n).repeat(32);
const BACKUPS: SharedBackup[] = [
    { id: ID(1), sourceId: "my", databaseName: "shop_a", databaseKey: "my/shop_a", createdAt: "2026-10-12T03:00:00.000Z", encrypted: true, verification: { at: "2026-10-12T03:10:00.000Z", passed: true }, dump: { stored: 412 * 1024 * 1024, unpacked: 2.4 * 1024 ** 3 } },
    { id: ID(2), sourceId: "pg", databaseName: "shop_old", databaseKey: "pg/shop_old", createdAt: "2026-10-05T03:00:00.000Z", encrypted: false, verification: null, dump: null },
];

const access = { canDownload: true, canRestore: true, canViewHistory: true, canBackUp: true };
const layout = { initial: null, onChange: vi.fn() };
const tab = (props: Partial<typeof access> = {}) => render(<SharedTab view="table" columnLayout={layout} {...access} {...props} />);

/** The row of a backup in the list, by its database. */
const rowOf = async (name: string) => (await screen.findAllByText(name)).map((element) => element.closest("tr")).find((row): row is HTMLTableRowElement => row !== null)!;

describe("the tab Shared with you of the Backups page", () => {
    beforeEach(() => {
        for (const action of Object.values(actions)) action.mockReset();
        toast.success.mockReset();
        toast.error.mockReset();
        push.mockReset();
        actions.getSharedOverview.mockResolvedValue({ success: true, data: { databases: [SHOP, CRM, OLD], backups: BACKUPS } });
    });

    it("explains what the tab is for while nothing is shared any more", async () => {
        actions.getSharedOverview.mockResolvedValue({ success: true, data: { databases: [], backups: [] } });
        tab();
        expect(await screen.findByText("Nothing is shared with you right now")).toBeInTheDocument();
    });

    it("lists every shared backup like the Backups tab: the database, its server, who provides it, the size of its dump and its check", async () => {
        tab();
        const row = await rowOf("shop_a");
        expect(within(row).getByText("MySQL shop")).toBeInTheDocument();
        expect(within(row).getByText("Skyfay Hosting")).toBeInTheDocument();
        expect(within(row).getByText("412 MB")).toBeInTheDocument();
        expect(within(row).getByText("2.4 GB unpacked")).toBeInTheDocument();
        expect(within(row).getByText("Verified")).toBeInTheDocument();

        const old = await rowOf("shop_old");
        expect(within(old).getByText("Former")).toBeInTheDocument();
        expect(within(old).getByText("-")).toBeInTheDocument();
        // The numbers above the list count the databases, not the backups of the MSP.
        expect(screen.getByText("Shared databases")).toBeInTheDocument();
        expect(screen.getByText("+1 former")).toBeInTheDocument();
    });

    it("offers Restore for a database that is the tenant's and only Download for a former one", async () => {
        const user = userEvent.setup();
        tab();
        await user.click(within(await rowOf("shop_old")).getByRole("button", { name: "Open menu for shop_old" }));
        expect(await screen.findByRole("menuitem", { name: /Download the dump/ })).toBeInTheDocument();
        expect(screen.queryByRole("menuitem", { name: /Restore/ })).not.toBeInTheDocument();
        await user.keyboard("{Escape}");

        await user.click(within(await rowOf("shop_a")).getByRole("button", { name: "Open menu for shop_a" }));
        expect(await screen.findByRole("menuitem", { name: "Restore shop_a" })).toBeInTheDocument();
    });

    it("restores the picked backup into its own database after it said what changes, and links the run", async () => {
        const user = userEvent.setup();
        actions.restoreSharedDatabase.mockResolvedValue({ success: true, data: { executionId: "run-7" } });
        tab();
        await user.click(within(await rowOf("shop_a")).getByRole("button", { name: "Open menu for shop_a" }));
        await user.click(await screen.findByRole("menuitem", { name: "Restore shop_a" }));

        const dialog = await screen.findByRole("alertdialog", { name: "Restore shop_a" });
        expect(within(dialog).getByText("Fixed")).toBeInTheDocument();
        expect(within(dialog).getByText("shop_a is overwritten")).toBeInTheDocument();
        expect(within(dialog).getByText("crm_a stays as it is")).toBeInTheDocument();
        expect(within(dialog).getByText("Every other database of MySQL shop stays as it is")).toBeInTheDocument();

        await user.click(within(dialog).getByRole("button", { name: "Restore shop_a" }));
        await waitFor(() => expect(actions.restoreSharedDatabase).toHaveBeenCalledWith({ sourceId: "my", databaseName: "shop_a", backupId: ID(1) }));
        const [, options] = toast.success.mock.calls[0];
        options.action.onClick();
        expect(push).toHaveBeenCalledWith("/dashboard/history/run?id=run-7&from=shared");
    });

    it("opens the panel of a backup with where it comes from, without a destination of the provider", async () => {
        const user = userEvent.setup();
        tab();
        await user.click(await rowOf("shop_a"));
        const panel = await screen.findByRole("dialog");
        expect(within(panel).getByText("Where it comes from")).toBeInTheDocument();
        expect(within(panel).getByText("Provided by")).toBeInTheDocument();
        expect(within(panel).getByText("412 MB, 2.4 GB unpacked")).toBeInTheDocument();
        expect(within(panel).getByRole("button", { name: "Restore" })).toBeInTheDocument();
    });

    it("draws the timeline view with a line per database, and opens a backup from its day", async () => {
        const user = userEvent.setup();
        measureTimeline();
        const today = new Date();
        today.setUTCHours(1, 0, 0, 0);
        actions.getSharedOverview.mockResolvedValue({ success: true, data: { databases: [SHOP, CRM], backups: [{ ...BACKUPS[0], createdAt: today.toISOString() }] } });
        render(<SharedTab view="timeline" columnLayout={layout} {...access} />);

        expect(await screen.findByText("Every database")).toBeInTheDocument();
        expect(screen.getByText("crm_a")).toBeInTheDocument();
        // The one day of shop_a that holds a backup is the one that opens something.
        const days = screen.getAllByRole("button", { name: /^shop_a, / }).filter((button) => button.getAttribute("aria-haspopup") === "dialog");
        expect(days).toHaveLength(1);
        await user.click(days[0]);
        expect(await screen.findByText("Where it comes from")).toBeInTheDocument();
    });

    it("hides Restore and Download from a viewer who may do neither", async () => {
        const user = userEvent.setup();
        tab({ canDownload: false, canRestore: false });
        await rowOf("shop_a");
        expect(screen.queryByRole("button", { name: "Open menu for shop_a" })).not.toBeInTheDocument();
        await user.click(await rowOf("shop_a"));
        const panel = await screen.findByRole("dialog");
        expect(within(panel).queryByRole("button", { name: "Restore" })).not.toBeInTheDocument();
        expect(within(panel).queryByRole("button", { name: "Download" })).not.toBeInTheDocument();
    });
});

describe("Back up now of a shared database", () => {
    const allowed = { ...SHOP, onDemand: { perDay: 3, usedToday: 1, active: null } };

    beforeEach(() => {
        for (const action of Object.values(actions)) action.mockReset();
        toast.success.mockReset();
        toast.error.mockReset();
        actions.getSharedOverview.mockResolvedValue({ success: true, data: { databases: [allowed, CRM, OLD], backups: BACKUPS } });
    });

    it("starts a backup its provider allows and loads the tab again", async () => {
        const user = userEvent.setup();
        actions.backUpSharedDatabase.mockResolvedValue({ success: true, data: { requestId: "req-1" } });
        tab();
        await user.click(within(await rowOf("shop_a")).getByRole("button", { name: "Open menu for shop_a" }));
        await user.click(await screen.findByRole("menuitem", { name: "Back up shop_a now" }));
        await waitFor(() => expect(actions.backUpSharedDatabase).toHaveBeenCalledWith({ sourceId: "my", databaseName: "shop_a" }));
        expect(toast.success).toHaveBeenCalledWith("A backup of shop_a starts", expect.anything());
        await waitFor(() => expect(actions.getSharedOverview).toHaveBeenCalledTimes(2));
    });

    it("shows in the panel how many are left today, and no Back up now to a viewer without Run now", async () => {
        const user = userEvent.setup();
        const view = tab();
        await user.click(await rowOf("shop_a"));
        const panel = await screen.findByRole("dialog");
        expect(within(panel).getByRole("button", { name: "Back up now" })).toBeEnabled();
        expect(within(panel).getByText("2 of 3 left today")).toBeInTheDocument();
        view.unmount();

        tab({ canBackUp: false });
        await user.click(await rowOf("shop_a"));
        expect(within(await screen.findByRole("dialog")).queryByRole("button", { name: "Back up now" })).not.toBeInTheDocument();
    });

    it("waits while a backup runs, and says so", async () => {
        const user = userEvent.setup();
        actions.getSharedOverview.mockResolvedValue({ success: true, data: { databases: [{ ...allowed, onDemand: { perDay: 3, usedToday: 2, active: { requestId: "req-1", state: "running" } } }, CRM, OLD], backups: BACKUPS } });
        actions.getSharedBackupRun.mockResolvedValue({ success: true, data: { state: "running", databaseName: "shop_a", startedAt: null, endedAt: null } });
        tab();
        await user.click(await rowOf("shop_a"));
        const panel = await screen.findByRole("dialog");
        expect(within(panel).getByRole("button", { name: "Back up now" })).toBeDisabled();
        expect(within(panel).getByText("A backup runs now")).toBeInTheDocument();
    });
});
