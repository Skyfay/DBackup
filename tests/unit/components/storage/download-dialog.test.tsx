import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({ startPreparedArchiveDownload: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn() } }));
vi.mock("@/lib/auth/client", () => ({
    useSession: () => ({ data: { user: { timezone: "UTC", dateFormat: "yyyy-MM-dd", timeFormat: "HH:mm" } } }),
}));
vi.mock("@/components/dashboard/storage/prepared-download", () => ({ startPreparedArchiveDownload: mocks.startPreparedArchiveDownload }));

import { DownloadDialog } from "@/components/dashboard/storage/download/download-dialog";
import type { ExplorerFile } from "@/services/storage/explorer-types";

const MB = 1024 ** 2;
const LINK = "https://dbackup.test/api/storage/public-download?token=abc";
const FILE = {
    name: "Shop_nightly_2026-09-24.tar", path: "Shop nightly/Shop_nightly_2026-09-24.tar", size: 900 * MB, lastModified: "2026-09-24T03:00:00.000Z",
    createdAt: "2026-09-24T03:00:00.000Z", jobName: "Shop nightly", sourceType: "postgres", isEncrypted: true, hasFileIndex: true,
} as ExplorerFile;

function serve(databases = ["shop", "billing", "analytics"]) {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
        const json = (data: unknown) => ({ ok: true, status: 200, json: async () => data }) as Response;
        if (url === "/api/storage/nas/analyze") {
            return json({
                sourceType: "postgres",
                databases,
                databaseDetails: databases.map((name, index) => ({ name, size: (index + 1) * 100 * MB })),
                directories: [{ jobSourceId: "src-1", label: "uploads", fileCount: 12480, totalSize: 300 * MB, origin: { path: "/var/www/uploads" } }],
            });
        }
        if (url === "/api/storage/nas/download-url" && init?.method === "POST") {
            return json({ success: true, data: { url: LINK, token: "abc", fileName: "Shop_nightly_2026-09-24_billing.dump" }, url: LINK });
        }
        if (url.startsWith("/api/storage/nas/download-url?token=")) {
            return json({ success: true, data: { state: "fetched", fetchedAt: Date.parse("2026-09-26T12:03:14Z"), fetchedFrom: "10.0.0.5" } });
        }
        throw new Error(`Unexpected request ${url}`);
    }));
}

const props = {
    open: true, onOpenChange: vi.fn(), destinationId: "nas", file: FILE,
    interceptKeyRequest: vi.fn(async () => false), onStored: vi.fn(), onDecrypted: vi.fn(),
};
const code = () => document.querySelector("pre code")?.textContent ?? "";

describe("Download dialog", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        serve();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("downloads one database as its dump and a mix as one tar.gz", async () => {
        const user = userEvent.setup();
        render(<DownloadDialog {...props} />);

        await user.click(await screen.findByRole("checkbox", { name: /billing/ }));
        expect(screen.getByText("its dump, decrypted and unpacked", { exact: false })).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Download billing" }));
        expect(mocks.startPreparedArchiveDownload).toHaveBeenLastCalledWith(expect.objectContaining({ body: { file: FILE.path, databases: ["billing"] } }));

        await user.click(screen.getByRole("checkbox", { name: /uploads/ }));
        expect(screen.getByText("billing and uploads")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Download as one tar.gz" }));
        expect(mocks.startPreparedArchiveDownload).toHaveBeenLastCalledWith(expect.objectContaining({
            body: { file: FILE.path, databases: ["billing"], selections: [{ src: "src-1" }] },
        }));
    });

    it("ticks every database from the head of the group", async () => {
        const user = userEvent.setup();
        render(<DownloadDialog {...props} />);

        await user.click(await screen.findByRole("checkbox", { name: "Pick all databases" }));

        expect(screen.getByText("All 3 databases")).toBeInTheDocument();
        expect(screen.queryByRole("textbox", { name: "Search databases" })).not.toBeInTheDocument();
    });

    it("offers a search in a group from eight entries on", async () => {
        serve(Array.from({ length: 12 }, (_, index) => `tenant_${index + 1}`));
        const user = userEvent.setup();
        render(<DownloadDialog {...props} />);

        await user.type(await screen.findByRole("textbox", { name: "Search databases" }), "tenant_1");
        await user.click(screen.getByRole("checkbox", { name: "Pick the shown databases" }));

        const databases = screen.getByRole("region", { name: "Databases" });
        expect(within(databases).getByText("4 of 12 shown ·", { exact: false })).toBeInTheDocument();
        expect(screen.getByText("4 databases")).toBeInTheDocument();
    });

    it("writes the link into the command and says when a server fetched it", async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        render(<DownloadDialog {...props} />);

        await user.click(await screen.findByRole("checkbox", { name: /billing/ }));
        await user.click(screen.getByRole("tab", { name: "A server" }));
        expect(code()).toBe('curl -fOJ "<make the link first>"');

        await user.click(screen.getByRole("button", { name: "Make the link" }));
        expect(await screen.findByText("The link is in the command")).toBeInTheDocument();
        expect(code()).toBe(`curl -fOJ "${LINK}"`);
        expect(fetch).toHaveBeenCalledWith("/api/storage/nas/download-url", expect.objectContaining({ body: JSON.stringify({ file: FILE.path, databases: ["billing"] }) }));

        await user.click(screen.getByRole("tab", { name: "PowerShell" }));
        expect(code()).toBe(`Invoke-WebRequest -UseBasicParsing -Uri '${LINK}' -OutFile 'Shop_nightly_2026-09-24_billing.dump'`);

        await act(async () => {
            vi.advanceTimersByTime(3100);
        });
        expect(await screen.findByText("Fetched at 12:03 from 10.0.0.5")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "New link" })).toBeEnabled();
    });

    it("opens the files of a folder on the restore page for single files", async () => {
        const onSingleFiles = vi.fn();
        const user = userEvent.setup();
        render(<DownloadDialog {...props} onSingleFiles={onSingleFiles} />);

        await user.click(await screen.findByRole("button", { name: "Single files of uploads" }));

        expect(onSingleFiles).toHaveBeenCalledTimes(1);
    });

    it("downloads an older backup as a whole, decrypted or as stored", async () => {
        const user = userEvent.setup();
        render(<DownloadDialog {...props} file={{ ...FILE, name: "Shop.sql.gz.enc", hasFileIndex: false }} />);

        expect(fetch).not.toHaveBeenCalled();
        await user.click(screen.getByRole("button", { name: "Download decrypted" }));
        expect(props.onDecrypted).toHaveBeenCalledTimes(1);

        await user.click(screen.getByRole("tab", { name: "As stored, encrypted" }));
        await user.click(screen.getByRole("button", { name: "Download as stored" }));
        expect(props.onStored).toHaveBeenCalledTimes(1);
    });
});
