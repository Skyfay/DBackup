import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ViewMode } from "@/lib/core/table-preferences";
import { measureTimeline } from "../storage/explorer-fixtures";
import { ago, overview, serve } from "./database-fixtures";

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

const page = (view: ViewMode = "table") => render(<DatabaseExplorer canOpenBackups initialView={view} />);

describe("Database Explorer", () => {
    beforeEach(() => {
        search = new URLSearchParams();
        replace.mockClear();
        push.mockClear();
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

    it("shows the databases by day with the new version of a server, and a day opens the database with its runs", async () => {
        measureTimeline();
        const yesterday = ago(24);
        serve({
            runs: {
                runs: [{ id: "r1", jobId: "nightly", serverId: "s1", status: "Success", startedAt: yesterday, size: 104, databases: ["shop"], destinations: [] }],
                versionChanges: [
                    { serverId: "s1", previousVersion: "16.2", newVersion: "16.3", detectedAt: ago(48), downgrade: false },
                    { serverId: "s1", previousVersion: "16.3", newVersion: "16.4", detectedAt: yesterday, downgrade: false },
                ],
                planned: [],
            },
        });
        page("timeline");

        // Updates on days in a row each get a mark of their own.
        expect(await screen.findByLabelText("Updated to 16.4")).toBeInTheDocument();
        expect(screen.getByLabelText("Updated to 16.3")).toBeInTheDocument();
        expect(screen.getByRole("group", { name: "Shop cluster" })).toBeInTheDocument();

        const day = yesterday.slice(0, 10);
        const cell = screen.getAllByRole("link", { name: new RegExp(`^shop, .*${day}$`) })[0];
        expect(cell).toHaveAttribute("href", `/dashboard/explorer/database?server=s1&database=shop&day=${day}`);
    });
});
