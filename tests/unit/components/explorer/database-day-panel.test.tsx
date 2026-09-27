import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { destination, file, job, run, stored } from "../storage/explorer-fixtures";
import { dbRun, fetchMock, overview, serve } from "./database-fixtures";

const push = vi.fn();
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
    useSearchParams: () => new URLSearchParams(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/auth/client", () => ({
    useSession: () => ({ data: { user: { timezone: "UTC", dateFormat: "yyyy-MM-dd", timeFormat: "HH:mm" } } }),
}));
const runJob = vi.fn();
vi.mock("@/components/dashboard/widgets/use-run-job", () => ({ useRunJob: () => ({ runJob, startingJobId: null }) }));

import { DatabaseDayPanel, type DayPanelAccess } from "@/components/dashboard/explorer/database-day-panel";

const ACCESS: DayPanelAccess = { canOpenBackups: true, canRestore: true, canDownload: true, canDelete: false, canManageVault: false, canViewHistory: true, canExecute: true };

function panel(day: string, access: Partial<DayPanelAccess> = {}) {
    const onRun = vi.fn();
    const onShow = vi.fn();
    render(<DatabaseDayPanel pick={{ key: "s1/shop", day, run: null }} overview={overview} access={{ ...ACCESS, ...access }} onRun={onRun} onShow={onShow} onClose={vi.fn()} />);
    return { onRun, onShow };
}

const late = file("Shop_nightly_late.tar", 1, { path: "Shop nightly/Shop_nightly_late.tar", databases: ["shop", "billing"] });

describe("the backups of a day beside the timeline", () => {
    beforeAll(() => {
        // Radix Select captures the pointer and scrolls the picked option into view, which jsdom does not implement.
        Element.prototype.hasPointerCapture = () => false;
        Element.prototype.releasePointerCapture = () => {};
        Element.prototype.scrollIntoView = vi.fn();
    });

    it("shows the backup of the newest run of the day, which restores the picked database alone", async () => {
        serve({
            runs: {
                runs: [
                    dbRun({ id: "early", startedAt: "2026-09-22T00:02:00Z", path: "Shop nightly/Shop_nightly_early.tar" }),
                    dbRun({ id: "late", startedAt: "2026-09-22T00:15:00Z", path: late.path }),
                ],
                versionChanges: [],
                planned: [],
            },
            backup: { run: run(late, "job-shop", [stored(late)]), job: job({}), chain: null, destinations: [destination("nas", "NAS Backups")] },
        });
        const user = userEvent.setup();
        panel("2026-09-22");

        await user.click(await screen.findByRole("button", { name: "Restore shop" }));
        expect(fetchMock.mock.calls.some(([url]) => String(url).includes(encodeURIComponent(late.path)))).toBe(true);
        expect(push).toHaveBeenLastCalledWith(expect.stringContaining("&pick=shop"));
        expect(screen.getByText("Picked on the timeline")).toBeInTheDocument();
    });

    it("lists the runs of the day by time in the dropdown, however many there are", async () => {
        serve({
            runs: {
                runs: [dbRun({ id: "early", startedAt: "2026-09-22T00:02:00Z" }), dbRun({ id: "late", startedAt: "2026-09-22T00:15:00Z" })],
                versionChanges: [],
                planned: [],
            },
        });
        const user = userEvent.setup();
        const { onRun } = panel("2026-09-22", { canOpenBackups: false });

        const dropdown = await screen.findByRole("combobox", { name: "Run of that day" });
        expect(dropdown).toHaveTextContent("00:15");
        await user.click(dropdown);
        await user.click(await screen.findByRole("option", { name: /00:02/ }));
        expect(onRun).toHaveBeenCalledWith("early");
    });

    it("says why a failed run made no backup, and shows the backup before it on a click", async () => {
        serve({
            runs: {
                runs: [
                    dbRun({ id: "before", startedAt: "2026-09-20T03:00:00Z" }),
                    dbRun({ id: "failed", startedAt: "2026-09-22T03:00:00Z", status: "Failed", error: "pg_dump: error: timeout expired" }),
                ],
                versionChanges: [],
                planned: [],
            },
        });
        const user = userEvent.setup();
        const { onShow } = panel("2026-09-22");

        expect(await screen.findByText("No backup was made")).toBeInTheDocument();
        expect(screen.getByText("pg_dump: error: timeout expired")).toBeInTheDocument();
        expect(fetchMock.mock.calls.find(([url]) => String(url).startsWith("/api/databases/runs"))?.[0]).toContain("errors=1");

        await user.click(screen.getByRole("button", { name: "Show" }));
        expect(onShow).toHaveBeenCalledWith("2026-09-20", "before");
    });

    it("offers to start a run the schedule plans later that day", async () => {
        const at = new Date(Date.now() + 2 * 3_600_000).toISOString();
        serve({ runs: { runs: [], versionChanges: [], planned: [{ jobId: "nightly", at }] } });
        const user = userEvent.setup();
        panel(at.slice(0, 10));

        await user.click(await screen.findByRole("button", { name: "Run now" }));
        expect(runJob).toHaveBeenCalledWith("nightly", "Shop nightly");
    });

    it("keeps the backup to itself for a viewer who may not see backups", async () => {
        serve({ runs: { runs: [dbRun({ id: "late", startedAt: "2026-09-22T00:15:00Z", path: late.path })], versionChanges: [], planned: [] } });
        panel("2026-09-22", { canOpenBackups: false });

        expect(await screen.findByText("Its backup is on the Backups page")).toBeInTheDocument();
        await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith("/api/storage/explorer/backup"))).toBe(false));
    });
});
