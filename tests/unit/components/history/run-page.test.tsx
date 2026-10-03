import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { detail, dumpingDetail, integrityDetail, liveDetail, serve } from "./history-fixtures";

let search = new URLSearchParams();
const push = vi.fn();
const replace = vi.fn();
const back = vi.fn();
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push, replace, back }),
    useSearchParams: () => search,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/auth/client", () => ({
    useSession: () => ({ data: { user: { timezone: "UTC", dateFormat: "yyyy-MM-dd", timeFormat: "HH:mm" } } }),
}));

import { originOf, runHref } from "@/components/dashboard/history/run-links";
import { RunPage } from "@/components/dashboard/history/run-page";

Element.prototype.scrollIntoView = vi.fn();
const access = { canExecute: true, canOpenJobs: true, canOpenBackups: true, canOpenConnections: true };
const open = (address: string) => {
    search = new URLSearchParams(address);
    return render(<RunPage access={access} />);
};

describe("run links", () => {
    it("name the page a run was opened from, and lead to History from outside the app", () => {
        expect(runHref("a b", "overview")).toBe("/dashboard/history/run?id=a%20b&from=overview");
        expect(originOf("jobs")).toEqual({ key: "jobs", label: "Jobs", href: "/dashboard/jobs" });
        expect(originOf(null).label).toBe("History");
        expect(originOf("elsewhere").key).toBe("history");
    });
});

describe("the page of a run", () => {
    beforeEach(() => {
        push.mockClear();
        replace.mockClear();
        back.mockClear();
    });

    it("names where the back arrow leads and goes there", async () => {
        serve();
        const user = userEvent.setup();
        open("id=offsite&from=overview");

        const button = await screen.findByRole("button", { name: "Back to Overview" });
        await user.click(button);
        // A fresh tab has nothing to go back to, so it opens the Overview.
        expect(push).toHaveBeenCalledWith("/dashboard");
    });

    it("shows the steps with their usual times, every copy under its step, and the numbers of the run", async () => {
        serve();
        open("id=offsite&from=history");

        const steps = await screen.findByRole("region", { name: "Steps" });
        expect(within(steps).getByText("3m 10s")).toBeInTheDocument();
        expect(within(steps).getByText("NAS Backups")).toBeInTheDocument();
        expect(within(steps).getByText("403 quota")).toBeInTheDocument();
        expect(within(steps).getByText("1 of 2 stored")).toBeInTheDocument();
        expect(screen.getByText("Google Drive failed")).toBeInTheDocument();
    });

    it("tells each problem once in plain words, with what to do and a way to its lines", async () => {
        serve();
        const user = userEvent.setup();
        open("id=offsite");

        expect(await screen.findByText("To look at")).toBeInTheDocument();
        expect(screen.getByText("Google Drive is full")).toBeInTheDocument();
        expect(screen.getByText("Tried 3 times, the tries are folded into this one")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: /Open destination/ })).toHaveAttribute("href", "/dashboard/connections?tab=destinations");

        // Show in log opens the log at the lines of the problem.
        await user.click(screen.getAllByRole("button", { name: /Show in log/ })[0]);
        const log = screen.getByRole("region", { name: "Log" });
        expect(within(log).getByText("the 3 lines of this problem")).toBeInTheDocument();
        // The problems count in the order of the log, the dump warning comes first.
        expect(within(log).getByText("2 of 2")).toBeInTheDocument();
    });

    it("shows only the lines of a step once it is picked", async () => {
        serve();
        const user = userEvent.setup();
        open("id=offsite");

        const steps = await screen.findByRole("region", { name: "Steps" });
        await user.click(screen.getByRole("tab", { name: /Log/ }));
        await user.click(within(steps).getByRole("button", { name: /Dumping databases/ }));
        const log = screen.getByRole("region", { name: "Log" });
        expect(within(log).getByRole("combobox", { name: "The step the log shows" })).toHaveTextContent("Dumping databases");
        expect(within(log).queryByText("Upload complete: Shop offsite/a.tar")).not.toBeInTheDocument();

        await user.click(within(log).getByRole("button", { name: "Show every step" }));
        expect(within(log).getByText("Upload complete: Shop offsite/a.tar")).toBeInTheDocument();
    });

    it("follows a live run with its progress, the upload in one row, who waits and a way to cancel it", async () => {
        serve({ run: liveDetail() });
        open("id=crm&from=overview");

        expect(await screen.findByRole("button", { name: /Cancel run/ })).toBeInTheDocument();
        expect(screen.getAllByText("Live").length).toBeGreaterThan(0);
        expect(screen.getByText("Waits for this run")).toBeInTheDocument();
        expect(screen.getByText("Shop nightly")).toBeInTheDocument();
        // The summary fills the row of the destination that uploads now.
        const summary = screen.getByRole("region", { name: "Summary" });
        expect(within(summary).getByText(/64 % · 39 MB of 61 MB/)).toBeInTheDocument();
        expect(within(summary).getByText(/Then Verifying/)).toBeInTheDocument();

        await userEvent.setup().click(screen.getByRole("tab", { name: /Log/ }));
        const log = screen.getByRole("region", { name: "Log" });
        expect(within(log).getByText(/64 % · 39 MB of 61 MB/)).toBeInTheDocument();
        expect(within(log).getByRole("button", { name: /Following/ })).toBeInTheDocument();
        expect(within(log).getByText(/Then Verifying/)).toBeInTheDocument();
    });

    it("tells each step in a sentence, and one click on a row shows its whole command and its lines", async () => {
        serve({ run: detail({ status: "Success", steps: [...detail().steps, { name: "Sending Notifications", state: "skipped", startedAt: null, durationMs: null, usualMs: null, errors: 0, warnings: 0, lines: [] }] }) });
        const user = userEvent.setup();
        open("id=offsite");

        const summary = await screen.findByRole("region", { name: "Summary" });
        expect(within(summary).getByText("Found shop and billing on Shop cluster, engine 16.4.")).toBeInTheDocument();
        // A step the run never needed stays out, like on the left.
        expect(within(summary).queryByText("Sending Notifications")).not.toBeInTheDocument();
        expect(within(summary).getByText(/Dumped shop and billing with/)).toHaveTextContent("Dumped shop and billing with pg_dump.");

        // A database with a warning is open by itself: its whole command in one piece, and the warning once with its count.
        const shop = within(summary).getByRole("button", { name: /shop/ });
        expect(shop).toHaveAttribute("aria-expanded", "true");
        expect(within(summary).getByText("db.internal").closest("div")).toHaveTextContent("$ pg_dump -h db.internal -p 5432 -U backup -F c -Z 6 -d shop");
        expect(within(summary).getByText("Circular foreign keys in orders")).toBeInTheDocument();
        expect(within(summary).getByText("×1")).toBeInTheDocument();
        // A database with nothing more to show does not open.
        expect(within(summary).getByRole("button", { name: /billing/ })).toBeDisabled();

        // A destination says how many lines it wrote, one click shows them, with nothing more to open.
        const nas = within(summary).getByRole("button", { name: /NAS Backups/ });
        expect(nas).toHaveTextContent("stored in 1m 12s · 1 line");
        await user.click(nas);
        expect(within(summary).getByText("Upload complete: Shop offsite/a.tar")).toBeInTheDocument();
        expect(within(summary).getByText(/c5bc45b2…f654650d/)).toBeInTheDocument();
    });

    it("fills the row of the database it dumps now, with what its tool counted and the time left", async () => {
        serve({ run: dumpingDetail() });
        open("id=mongo");

        const summary = await screen.findByRole("region", { name: "Summary" });
        expect(within(summary).getByText("35 % · 526,527 of 1,500,000 documents")).toBeInTheDocument();
        expect(within(summary).getByText("about 40s left")).toBeInTheDocument();
        expect(within(summary).getByText("stress_data")).toBeInTheDocument();
        expect(within(summary).getByText("2 collections · 1,500,001 documents")).toBeInTheDocument();
        // The output of the tool is open while it dumps.
        expect(within(summary).getByText(/testdb1\.stress_data 526527\/1500000/)).toBeInTheDocument();
    });

    it("shows the log as built, the tool that wrote a line as a badge and each command under its line", async () => {
        serve({ run: dumpingDetail() });
        const user = userEvent.setup();
        open("id=mongo");

        await user.click(await screen.findByRole("tab", { name: /Log 4 lines/ }));
        const log = screen.getByRole("region", { name: "Log" });
        // The dump is started once in words and once with its command, only the one with the command shows.
        expect(within(log).getAllByText("Dumping database: testdb1")).toHaveLength(1);
        expect(within(log).getByRole("button", { name: "Open the whole command" })).toBeInTheDocument();
        // The time mongodump writes into its lines is left out, the log shows its own.
        expect(within(log).getByText(/testdb1\.stress_data 526527\/1500000/)).toHaveTextContent(/^mongodump \[#/);
        expect(within(log).queryByText(/2026-09-27T17:01:37/)).not.toBeInTheDocument();
        // The group heads of the steps stay, and what dumps now fills a row at the end.
        expect(within(log).getByText("Dumping databases")).toBeInTheDocument();
        expect(within(log).getByText("35 % · 526,527 of 1,500,000 documents")).toBeInTheDocument();
    });

    it("tells warnings of many kinds as one problem that opens by kind", async () => {
        serve({ run: detail({ problems: [{
            id: "p1", tone: "warning", title: "26 warnings while dumping databases", raw: "Element [dbo].[a] is a history table", step: "Dumping Databases", subject: null, at: "", tries: [], help: null, actions: [],
            kinds: [
                { title: "Generated always columns of ledger tables are left out", count: 16, raw: "Element [dbo].[t].[c] is a column with system-generated values", help: "SQL Server fills them again." },
                { title: "History tables of ledger tables are left out", count: 10, raw: "Element [dbo].[h] is a history table", help: null },
            ],
        }] }) });
        const user = userEvent.setup();
        open("id=offsite");

        expect(await screen.findByText("26 warnings while dumping databases")).toBeInTheDocument();
        expect(screen.getByText("×16")).toBeInTheDocument();
        expect(screen.queryByText("SQL Server fills them again.")).not.toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: /Generated always columns/ }));
        expect(screen.getByText("SQL Server fills them again.")).toBeInTheDocument();
        expect(screen.getByText("and 15 more lines like it")).toBeInTheDocument();
    });

    it("shows every copy an integrity check checked, the one it checks now first, with its destinations beside it", async () => {
        serve({ run: integrityDetail() });
        const user = userEvent.setup();
        open("id=integrity");

        const destinations = await screen.findByRole("region", { name: "Destinations" });
        expect(within(destinations).getByText("3 of 5 copies, one after the other")).toBeInTheDocument();
        expect(within(destinations).getByText("2 of 3")).toBeInTheDocument();
        expect(within(destinations).getByText(/downloads each copy to hash it/)).toBeInTheDocument();

        const copies = screen.getByRole("region", { name: "Copies" });
        const rows = within(copies).getAllByRole("row").slice(1);
        expect(rows[0]).toHaveTextContent("Wiki weekly");
        expect(rows[0]).toHaveTextContent("63 % · 30.99 MB of 49.59 MB");
        expect(rows[1]).toHaveTextContent("expected 91ac…2e10, got 0b7f…c9d4");
        expect(screen.getByText("Checked")).toBeInTheDocument();

        await user.click(within(copies).getByRole("button", { name: /Differ/ }));
        expect(within(copies).getAllByRole("row")).toHaveLength(2);
    });

    it("steps to the run before without losing where the back arrow leads", async () => {
        serve();
        const user = userEvent.setup();
        open("id=offsite&from=jobs");

        await user.click(await screen.findByRole("button", { name: "The run before" }));
        expect(replace).toHaveBeenCalledWith("/dashboard/history/run?id=offsite-before&from=jobs", { scroll: false });
    });

    it("says when a run is gone and leads back", async () => {
        serve({ run: null });
        open("id=gone&from=backups");

        expect(await screen.findByText("This run could not be found")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: /Back to Backups/ })).toHaveAttribute("href", "/dashboard/backups");
    });

    it("explains a log that data retention removed", async () => {
        serve({ run: detail({ logsPurgedAt: "2026-09-01T00:00:00.000Z" }) });
        open("id=offsite");

        expect(await screen.findByText("The log of this run was removed")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Copy the log" })).toBeDisabled();
    });
});
