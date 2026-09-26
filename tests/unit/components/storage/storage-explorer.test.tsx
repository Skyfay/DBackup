import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { formatInTimeZone } from "date-fns-tz";
import type { ViewMode } from "@/lib/core/table-preferences";
import { hoursAgo, destination, newest, older, index, stored, run, runs, ok, at, measureTimeline } from "./explorer-fixtures";

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
// The dialogs behind the actions have tests of their own. Here they only have to mount.
vi.mock("@/components/dashboard/storage/download/download-dialog", () => ({ DownloadDialog: () => null }));
vi.mock("@/components/dashboard/storage/integrity/integrity-dialog", () => ({ IntegrityDialog: () => null }));
vi.mock("@/components/common/encryption-key-resolution-dialog", () => ({ EncryptionKeyResolutionDialog: () => null }));
vi.mock("@/app/actions/storage/storage-alerts", () => ({ updateStorageAlertSettings: vi.fn().mockResolvedValue({ success: true }) }));

import { StorageClient } from "@/app/dashboard/storage/storage-client";

// The list of a filter scrolls its active option into view, which jsdom cannot do.
Element.prototype.scrollIntoView = vi.fn();

function page(view: ViewMode = "table", destinationsView: ViewMode = "table") {
    return <StorageClient canDownload canRestore canDelete canViewHistory canEditAlerts initialLayout={null} initialViews={{ backups: view, destinations: destinationsView }} />;
}

function renderPage(view: ViewMode = "table", destinationsView: ViewMode = "table") {
    return render(page(view, destinationsView));
}

/** The rows of the list of backups, without the popovers the filters open. */
const table = () => screen.getByRole("table");

describe("Storage Explorer", () => {
    beforeEach(() => {
        search = new URLSearchParams();
        replace.mockClear();
        push.mockClear();
        vi.stubGlobal("fetch", vi.fn((url: string) => {
            if (url === "/api/storage/explorer") return ok(index);
            if (url === "/api/storage/explorer/runs") return ok({ runs });
            if (url.startsWith("/api/storage/explorer/execution")) {
                const path = new URLSearchParams(url.split("?")[1]).get("path");
                return ok(path === older.path ? { id: "exec-1", status: "Partial", startedAt: hoursAgo(27), endedAt: hoursAgo(26.9) } : null);
            }
            if (url.endsWith("/files/bulk")) return ok({ succeeded: [newest.path], failed: [] });
            return ok(null);
        }));
    });

    it("lists every backup of every job with where each copy lies", async () => {
        renderPage();

        expect(await screen.findByText("Cloudflare R2 missing")).toBeInTheDocument();
        expect(within(table()).getAllByText("Shop nightly")).toHaveLength(2);
        expect(within(table()).getAllByText("Media sync")).toHaveLength(4);
        expect(within(table()).getAllByText("ERP invoices")).toHaveLength(2);
        expect(screen.getByRole("tab", { name: /Backups/ })).toHaveAttribute("aria-selected", "true");
    });

    it("opens the details of a backup with its copies and the reason for the missing one", async () => {
        const user = userEvent.setup();
        renderPage();

        await user.click((await screen.findByText("Cloudflare R2 missing")).closest("tr")!);

        const panel = await screen.findByRole("dialog");
        expect(within(panel).getByText("1 of 2 copies is missing")).toBeInTheDocument();
        expect(await within(panel).findByText(/The run ended as Partial, its upload to Cloudflare R2 failed\./)).toBeInTheDocument();
        expect(within(panel).getByText("billing")).toBeInTheDocument();
    });

    it("folds many destinations into the ones up to date and the rest, and counts them on the button", async () => {
        const user = userEvent.setup();
        const many = [1, 2, 3, 4, 5].map((n) => destination(`d${n}`, `Store ${n}`));
        many.push(destination("d6", "Store 6", { health: { status: "OFFLINE", checkedAt: hoursAgo(0), error: "timeout", latencyMs: null, answeredAt: null } }));
        many.push(destination("d7", "Store 7", { listError: "Permission denied" }));
        vi.stubGlobal("fetch", vi.fn((url: string) => {
            if (url === "/api/storage/explorer") return ok({ ...index, destinations: many });
            if (url === "/api/storage/explorer/runs") return ok({ runs: [] });
            return ok(null);
        }));
        renderPage();

        const button = await screen.findByRole("button", { name: "How old the lists are" });
        expect(button).toHaveTextContent("5 of 7 up to date");
        await user.click(button);

        expect(await screen.findByRole("button", { name: /Not up to date/ })).toHaveAttribute("aria-expanded", "true");
        expect(screen.getByText("Store 6")).toBeInTheDocument();
        expect(screen.queryByText("Store 1")).not.toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: /^Up to date/ }));
        expect(screen.getByText("Store 1")).toBeInTheDocument();
    });

    it("marks each copy with whether its destination answers right now, and says why on hover", async () => {
        const user = userEvent.setup();
        renderPage();

        const newestRow = (await screen.findAllByText("Shop nightly"))[0].closest("tr")!;
        expect(within(newestRow).getByText("offline")).toBeInTheDocument();
        expect(screen.getByText("Offline, a restore from it fails")).toBeInTheDocument();

        await user.hover(within(newestRow).getByText("Cloudflare R2"));
        const tip = await screen.findByRole("tooltip");
        expect(tip).toHaveTextContent("Cloudflare R2 is offline");
        expect(tip).toHaveTextContent("NAS Backups holds the same backup and answers right now.");
    });

    it("restores from a copy whose destination answers, even when it comes second in the upload order", async () => {
        const user = userEvent.setup();
        const answering = [run(newest, "job-shop", [stored(newest, "r2"), stored(newest)])];
        vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
            if (url === "/api/storage/explorer") return ok(index);
            if (url === "/api/storage/explorer/runs") return ok({ runs: answering });
            if (url === "/api/storage/explorer/refresh") return ok({ listing: JSON.parse(String(init?.body)).destinationIds });
            return ok(null);
        }));
        renderPage();

        await user.click((await screen.findByText("Shop nightly")).closest("tr")!);
        const panel = await screen.findByRole("dialog");
        expect(within(panel).getByText(/which answers right now\./)).toHaveTextContent("Restore and download read from NAS Backups, which answers right now.");
        expect(within(panel).getByText("1 of 2 answering right now")).toBeInTheDocument();

        await user.click(within(panel).getByRole("button", { name: "Check now" }));
        await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/storage/explorer/refresh", expect.objectContaining({ body: JSON.stringify({ destinationIds: ["r2"] }) })));
    });

    it("tells which destination did not answer, with the date of its last list and why on hover", async () => {
        const user = userEvent.setup();
        renderPage();

        await user.click(await screen.findByRole("button", { name: "How old the lists are" }));
        expect(await screen.findByText("1 destination did not answer")).toBeInTheDocument();
        const popover = screen.getByRole("dialog");
        const behind = within(popover).getByText("Cloudflare R2").closest("li")!;
        expect(behind).toHaveTextContent(`Compared ${at(hoursAgo(0.5))}`);
        expect(behind).toHaveAttribute("title", "Offline, it does not answer the connection check");
        expect(within(popover).getByText("NAS Backups").closest("li")).toHaveTextContent("Compared 30 minutes ago");
    });

    it("filters by job from a list split into jobs, deleted jobs and the rest", async () => {
        const user = userEvent.setup();
        const { rerender } = renderPage();

        await user.click(await screen.findByRole("button", { name: "Job" }));
        expect(await screen.findByText("Deleted jobs")).toBeInTheDocument();
        expect(screen.getByText("Jobs")).toBeInTheDocument();
        await user.click(screen.getByRole("option", { name: /ERP invoices/ }));

        expect(search.getAll("job")).toEqual(["deleted:job-erp"]);
        rerender(page());
        await waitFor(() => expect(within(table()).queryByText("Shop nightly")).not.toBeInTheDocument());
        expect(within(table()).getAllByText("ERP invoices")).toHaveLength(2);
    });

    it("sets the jobs without backups at the filtered destination apart at the end of the job filter", async () => {
        const user = userEvent.setup();
        search = new URLSearchParams("at=r2");
        renderPage();

        await user.click(await screen.findByRole("button", { name: "Job" }));

        expect(await screen.findByText("No backups with the other filters")).toBeInTheDocument();
        expect(screen.getByRole("option", { name: /Shop nightly/ })).not.toHaveAttribute("aria-disabled", "true");
        expect(screen.getByRole("option", { name: /Media sync/ })).toHaveAttribute("aria-disabled", "true");
        expect(screen.getByRole("option", { name: /ERP invoices/ })).toHaveAttribute("aria-disabled", "true");
    });

    it("filters by who started a run, with the people by hand and the API keys in groups of their own", async () => {
        const user = userEvent.setup();
        const { rerender } = renderPage();

        await user.click(await screen.findByRole("button", { name: "Started by" }));
        expect(await screen.findByText("By hand")).toBeInTheDocument();
        expect(screen.getByText("System")).toBeInTheDocument();
        expect(screen.getByText("API keys")).toBeInTheDocument();
        await user.click(screen.getByRole("option", { name: /Manu/ }));

        expect(search.getAll("by")).toEqual(["manual:Manu"]);
        rerender(page());
        await waitFor(() => expect(within(table()).getAllByText("Shop nightly")).toHaveLength(1));
        expect(within(table()).getByText("Cloudflare R2 missing")).toBeInTheDocument();
        expect(within(table()).queryByText("Media sync")).not.toBeInTheDocument();
    });

    it("counts only the copies at the destination it is filtered by", async () => {
        const user = userEvent.setup();
        search = new URLSearchParams("at=r2");
        const { rerender } = renderPage();

        await user.click(await screen.findByRole("button", { name: /^State/ }));
        expect(await screen.findByRole("option", { name: /A copy is missing\s*1/ })).toBeInTheDocument();
        expect(within(table()).getAllByText("Shop nightly")).toHaveLength(2);
        expect(within(table()).queryByText("Media sync")).not.toBeInTheDocument();
        await user.keyboard("{Escape}");

        // Every copy at the NAS is there, even of the backup that misses its copy at R2.
        search = new URLSearchParams("at=nas");
        rerender(page());
        await user.click(screen.getByRole("button", { name: /^State/ }));
        expect(await screen.findByRole("option", { name: /A copy is missing\s*0/ })).toBeInTheDocument();
    });

    it("folds the quick filters into a State filter that counts what needs a look", async () => {
        const user = userEvent.setup();
        renderPage();

        // The older backup misses its copy at R2, the newest has its only other copy there, which is offline.
        const state = await screen.findByRole("button", { name: /^State/ });
        expect(state).toHaveTextContent("1");
        await user.click(state);
        expect(await screen.findByText("Filter by state")).toBeInTheDocument();
        await user.click(screen.getByRole("option", { name: /A copy is missing/ }));

        await waitFor(() => expect(within(table()).getAllByText("Shop nightly")).toHaveLength(1));
        expect(within(table()).getByText("Cloudflare R2 missing")).toBeInTheDocument();
        expect(screen.getByText("1 of 5 picked")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Clear" }));
        await waitFor(() => expect(within(table()).getAllByText("Shop nightly")).toHaveLength(2));
    });

    it("deletes a backup only at the destination the list is filtered by", async () => {
        const user = userEvent.setup();
        search = new URLSearchParams("at=nas");
        renderPage();

        await user.click(await screen.findByRole("button", { name: `Open menu for ${newest.name}` }));
        await user.click(await screen.findByRole("menuitem", { name: /Delete/ }));
        await user.click(await screen.findByRole("button", { name: "Delete backup" }));

        await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/storage/nas/files/bulk", expect.anything()));
        expect(vi.mocked(fetch)).not.toHaveBeenCalledWith("/api/storage/r2/files/bulk", expect.anything());
    });

    it("shows what a restore of an incremental reads", async () => {
        const user = userEvent.setup();
        search = new URLSearchParams("job=job-media");
        renderPage();

        await user.click((await screen.findByText("Incremental · 2")).closest("tr")!);

        const panel = await screen.findByRole("dialog");
        expect(within(panel).getByText("Its chain")).toBeInTheDocument();
        expect(within(panel).getByText(/A restore reads the full and the incrementals 1 to 2/)).toBeInTheDocument();
        expect(within(panel).getByText(/Incremental 3 builds on it, so it can only be deleted together with it\./)).toBeInTheDocument();
    });

    it("turns an older link to a job at a destination into both filters", async () => {
        search = new URLSearchParams("destination=nas&job=Shop%20nightly");
        renderPage();

        await waitFor(() => expect(within(table()).getAllByText("Shop nightly")).toHaveLength(2));
        expect(within(table()).queryByText("Media sync")).not.toBeInTheDocument();
        expect(screen.getByRole("tab", { name: /Backups/ })).toHaveAttribute("aria-selected", "true");
    });

    it("shows the backups as cards on a phone, which gets no switch", async () => {
        const width = window.innerWidth;
        Object.defineProperty(window, "innerWidth", { value: 375, configurable: true });
        try {
            renderPage();

            expect(await screen.findByText("Cloudflare R2 missing")).toBeInTheDocument();
            expect(screen.queryByRole("table")).not.toBeInTheDocument();
            expect(screen.getAllByRole("button", { name: "Media sync" })).toHaveLength(4);
        } finally {
            Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
        }
    });

    it("leaves the cards to phones and shows a saved card view as the table", async () => {
        renderPage("cards");

        expect(await screen.findByRole("table")).toBeInTheDocument();
        expect(screen.getByRole("tab", { name: "Timeline view" })).toBeInTheDocument();
        expect(screen.queryByRole("tab", { name: "Cards view" })).not.toBeInTheDocument();
    });

    it("asks again while a destination is listed in the background and shows its backups once they are in", async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
            let listing = true;
            vi.stubGlobal("fetch", vi.fn((url: string) => {
                if (url === "/api/storage/explorer") {
                    return ok(listing
                        ? { ...index, destinations: [{ ...index.destinations[0], listing: true }, index.destinations[1]] }
                        : index);
                }
                if (url === "/api/storage/explorer/runs") return ok({ runs: listing ? [] : runs });
                return ok(null);
            }));
            renderPage();

            expect(await screen.findByText("Listing")).toBeInTheDocument();
            expect(screen.queryByText("Cloudflare R2 missing")).not.toBeInTheDocument();

            listing = false;
            await vi.advanceTimersByTimeAsync(3_000);

            expect(await screen.findByText("Cloudflare R2 missing")).toBeInTheDocument();
            expect(screen.queryByText("Listing")).not.toBeInTheDocument();
        } finally {
            vi.useRealTimers();
        }
    });

    it("shows every job by day in the timeline and lists the backups of a picked day of a job below it", async () => {
        const user = userEvent.setup();
        measureTimeline();
        const plan = { timezone: "UTC", days: 7, jobs: [{ jobKey: "job-shop", schedule: "0 3 * * *", enabled: true, createdAt: hoursAgo(2000), retention: null, planned: [{ at: hoursAgo(-24) }], missed: [], truncated: false }] };
        vi.stubGlobal("fetch", vi.fn((url: string) => {
            if (url === "/api/storage/explorer") return ok(index);
            if (url === "/api/storage/explorer/runs") return ok({ runs });
            if (url === "/api/storage/explorer/plan") return ok(plan);
            return ok(null);
        }));
        renderPage("timeline");

        expect(await screen.findByText("Timeline")).toBeInTheDocument();
        // The list waits for a pick on the timeline.
        expect(screen.queryByRole("table")).not.toBeInTheDocument();

        const day = formatInTimeZone(new Date(newest.createdAt!), "UTC", "EEE, yyyy-MM-dd");
        await user.click(await screen.findByRole("button", { name: `Shop nightly, ${day}` }));
        expect(await screen.findByRole("table")).toBeInTheDocument();
        expect(within(table()).getAllByText("Shop nightly")).toHaveLength(1);

        await user.click(screen.getByRole("button", { name: /show them all/ }));
        await waitFor(() => expect(screen.queryByRole("table")).not.toBeInTheDocument());

        // At today the arrow on the right adds the next days, and goes no further.
        await user.click(screen.getByRole("button", { name: "Show the next 7 days" }));
        expect(await screen.findByText(/Next 7 days, as the schedules plan them/)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Later days" })).toBeDisabled();
    });
});
