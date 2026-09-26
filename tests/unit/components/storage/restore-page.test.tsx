import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { encodeUrlPayload } from "@/lib/url-payload";

let search = new URLSearchParams();
const push = vi.fn();
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push, replace: vi.fn() }),
    useSearchParams: () => search,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/auth/client", () => ({
    useSession: () => ({ data: { user: { timezone: "UTC", dateFormat: "yyyy-MM-dd", timeFormat: "HH:mm" } } }),
}));
vi.mock("@/hooks/use-user-preferences", () => ({ useUserPreferences: () => ({ autoRedirectOnJobStart: true }) }));
vi.mock("@/app/actions/templates", () => ({ getExcludePatternPresets: vi.fn().mockResolvedValue({ success: true, data: [] }) }));
vi.mock("@/app/actions/backup/config-management", () => ({ restoreFromStorageAction: vi.fn() }));
// The dialogs and the tree have tests of their own. Here they only have to mount.
vi.mock("@/components/common/encryption-key-resolution-dialog", () => ({ EncryptionKeyResolutionDialog: () => null }));
vi.mock("@/components/dashboard/storage/archive-file-tree", () => ({ ArchiveFileTree: () => <p>The files of the folder</p> }));
vi.mock("@/components/dashboard/storage/folder-picker-dialog", () => ({ FolderPickerDialog: () => null }));
vi.mock("@/components/dashboard/storage/restore/redis-guide", () => ({ RedisGuide: () => <p>The Redis guide</p> }));

import { RestoreClient } from "@/app/dashboard/storage/restore/restore-client";

// cmdk scrolls the highlighted row of a list into view, which jsdom cannot do.
Element.prototype.scrollIntoView = vi.fn();

const GB = 1024 ** 3;
const FILE = {
    name: "Shop_nightly_2026-09-24.tar", path: "Shop nightly/Shop_nightly_2026-09-24.tar", size: 104 * 1024 ** 2, lastModified: "2026-09-24T03:00:00.000Z",
    createdAt: "2026-09-24T03:00:00.000Z", jobId: "job-shop", jobName: "Shop nightly", sourceType: "postgres", engineVersion: "16.4", backupType: "full", hasFileIndex: true,
};

interface Setup {
    directories?: unknown[];
    restore?: { success: boolean; error?: string; executionId?: string };
}

function serve({ directories = [], restore = { success: true, executionId: "exec-1" } }: Setup = {}) {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
        const json = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data }) as Response;
        if (url === "/api/adapters?type=database") return json([{ id: "staging", name: "Shop staging", adapterId: "postgres" }, { id: "crm", name: "CRM", adapterId: "mysql" }]);
        if (url === "/api/adapters?type=storage&role=SOURCE") return json([{ id: "web", name: "Web server", adapterId: "sftp" }]);
        if (url === "/api/adapters/database-stats") {
            return json({ success: true, serverVersion: "16.4", databases: [{ name: "shop", sizeInBytes: 2.3 * GB }, { name: "orders", sizeInBytes: GB }] });
        }
        if (url === "/api/storage/nas/analyze") {
            return json({ sourceType: "postgres", databases: ["shop", "billing", "analytics"], databaseDetails: [{ name: "shop", size: 1.2 * GB }], directories });
        }
        if (url === "/api/storage/nas/restore-files") return json({ success: true, data: { fileCount: 12, totalBytes: 1024, fullDownload: false } });
        if (url === "/api/storage/web/check-path") return json({ status: "occupied" });
        if (url === "/api/storage/nas/restore") return json(restore, restore.success ? 202 : 400);
        if (url.startsWith("/api/storage/explorer")) return json({ success: false, error: "not here" }, 403);
        throw new Error(`Unexpected request ${url} ${init?.method ?? "GET"}`);
    }));
}

async function pickServer(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole("combobox", { name: "Server to restore into" }));
    await user.click(await screen.findByRole("option", { name: /Shop staging/ }));
}

describe("Restore page", () => {
    beforeEach(() => {
        search = new URLSearchParams({ destinationId: "nas", file: encodeUrlPayload(FILE) });
        push.mockClear();
        serve();
    });

    it("offers only servers of the kind of the backup and says why Restore waits for one", async () => {
        const user = userEvent.setup();
        render(<RestoreClient />);

        expect(await screen.findByText("Pick the server the databases go to")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Restore 3 databases" })).toBeDisabled();
        await user.click(screen.getByRole("combobox", { name: "Server to restore into" }));
        expect(screen.getByRole("option", { name: /Shop staging/ })).toBeInTheDocument();
        expect(screen.queryByRole("option", { name: /CRM/ })).not.toBeInTheDocument();
    });

    it("shows each database beside the server, with what happens to it, and restores one as a copy", async () => {
        const user = userEvent.setup();
        render(<RestoreClient />);
        await pickServer(user);

        const shop = await screen.findByRole("textbox", { name: "Name of shop on the server" });
        const row = shop.closest("div.grid") as HTMLElement;
        expect(within(row).getByText("Overwrites 2.3 GB")).toBeInTheDocument();
        expect(screen.getByText("Same version as the backup, PostgreSQL 16.4")).toBeInTheDocument();
        expect(screen.getByText("orders")).toBeInTheDocument();
        expect(screen.getByText("Restores 3 databases into Shop staging")).toBeInTheDocument();

        await user.click(screen.getByRole("checkbox", { name: "Restore analytics" }));
        expect(screen.getByText("Restores 2 databases into Shop staging")).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Restore as a copy" }));
        expect(screen.getByRole("textbox", { name: "Name of shop on the server" })).toHaveValue("shop_restored");
        expect(screen.getByText(/shop comes back as shop_restored/)).toBeInTheDocument();
    });

    it("draws the databases as lines, the ones that do the same in one bundle", async () => {
        const user = userEvent.setup();
        render(<RestoreClient />);
        await pickServer(user);

        await user.click(await screen.findByRole("tab", { name: "Lines view" }));

        expect(screen.getByText("overwrites")).toBeInTheDocument();
        // billing and analytics are both new under their own names.
        await user.click(screen.getByRole("button", { name: /2 databases/ }));
        expect(screen.getByRole("textbox", { name: "Name of billing on the server" })).toBeInTheDocument();
        expect(screen.queryByRole("textbox", { name: "Name of shop on the server" })).not.toBeInTheDocument();
    });

    it("restores a backup with databases and folders in two steps, the databases first", async () => {
        serve({ directories: [{ jobSourceId: "src-1", label: "Uploads", fileCount: 12, totalSize: 1024, excludePatterns: [], origin: { configId: "web", configName: "Web server", path: "/var/www/uploads" } }] });
        const user = userEvent.setup();
        render(<RestoreClient />);
        await pickServer(user);

        const steps = await screen.findByRole("navigation", { name: "Restore steps" });
        expect(within(steps).getByText("Databases")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: /Next: files/ }));

        expect(await screen.findByRole("textbox", { name: "Path of Uploads" })).toHaveValue("/var/www/uploads");
        expect(await screen.findByText("Has files, same names are replaced")).toBeInTheDocument();
        await waitFor(() => expect(screen.getByRole("button", { name: "Restore 3 databases, 1 folder" })).toBeEnabled());
    });

    it("keeps the choices after a start the server turned down and offers an admin login", async () => {
        serve({ restore: { success: false, error: "permission denied to create database billing." } });
        const user = userEvent.setup();
        render(<RestoreClient />);
        await pickServer(user);

        await user.click(await screen.findByRole("button", { name: "Restore 3 databases" }));
        const dialog = await screen.findByRole("alertdialog");
        expect(within(dialog).getByText("Restore into Shop staging?")).toBeInTheDocument();
        expect(within(dialog).getByText("Overwrites 1 database, cannot be undone")).toBeInTheDocument();
        await user.click(within(dialog).getByRole("button", { name: "Restore 3 databases" }));

        expect(await screen.findByText("The restore could not start")).toBeInTheDocument();
        expect(screen.getByText("An admin login for this restore")).toBeInTheDocument();
        expect(screen.getByRole("textbox", { name: "User" })).toHaveValue("postgres");
        expect(screen.getByRole("textbox", { name: "Name of shop on the server" })).toBeInTheDocument();
        expect(push).not.toHaveBeenCalled();
    });

    it("moves on to the run in History once the restore started", async () => {
        const user = userEvent.setup();
        render(<RestoreClient />);
        await pickServer(user);

        await user.click(await screen.findByRole("button", { name: "Restore 3 databases" }));
        await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Restore 3 databases" }));

        await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/history?executionId=exec-1&autoOpen=true"));
    });
});
