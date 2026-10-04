import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ViewMode } from "@/lib/core/table-preferences";
import { measureTimeline } from "../storage/explorer-fixtures";
import { destination, file, job, run, stored } from "../storage/explorer-fixtures";
import { ago, dbRun, onPhone, overview, serve } from "./database-fixtures";

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
vi.mock("@/app/actions/auth/table-preferences", () => ({ saveViewLayout: vi.fn().mockResolvedValue({ success: true }) }));

import { DatabaseExplorer } from "@/components/dashboard/explorer/database-explorer";

Element.prototype.scrollIntoView = vi.fn();

const explorer = (view: ViewMode) => (
    <DatabaseExplorer canOpenBackups canRestore canDownload canDelete={false} canManageVault={false} canViewHistory canExecute initialView={view} />
);
const page = (view: ViewMode = "table") => render(explorer(view));

describe("Database Explorer", () => {
    beforeEach(() => {
        search = new URLSearchParams();
        replace.mockClear();
        push.mockClear();
    });

    it("sets the servers and jobs apart that have no database under the picked engine", async () => {
        serve();
        const user = userEvent.setup();
        page();

        await user.click(await screen.findByRole("button", { name: "Engine" }));
        await user.click(screen.getByRole("option", { name: /PostgreSQL/ }));
        await user.keyboard("{Escape}");

        await user.click(screen.getByRole("button", { name: "Server" }));
        expect(await screen.findByText("No databases with the other filters")).toBeInTheDocument();
        expect(screen.getByRole("option", { name: /Shop cluster/ })).not.toHaveAttribute("aria-disabled", "true");
        expect(screen.getByRole("option", { name: /ERP/ })).toHaveAttribute("aria-disabled", "true");
        expect(screen.getByRole("option", { name: /Cache/ })).toHaveAttribute("aria-disabled", "true");
        await user.keyboard("{Escape}");

        // Each job of a database counts on its own.
        await user.click(screen.getByRole("button", { name: "Job" }));
        expect(await screen.findByRole("option", { name: /Shop nightly/ })).not.toHaveAttribute("aria-disabled", "true");
        expect(screen.getByRole("option", { name: /In no job/ })).not.toHaveAttribute("aria-disabled", "true");
        expect(screen.getByRole("option", { name: /ERP nightly/ })).toHaveAttribute("aria-disabled", "true");
        expect(screen.getByRole("option", { name: /Cache daily/ })).toHaveAttribute("aria-disabled", "true");
    });

    it("shows the databases as cards on a phone, each opening its page", async () => {
        serve();
        await onPhone(async () => {
            page();

            expect(await screen.findByRole("link", { name: /^shop/ })).toHaveAttribute("href", "/dashboard/explorer/database?server=s1&database=shop");
            // The link sits in the head of its card.
            const analytics = screen.getByRole("link", { name: /^analytics/ }).parentElement!.parentElement!;
            expect(within(analytics).getByText("In no job")).toBeInTheDocument();
            expect(screen.queryByRole("table")).not.toBeInTheDocument();
        });
    });

    it("lists every database with the jobs that back it up, and the ones in no job", async () => {
        serve();
        page();

        const shop = (await screen.findByText("shop")).closest("tr")!;
        expect(within(shop).getByText("Shop nightly")).toBeInTheDocument();
        expect(within(screen.getByText("analytics").closest("tr")!).getByText("In no job")).toBeInTheDocument();
        // A server that does not tell the size to its login shows a dash instead of zero.
        expect(within(screen.getByText("erp").closest("tr")!).getByTitle("The server does not tell the size to this login")).toBeInTheDocument();
        expect(screen.getByText("In no job", { selector: "div" })).toBeInTheDocument();
    });

    it("shows a Redis server as one entry with its keys instead of a row per numbered database", async () => {
        serve();
        page();

        const cache = (await screen.findByRole("link", { name: "Cache" })).closest("tr")!;
        expect(within(cache).getByText("184.3K keys")).toBeInTheDocument();
        expect(within(cache).getByText("Redis 7.2.5 · 2 of 16 databases hold keys")).toBeInTheDocument();
        expect(screen.queryByText("db0")).not.toBeInTheDocument();
    });

    it("opens a database as a page of its own on a click on its row", async () => {
        serve();
        const user = userEvent.setup();
        page();

        await user.click(within((await screen.findByText("shop")).closest("tr")!).getByText("Shop nightly"));
        expect(push).toHaveBeenLastCalledWith("/dashboard/explorer/database?server=s1&database=shop");
        expect(screen.getByRole("link", { name: "Cache" })).toHaveAttribute("href", "/dashboard/explorer/database?server=s3");
    });

    it("starts filtered to the databases of the connection it was opened from", async () => {
        search = new URLSearchParams("sourceId=s2");
        serve();
        page();

        expect(await screen.findByText("erp")).toBeInTheDocument();
        expect(screen.queryByText("analytics")).not.toBeInTheDocument();
    });

    it("leaves out the jobs, the backups and the timeline for a viewer who may not see jobs", async () => {
        serve({ data: { ...overview, coverage: false, jobs: [], databases: overview.databases.map((database) => ({ ...database, jobIds: [], lastBackup: null })) } });
        page("timeline");

        expect(await screen.findByText("shop")).toBeInTheDocument();
        expect(screen.queryByText("Backed up by")).not.toBeInTheDocument();
        expect(screen.queryByRole("tab", { name: "Timeline view" })).not.toBeInTheDocument();
    });

    it("shows the databases by day with the new version of a server, and a day shows its backup beside the timeline", async () => {
        measureTimeline();
        const yesterday = ago(24);
        const made = file("Shop_nightly_yesterday.tar", 24, { path: "Shop nightly/Shop_nightly_yesterday.tar" });
        serve({
            backup: { run: run(made, "job-shop", [stored(made)]), job: job({}), chain: null, destinations: [destination("nas", "NAS Backups")] },
            runs: {
                runs: [dbRun({ id: "r1", startedAt: yesterday, path: made.path })],
                versionChanges: [
                    { serverId: "s1", previousVersion: "16.2", newVersion: "16.3", detectedAt: ago(48), downgrade: false },
                    { serverId: "s1", previousVersion: "16.3", newVersion: "16.4", detectedAt: yesterday, downgrade: false },
                ],
                planned: [],
            },
        });
        const view = page("timeline");

        // Updates on days in a row each get a mark of their own.
        expect(await screen.findByLabelText("Updated to 16.4")).toBeInTheDocument();
        expect(screen.getByLabelText("Updated to 16.3")).toBeInTheDocument();
        expect(screen.getByRole("group", { name: "Shop cluster" })).toBeInTheDocument();

        const day = yesterday.slice(0, 10);
        const user = userEvent.setup();
        await user.click(screen.getAllByRole("button", { name: new RegExp(`^shop, .*${day}$`) })[0]);
        expect(replace).toHaveBeenLastCalledWith(`/dashboard/explorer?database=s1%2Fshop&day=${day}`, { scroll: false });

        // A narrow window gets the panel as a sheet, a wide one beside the timeline.
        view.rerender(explorer("timeline"));
        const panel = await screen.findByRole("dialog", { name: "Backups of the day" });
        expect(await within(panel).findByRole("button", { name: "Restore shop" })).toBeInTheDocument();
        expect(within(panel).getByRole("combobox", { name: "Run of that day" })).toHaveTextContent("Shop nightly");
        expect(within(panel).getByText("Picked on the timeline")).toBeInTheDocument();
    });

    it("folds a server into one row with its runs, which the pages count once", async () => {
        measureTimeline();
        serve({ runs: { runs: [dbRun({ id: "r1", startedAt: ago(24) })], versionChanges: [], planned: [] } });
        const user = userEvent.setup();
        page("timeline");

        expect(await screen.findByText("1 to 4 of 4 rows")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Fold Shop cluster" }));

        const group = screen.getByRole("group", { name: "Shop cluster" });
        expect(within(group).queryByRole("link", { name: /analytics/ })).not.toBeInTheDocument();
        expect(within(group).getByText("PostgreSQL 16.4 · 2 databases, 1 in a job")).toBeInTheDocument();
        expect(within(group).getAllByRole("button", { name: /^Shop cluster, / })).toHaveLength(1);
        expect(screen.getByText("1 to 3 of 3 rows")).toBeInTheDocument();
    });
});
