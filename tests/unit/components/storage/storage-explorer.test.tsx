import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { formatInTimeZone } from "date-fns-tz";
import type { ViewMode } from "@/lib/core/table-preferences";
import type { BackupRun, ExplorerDestination, ExplorerFile, ExplorerIndex, ExplorerJob, ExplorerDestinationView } from "@/services/storage/explorer-types";

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
vi.mock("@/app/actions/auth/table-preferences", () => ({
    saveTableLayout: vi.fn().mockResolvedValue({ success: true }),
    saveViewLayout: vi.fn().mockResolvedValue({ success: true }),
}));
// The dialogs behind the actions have tests of their own. Here they only have to mount.
vi.mock("@/components/dashboard/storage/download-link-modal", () => ({ DownloadLinkModal: () => null }));
vi.mock("@/components/dashboard/storage/database-download-dialog", () => ({ DatabaseDownloadDialog: () => null }));
vi.mock("@/components/dashboard/storage/integrity-modal", () => ({ IntegrityModal: () => null }));
vi.mock("@/components/common/encryption-key-resolution-dialog", () => ({ EncryptionKeyResolutionDialog: () => null }));
vi.mock("@/components/dashboard/storage/storage-history-tab", () => ({ StorageHistoryTab: () => <p>History of the destination</p> }));
vi.mock("@/components/dashboard/storage/storage-settings-tab", () => ({ StorageSettingsTab: () => <p>Alerts of the destination</p> }));

import { StorageClient } from "@/app/dashboard/storage/storage-client";

// The list of a filter scrolls its active option into view, which jsdom cannot do.
Element.prototype.scrollIntoView = vi.fn();

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
        health: { status: "ONLINE", checkedAt: hoursAgo(0), error: null, latencyMs: 12, answeredAt: null },
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
const older = file("Shop_nightly_older.tar", 27, { trigger: { type: "Manual", actor: "Manu" } });
const erp = file("ERP_invoices_old.tar", 500, { path: "ERP/ERP_invoices_old.tar", jobId: "job-erp", jobName: "ERP invoices", databases: ["erp"] });
const erpOlder = file("ERP_invoices_older.tar", 524, { path: "ERP/ERP_invoices_older.tar", jobId: "job-erp", jobName: "ERP invoices", databases: ["erp"], trigger: { type: "Api", actor: "Deploy hook" } });

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
const media = job({ key: "job-media", name: "Media sync", jobId: "job-media", sourceType: null, hasFolders: true, incremental: true, configuredDestinationIds: ["nas"], destinationIds: ["nas"], runs: 4, newest: hoursAgo(1) });

const index: ExplorerIndex = {
    destinations: [destination("nas", "NAS Backups"), destination("r2", "Cloudflare R2", { health: { status: "OFFLINE", checkedAt: hoursAgo(0), error: "timeout", latencyMs: 10_000, answeredAt: hoursAgo(1) } })],
    jobs: [
        job({}),
        media,
        job({ key: "deleted:job-erp", kind: "deleted", name: "ERP invoices", jobId: "job-erp", configuredDestinationIds: [], destinationIds: ["nas"], newest: hoursAgo(500), runs: 2, missingCopies: 0 }),
    ],
};

const stored = (entry: ExplorerFile, destinationId = "nas") => ({ destinationId, state: "stored" as const, file: entry });
const run = (entry: ExplorerFile, jobKey: string, copies: BackupRun["copies"]): BackupRun => ({ path: entry.path, jobKey, file: entry, createdAt: entry.createdAt!, copies });

const runs: BackupRun[] = [
    run(chain[3], "job-media", [stored(chain[3])]),
    run(newest, "job-shop", [stored(newest), stored(newest, "r2")]),
    run(chain[2], "job-media", [stored(chain[2])]),
    run(older, "job-shop", [stored(older), { destinationId: "r2", state: "missing" }]),
    run(chain[1], "job-media", [stored(chain[1])]),
    run(chain[0], "job-media", [stored(chain[0])]),
    run(erp, "deleted:job-erp", [stored(erp)]),
    run(erpOlder, "deleted:job-erp", [stored(erpOlder)]),
];

const destinationView: ExplorerDestinationView = {
    destination: index.destinations[0],
    backups: [
        { file: newest, jobKey: "job-shop", elsewhere: [{ destinationId: "r2", state: "stored" }] },
        { file: older, jobKey: "job-shop", elsewhere: [{ destinationId: "r2", state: "missing" }] },
        { file: erp, jobKey: "deleted:job-erp", elsewhere: [] },
        { file: erpOlder, jobKey: "deleted:job-erp", elsewhere: [] },
    ],
};

const ok = (data: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, data }) } as Response);
/** A backup the way the timeline names it, in the formats of the signed in user. */
const shown = (entry: ExplorerFile) => formatInTimeZone(new Date(entry.createdAt!), "UTC", "yyyy-MM-dd HH:mm");

function page(view: ViewMode = "table") {
    return <StorageClient canDownload canRestore canDelete canViewHistory initialLayout={null} initialView={view} />;
}

function renderPage(view: ViewMode = "table") {
    return render(page(view));
}

/** The rows of the list of backups, without the popovers the filters open. */
const table = () => screen.getByRole("table");

describe("Storage Explorer", () => {
    beforeEach(() => {
        search = new URLSearchParams();
        replace.mockClear();
        vi.stubGlobal("fetch", vi.fn((url: string) => {
            if (url === "/api/storage/explorer") return ok(index);
            if (url === "/api/storage/explorer/runs") return ok({ runs });
            if (url.startsWith("/api/storage/explorer/execution")) {
                const path = new URLSearchParams(url.split("?")[1]).get("path");
                return ok(path === older.path ? { id: "exec-1", status: "Partial", startedAt: hoursAgo(27), endedAt: hoursAgo(26.9) } : null);
            }
            if (url.startsWith("/api/storage/explorer/destinations/")) return ok(destinationView);
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
        expect((await screen.findAllByText("Cloudflare R2 is offline")).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/NAS Backups holds the same backup and answers right now\./).length).toBeGreaterThan(0);
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

    it("tells which destination did not answer", async () => {
        const user = userEvent.setup();
        renderPage();

        await user.click(await screen.findByRole("button", { name: "How old the lists are" }));
        expect(await screen.findByText("1 destination did not answer")).toBeInTheDocument();
        expect(screen.getByText(/Not reachable/)).toBeInTheDocument();
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
        expect(screen.getByText("API keys")).toBeInTheDocument();
        await user.click(screen.getByRole("option", { name: /Manu/ }));

        expect(search.getAll("by")).toEqual(["manual:Manu"]);
        rerender(page());
        await waitFor(() => expect(within(table()).getAllByText("Shop nightly")).toHaveLength(1));
        expect(within(table()).getByText("Cloudflare R2 missing")).toBeInTheDocument();
        expect(within(table()).queryByText("Media sync")).not.toBeInTheDocument();
    });

    it("counts only the copies at the destination it is filtered by", async () => {
        search = new URLSearchParams("at=r2");
        const { rerender } = renderPage();

        expect(await screen.findByRole("button", { name: /Copy missing\s*1/ })).toBeInTheDocument();
        expect(within(table()).getAllByText("Shop nightly")).toHaveLength(2);
        expect(within(table()).queryByText("Media sync")).not.toBeInTheDocument();

        // Every copy at the NAS is there, even of the backup that misses its copy at R2.
        search = new URLSearchParams("at=nas");
        rerender(page());
        expect(await screen.findByRole("button", { name: /Copy missing\s*0/ })).toBeInTheDocument();
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

    it("shows the backups as cards, the view a phone always gets", async () => {
        renderPage("cards");

        expect(await screen.findByText("Cloudflare R2 missing")).toBeInTheDocument();
        expect(screen.queryByRole("table")).not.toBeInTheDocument();
        expect(screen.getAllByRole("button", { name: "Media sync" })).toHaveLength(4);
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

    it("shows a folder per job on a destination and offers to delete the backups of a deleted job inside its folder", async () => {
        const user = userEvent.setup();
        search = new URLSearchParams("destination=nas");
        const { rerender } = renderPage();

        const folder = await screen.findByRole("button", { name: /^ERP invoices/ });
        expect(screen.getByRole("button", { name: /^Shop nightly/ })).toBeInTheDocument();
        expect(screen.queryByText("ERP_invoices_old.tar")).not.toBeInTheDocument();

        await user.click(folder);
        expect(search.get("folder")).toBe("deleted:job-erp");
        rerender(page());

        expect(await screen.findByText("Retention stopped with the job, so these backups stay until you delete them.")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Delete 2 backups/ })).toBeInTheDocument();
        expect(screen.getByText("ERP_invoices_old.tar")).toBeInTheDocument();
        expect(screen.queryByText("Shop_nightly_newest.tar")).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "All folders" })).toBeInTheDocument();
    });

    it("opens every backup of a job in the Backups tab from its folder at a destination", async () => {
        const user = userEvent.setup();
        search = new URLSearchParams("destination=nas&folder=job-shop");
        renderPage();

        await user.click(await screen.findByRole("button", { name: "Open in Backups" }));

        expect(search.getAll("job")).toEqual(["job-shop"]);
        expect(search.get("destination")).toBeNull();
    });

    it("opens the folder of a job from its lane on the timeline of a destination", async () => {
        const user = userEvent.setup();
        search = new URLSearchParams("destination=nas&view=timeline");
        const { rerender } = renderPage();

        const lane = await screen.findByRole("button", { name: /^Shop nightly/ });
        expect(screen.queryByRole("button", { name: "Open in Backups" })).not.toBeInTheDocument();

        await user.click(lane);
        rerender(page());

        expect(await screen.findByRole("button", { name: "Open in Backups" })).toBeInTheDocument();
        expect(screen.getByText("Shop_nightly_newest.tar")).toBeInTheDocument();
        expect(screen.queryByText("ERP_invoices_old.tar")).not.toBeInTheDocument();
    });

    it("opens the folder of a job on the day picked in its lane at a destination", async () => {
        const user = userEvent.setup();
        search = new URLSearchParams("destination=nas&view=timeline");
        const { rerender } = renderPage();

        await user.click(await screen.findByRole("button", { name: `${shown(erp)} · Full` }));
        rerender(page());

        expect(await screen.findByText("ERP_invoices_old.tar")).toBeInTheDocument();
        expect(screen.queryByText("ERP_invoices_older.tar")).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: /show every day/ })).toBeInTheDocument();
    });
});
