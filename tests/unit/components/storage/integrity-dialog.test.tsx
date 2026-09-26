import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/lib/auth/client", () => ({
    useSession: () => ({ data: { user: { timezone: "UTC", dateFormat: "yyyy-MM-dd", timeFormat: "HH:mm" } } }),
}));

import { IntegrityDialog } from "@/components/dashboard/storage/integrity/integrity-dialog";
import type { BackupCopy, ExplorerDestination, ExplorerFile } from "@/services/storage/explorer-types";

const MB = 1024 ** 2;
const file = (verification?: ExplorerFile["verification"]) => ({
    name: "UI_Test_2026-09-26.tar", path: "UI Test/UI_Test_2026-09-26.tar", size: 140 * MB, lastModified: "2026-09-26T11:27:00.000Z", jobName: "UI Test",
    checksum: "00955c11a29acd91836047459732c05862d9c02ddf618aa60704ceef5f486e39", checksumMd5: "e37c83b42c730721062df4ed61eb3337", verification,
}) as ExplorerFile;
const destination = (id: string, name: string, adapterId: string, checksNatively: boolean) => ({
    id, name, adapterId, checksNatively, health: { status: "ONLINE", checkedAt: null, error: null, latencyMs: 10, answeredAt: null },
}) as unknown as ExplorerDestination;

const DESTINATIONS = new Map([
    ["nas", destination("nas", "NAS Backups", "local-filesystem", true)],
    ["sftp", destination("sftp", "Hetzner Box", "sftp", false)],
    ["drive", destination("drive", "Google Drive", "google-drive", true)],
    ["s3", destination("s3", "S3 Frankfurt", "s3-generic", true)],
]);
const COPIES: BackupCopy[] = [
    { destinationId: "nas", state: "stored", file: file({ verifiedAt: "2026-09-26T11:27:00.000Z", passed: true, trigger: "post-upload", method: "native" }) },
    { destinationId: "sftp", state: "stored", file: file() },
    { destinationId: "drive", state: "stored", file: file({ verifiedAt: "2026-09-22T04:00:00.000Z", passed: false, trigger: "scheduled", method: "native" }) },
    { destinationId: "s3", state: "missing" },
];

let status: { executionId: string; status: string; progress: number; copies: { destinationId: string; file: string; state: string; processed?: number; total?: number }[] };

function serve() {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
        const json = (data: unknown) => ({ ok: true, status: 200, json: async () => data }) as Response;
        if (url === "/api/storage/verify-copies") return json({ success: true, data: { executionId: "exec-1" } });
        if (url.startsWith("/api/storage/verify-copies?executionId=")) return json({ success: true, data: status });
        throw new Error(`Unexpected request ${url}`);
    }));
}

const props = { open: true, onOpenChange: vi.fn(), file: COPIES[0].file!, copies: COPIES, focusDestinationId: "sftp", destinations: DESTINATIONS, canViewHistory: true, onChanged: vi.fn() };
const rowOf = (name: string) => screen.getByText(name).closest("li") as HTMLElement;

describe("Integrity dialog", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        serve();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("lists every copy with its last check and how it is checked, the one it was opened from first", () => {
        render(<IntegrityDialog {...props} />);

        const rows = within(screen.getByRole("region", { name: "Copies" })).getAllByRole("listitem");
        expect(rows.map((row) => within(row).getByText(/NAS Backups|Hetzner Box|Google Drive|S3 Frankfurt/).textContent)).toEqual(["Hetzner Box", "NAS Backups", "Google Drive", "S3 Frankfurt"]);
        expect(within(rowOf("NAS Backups")).getByText("Passed")).toBeInTheDocument();
        expect(within(rowOf("NAS Backups")).getByText("2026-09-26 11:27 · after the upload")).toBeInTheDocument();
        expect(within(rowOf("Hetzner Box")).getByText("Downloads 140 MB to hash it")).toBeInTheDocument();
        expect(within(rowOf("Google Drive")).getByText("Does not match")).toBeInTheDocument();
        expect(within(rowOf("S3 Frankfurt")).getByRole("button", { name: "Verify the copy at S3 Frankfurt" })).toBeDisabled();
        expect(screen.getByText("Google Drive holds a file that differ from the upload", { exact: false })).toBeInTheDocument();
        expect(screen.getByText("1 passed · 1 does not match · 1 not checked · 1 missing")).toBeInTheDocument();
    });

    it("checks all copies there are, the ones without a download first, and follows the check", async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        render(<IntegrityDialog {...props} />);

        await user.click(screen.getByRole("button", { name: "Verify all 3 copies" }));
        expect(fetch).toHaveBeenCalledWith("/api/storage/verify-copies", expect.objectContaining({
            body: JSON.stringify({ copies: [{ destinationId: "nas", file: COPIES[0].file!.path }, { destinationId: "drive", file: COPIES[0].file!.path }, { destinationId: "sftp", file: COPIES[0].file!.path }] }),
        }));

        // The run started, and the dialog follows it from here.
        expect(await screen.findByText("Checking 3 copies")).toBeInTheDocument();
        status = { executionId: "exec-1", status: "Running", progress: 40, copies: [
            { destinationId: "nas", file: "x", state: "passed" }, { destinationId: "drive", file: "x", state: "passed" },
            { destinationId: "sftp", file: "x", state: "checking", processed: 42 * MB, total: 140 * MB },
        ] };
        await act(async () => {
            vi.advanceTimersByTime(1600);
        });
        expect(await within(rowOf("Hetzner Box")).findByText("Checking 30%")).toBeInTheDocument();
        expect(within(rowOf("Hetzner Box")).getByText("42 MB of 140 MB downloaded")).toBeInTheDocument();
        expect(screen.getByText("2 of 3 done")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Open in History" })).toHaveAttribute("href", "/dashboard/history?executionId=exec-1");

        status = { ...status, status: "Success", progress: 100, copies: status.copies.map((copy) => ({ ...copy, state: "passed" })) };
        await act(async () => {
            vi.advanceTimersByTime(1600);
        });
        expect(toast.success).toHaveBeenCalledWith("The checked copies match their checksum");
        expect(props.onChanged).toHaveBeenCalledTimes(1);
    });

    it("checks one copy on its own", async () => {
        const user = userEvent.setup();
        render(<IntegrityDialog {...props} />);

        await user.click(screen.getByRole("button", { name: "Verify the copy at Hetzner Box" }));

        expect(fetch).toHaveBeenCalledWith("/api/storage/verify-copies", expect.objectContaining({
            body: JSON.stringify({ copies: [{ destinationId: "sftp", file: COPIES[0].file!.path }] }),
        }));
    });
});
