import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { formatInTimeZone } from "date-fns-tz";
import type { ExplorerDestination, ExplorerFile, ExplorerIndex, ExplorerJob, ExplorerJobView, ExplorerDestinationView } from "@/services/storage/explorer-types";

let search = new URLSearchParams();
const replace = vi.fn((url: string) => {
    search = new URLSearchParams(url.split("?")[1] ?? "");
});
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace }),
    useSearchParams: () => search,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/auth/client", () => ({
    useSession: () => ({ data: { user: { timezone: "UTC", dateFormat: "yyyy-MM-dd", timeFormat: "HH:mm" } } }),
}));
vi.mock("@/app/actions/storage/lock", () => ({ lockBackup: vi.fn() }));
// The dialogs behind the actions have tests of their own. Here they only have to mount.
vi.mock("@/components/dashboard/storage/download-link-modal", () => ({ DownloadLinkModal: () => null }));
vi.mock("@/components/dashboard/storage/database-download-dialog", () => ({ DatabaseDownloadDialog: () => null }));
vi.mock("@/components/dashboard/storage/integrity-modal", () => ({ IntegrityModal: () => null }));
vi.mock("@/components/common/encryption-key-resolution-dialog", () => ({ EncryptionKeyResolutionDialog: () => null }));
vi.mock("@/components/dashboard/storage/storage-history-tab", () => ({ StorageHistoryTab: () => <p>History of the destination</p> }));
vi.mock("@/components/dashboard/storage/storage-settings-tab", () => ({ StorageSettingsTab: () => <p>Alerts of the destination</p> }));

import { StorageClient } from "@/app/dashboard/storage/storage-client";

const now = Date.now();
const hoursAgo = (hours: number) => new Date(now - hours * 3_600_000).toISOString();

function destination(id: string, name: string, overrides: Partial<ExplorerDestination> = {}): ExplorerDestination {
    return {
        id,
        name,
        adapterId: "local-filesystem",
        listedAt: hoursAgo(0.5),
        listError: null,
        listing: false,
        health: { status: "ONLINE", checkedAt: hoursAgo(0), error: null },
        count: 3,
        size: 300,
        ...overrides,
    };
}

function job(overrides: Partial<ExplorerJob>): ExplorerJob {
    return {
        key: "job-shop",
        kind: "job",
        name: "Shop nightly",
        jobId: "job-shop",
        sourceType: "postgres",
        sourceName: "Shop",
        hasFolders: false,
        incremental: false,
        configuredDestinationIds: ["nas", "r2"],
        destinationIds: ["nas", "r2"],
        runs: 2,
        size: 400,
        newest: hoursAgo(3),
        oldest: hoursAgo(27),
        failedChecks: 0,
        missingCopies: 1,
        locked: 0,
        ...overrides,
    };
}

function file(name: string, hours: number, overrides: Partial<ExplorerFile> = {}): ExplorerFile {
    return {
        name,
        path: `Shop nightly/${name}`,
        size: 100,
        lastModified: hoursAgo(hours),
        createdAt: hoursAgo(hours),
        jobId: "job-shop",
        jobName: "Shop nightly",
        sourceName: "Shop",
        sourceType: "postgres",
        databases: ["shop", "billing"],
        backupType: "full",
        trigger: { type: "Scheduler" },
        ...overrides,
    };
}

const newest = file("Shop_nightly_newest.tar", 3, { verification: { verifiedAt: hoursAgo(2.9), passed: true, trigger: "post-upload" } });
const older = file("Shop_nightly_older.tar", 27);
const erp = file("ERP_invoices_old.tar", 500, { path: "ERP/ERP_invoices_old.tar", jobId: "job-erp", jobName: "ERP invoices", databases: ["erp"] });
const erpOlder = file("ERP_invoices_older.tar", 524, { path: "ERP/ERP_invoices_older.tar", jobId: "job-erp", jobName: "ERP invoices", databases: ["erp"] });

const index: ExplorerIndex = {
    destinations: [destination("nas", "NAS Backups"), destination("r2", "Cloudflare R2", { health: { status: "OFFLINE", checkedAt: hoursAgo(0), error: "timeout" } })],
    jobs: [
        job({}),
        job({ key: "deleted:job-erp", kind: "deleted", name: "ERP invoices", jobId: "job-erp", configuredDestinationIds: [], destinationIds: ["nas"], newest: hoursAgo(500), runs: 2, missingCopies: 0 }),
    ],
};

const jobView: ExplorerJobView = {
    job: index.jobs[0],
    runs: [
        {
            path: newest.path, jobKey: "job-shop", file: newest, createdAt: newest.createdAt!, execution: null,
            copies: [{ destinationId: "nas", state: "stored", file: newest }, { destinationId: "r2", state: "stored", file: newest }],
        },
        {
            path: older.path, jobKey: "job-shop", file: older, createdAt: older.createdAt!,
            execution: { id: "exec-1", status: "Partial", startedAt: hoursAgo(27), endedAt: hoursAgo(26.9) },
            copies: [{ destinationId: "nas", state: "stored", file: older }, { destinationId: "r2", state: "missing" }],
        },
    ],
};

const destinationView: ExplorerDestinationView = {
    destination: index.destinations[0],
    backups: [
        { file: newest, jobKey: "job-shop", elsewhere: [{ destinationId: "r2", state: "stored" }] },
        { file: older, jobKey: "job-shop", elsewhere: [{ destinationId: "r2", state: "missing" }] },
        { file: erp, jobKey: "deleted:job-erp", elsewhere: [] },
        { file: erpOlder, jobKey: "deleted:job-erp", elsewhere: [] },
    ],
};

const chainFile = (index: number, hours: number) =>
    file(`${index === 0 ? "full-000" : `inc-00${index}`}-Media_sync.tar`, hours, {
        path: `Media sync/chain-1/${index === 0 ? "full-000" : `inc-00${index}`}-Media_sync.tar`,
        jobId: "job-media",
        jobName: "Media sync",
        sourceType: "directory-only",
        databases: undefined,
        combined: { databases: 0, directorySources: 2 },
        backupType: index === 0 ? "full" : "incremental",
        chain: { id: "chain-1", type: index === 0 ? "full" : "incremental", index },
        size: index === 0 ? 8_000 : 100,
        logicalSize: 8_000 + index * 100,
    });
const chain = [chainFile(0, 72), chainFile(1, 48), chainFile(2, 24), chainFile(3, 1)];
const media = job({ key: "job-media", name: "Media sync", jobId: "job-media", sourceType: null, hasFolders: true, incremental: true, configuredDestinationIds: ["nas"], destinationIds: ["nas"], runs: 4, newest: hoursAgo(10) });
const mediaView: ExplorerJobView = {
    job: media,
    runs: [...chain].reverse().map((entry) => ({
        path: entry.path, jobKey: "job-media", file: entry, createdAt: entry.createdAt!, execution: null,
        copies: [{ destinationId: "nas", state: "stored" as const, file: entry }],
    })),
};

const ok = (data: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, data }) } as Response);
/** A backup the way the timeline names it, in the formats of the signed in user. */
const shown = (entry: ExplorerFile) => formatInTimeZone(new Date(entry.createdAt!), "UTC", "yyyy-MM-dd HH:mm");

function renderPage() {
    return render(<StorageClient canDownload canRestore canDelete canViewHistory />);
}

describe("Storage Explorer", () => {
    beforeEach(() => {
        search = new URLSearchParams();
        vi.stubGlobal("fetch", vi.fn((url: string) => {
            if (url === "/api/storage/explorer") return ok({ ...index, jobs: [...index.jobs, media] });
            if (url === "/api/storage/explorer/jobs/job-media") return ok(mediaView);
            if (url.startsWith("/api/storage/explorer/jobs/")) return ok(jobView);
            if (url.startsWith("/api/storage/explorer/destinations/")) return ok(destinationView);
            return ok(null);
        }));
    });

    it("opens on the job with the newest backup and shows where each run lies", async () => {
        renderPage();

        expect(await screen.findByText("Cloudflare R2 missing")).toBeInTheDocument();
        expect(screen.getAllByText("NAS Backups").length).toBeGreaterThan(0);
        expect(screen.getByRole("combobox", { name: "Pick a job" })).toHaveTextContent("Shop nightly");
    });

    it("opens the details of a run with its copies and the reason for the missing one", async () => {
        const user = userEvent.setup();
        renderPage();

        const missing = await screen.findByText("Cloudflare R2 missing");
        await user.click(missing.closest("tr")!);

        const panel = await screen.findByRole("dialog");
        expect(within(panel).getByText("1 of 2 copies is missing")).toBeInTheDocument();
        expect(within(panel).getByText(/The run ended as Partial, its upload to Cloudflare R2 failed\./)).toBeInTheDocument();
        expect(within(panel).getByText("Stored at")).toBeInTheDocument();
        expect(within(panel).getByText("billing")).toBeInTheDocument();
    });

    it("tells which destination did not answer", async () => {
        const user = userEvent.setup();
        renderPage();

        await user.click(await screen.findByRole("button", { name: "How old the lists are" }));
        expect(await screen.findByText("1 destination did not answer")).toBeInTheDocument();
        expect(screen.getByText(/Not reachable/)).toBeInTheDocument();
    });

    it("shows a folder per job on a destination and offers to delete the backups of a deleted job inside its folder", async () => {
        const user = userEvent.setup();
        search = new URLSearchParams("destination=nas");
        const { rerender } = renderPage();

        const folder = await screen.findByRole("button", { name: /^ERP invoices/ });
        expect(screen.getByRole("button", { name: /^Shop nightly/ })).toBeInTheDocument();
        expect(screen.queryByText("ERP_invoices_old.tar")).not.toBeInTheDocument();

        await user.click(folder);
        expect(new URLSearchParams(replace.mock.lastCall![0].split("?")[1]).get("folder")).toBe("deleted:job-erp");
        rerender(<StorageClient canDownload canRestore canDelete canViewHistory />);

        expect(await screen.findByText("Retention stopped with the job, so these backups stay until you delete them.")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Delete 2 backups/ })).toBeInTheDocument();
        expect(screen.getByText("ERP_invoices_old.tar")).toBeInTheDocument();
        expect(screen.queryByText("Shop_nightly_newest.tar")).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "All folders" })).toBeInTheDocument();
    });

    it("lists every backup of a destination in one list, so backups of different jobs can be picked together", async () => {
        search = new URLSearchParams("destination=nas&layout=all");
        renderPage();

        expect(await screen.findByText("Shop_nightly_newest.tar")).toBeInTheDocument();
        expect(screen.getByText("ERP_invoices_old.tar")).toBeInTheDocument();
        expect(screen.getByRole("columnheader", { name: "Job" })).toBeInTheDocument();
        expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(4);
    });

    it("opens the folder of a job from its lane on the timeline of a destination", async () => {
        const user = userEvent.setup();
        search = new URLSearchParams("destination=nas&view=timeline");
        const { rerender } = renderPage();

        const lane = await screen.findByRole("button", { name: /^Shop nightly/ });
        expect(screen.queryByRole("button", { name: "Open in Jobs" })).not.toBeInTheDocument();

        await user.click(lane);
        rerender(<StorageClient canDownload canRestore canDelete canViewHistory />);

        expect(await screen.findByRole("button", { name: "Open in Jobs" })).toBeInTheDocument();
        expect(screen.getByText("Shop_nightly_newest.tar")).toBeInTheDocument();
        expect(screen.queryByText("ERP_invoices_old.tar")).not.toBeInTheDocument();
    });

    it("groups an incremental job by chain and shows what a restore of one of them reads", async () => {
        const user = userEvent.setup();
        search = new URLSearchParams("job=job-media");
        renderPage();

        expect(await screen.findByText("4 backups · the current chain")).toBeInTheDocument();
        await user.click(screen.getByText("Incremental · 2").closest("tr")!);

        const panel = await screen.findByRole("dialog");
        expect(within(panel).getByText("Its chain")).toBeInTheDocument();
        expect(within(panel).getByText(/A restore reads the full and the incrementals 1 to 2/)).toBeInTheDocument();
        expect(within(panel).getByText(/Incremental 3 builds on it, so it can only be deleted together with it\./)).toBeInTheDocument();
    });

    it("finds a job from an older link by its name", async () => {
        search = new URLSearchParams("destination=nas&job=Shop%20nightly");
        renderPage();

        await waitFor(() => expect(screen.getByRole("combobox", { name: "Pick a job" })).toHaveTextContent("Shop nightly"));
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
                if (url.startsWith("/api/storage/explorer/jobs/")) return ok(listing ? { ...jobView, runs: [] } : jobView);
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

    it("shows only the timeline until the job is clicked, since the list below would repeat it", async () => {
        const user = userEvent.setup();
        search = new URLSearchParams("view=timeline");
        renderPage();

        const lane = await screen.findByRole("button", { name: /^Shop nightly/ });
        expect(screen.queryByText("Cloudflare R2 missing")).not.toBeInTheDocument();

        await user.click(lane);
        expect(await screen.findByText("Cloudflare R2 missing")).toBeInTheDocument();

        await user.click(lane);
        await waitFor(() => expect(screen.queryByText("Cloudflare R2 missing")).not.toBeInTheDocument());
    });

    it("lists the backups of a day picked on the timeline and opens the details from that list", async () => {
        const user = userEvent.setup();
        search = new URLSearchParams("view=timeline");
        renderPage();

        await user.click(await screen.findByRole("button", { name: `${shown(newest)} · Full` }));

        expect(await screen.findByText("Verified")).toBeInTheDocument();
        expect(screen.queryByText("Cloudflare R2 missing")).not.toBeInTheDocument();
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

        await user.click(screen.getByText("Verified").closest("tr")!);
        expect(await screen.findByRole("dialog")).toBeInTheDocument();
    });

    it("shows every backup of the job again once the picked day is removed", async () => {
        const user = userEvent.setup();
        search = new URLSearchParams("view=timeline");
        renderPage();

        await user.click(await screen.findByRole("button", { name: `${shown(newest)} · Full` }));
        await user.click(await screen.findByRole("button", { name: /show every day/ }));

        expect(await screen.findByText("Cloudflare R2 missing")).toBeInTheDocument();
        expect(screen.getByText("Verified")).toBeInTheDocument();
    });

    it("opens the folder of a job on the day picked in its lane at a destination", async () => {
        const user = userEvent.setup();
        search = new URLSearchParams("destination=nas&view=timeline");
        const { rerender } = renderPage();

        await user.click(await screen.findByRole("button", { name: `${shown(erp)} · Full` }));
        rerender(<StorageClient canDownload canRestore canDelete canViewHistory />);

        expect(await screen.findByText("ERP_invoices_old.tar")).toBeInTheDocument();
        expect(screen.queryByText("ERP_invoices_older.tar")).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: /show every day/ })).toBeInTheDocument();
    });
});
