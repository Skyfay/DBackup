import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/lib/auth/client", () => ({ useSession: () => ({ data: null }) }));

import { FolderPickerDialog } from "@/components/dashboard/storage/folder-picker-dialog";

type Tree = Record<string, { name: string; path: string }[]>;

/** Answers the browse API like a source whose folders are the tree. A level not in it fails. */
function serve(tree: Tree, supported = true) {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
        const path = new URL(url, "http://localhost").searchParams.get("path") ?? "";
        const body = tree[path] ? { success: true, supported, data: { path, entries: tree[path] } } : { success: false, error: `Cannot open ${path}` };
        return { ok: body.success, status: body.success ? 200 : 500, json: async () => body } as Response;
    }));
}

const NAS: Tree = {
    "": [{ name: "srv", path: "srv" }, { name: ".trash", path: ".trash" }],
    srv: [{ name: "www", path: "srv/www" }],
    "srv/www": [{ name: "html", path: "srv/www/html" }, { name: "logs", path: "srv/www/logs" }],
    "srv/www/html": [],
};

const props = { open: true, onOpenChange: vi.fn(), configId: "nas", configName: "NAS Backups", onSelect: vi.fn() };
/** The footer shows the pick with its full path as the title. */
const picked = (value: string) => screen.findByTitle(value);
const row = async (name: string) => (await screen.findAllByRole("button", { name })).find((button) => button.hasAttribute("data-entry"))!;
const part = (name: string) => within(screen.getByRole("navigation", { name: "Path" })).getByRole("button", { name });

describe("picking the folder a restore goes into", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        serve(NAS);
    });

    it("opens at the deepest folder of the path in the field that exists", async () => {
        const user = userEvent.setup();
        render(<FolderPickerDialog {...props} initialPath="/srv/www/new-site" />);

        expect(await picked("/srv/www")).toBeInTheDocument();
        expect(part("www")).toHaveAttribute("aria-current", "location");
        expect(await row("html")).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Use this folder" }));
        expect(props.onSelect).toHaveBeenCalledWith("/srv/www");
    });

    it("goes into a folder with a click and back up with a part of the path, hidden folders left out", async () => {
        const user = userEvent.setup();
        render(<FolderPickerDialog {...props} />);

        expect(await picked("/")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: ".trash" })).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Show 1 hidden" })).toBeInTheDocument();

        await user.click(await row("srv"));
        await user.click(await row("www"));
        expect(await picked("/srv/www")).toBeInTheDocument();

        await user.click(part("srv"));
        expect(await picked("/srv")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Go to /" }));
        expect(await picked("/")).toBeInTheDocument();
    });

    it("follows the IDs of a destination like Google Drive and hands back the names", async () => {
        serve({ "": [{ name: "Backups", path: "1AbC" }], "1AbC": [{ name: "Restores", path: "9XyZ" }], "9XyZ": [] });
        const user = userEvent.setup();
        render(<FolderPickerDialog {...props} configName="Google Drive" initialPath="/Backups/Restores" />);

        expect(await picked("/Backups/Restores")).toBeInTheDocument();
        expect(fetch).toHaveBeenLastCalledWith("/api/adapters/nas/browse?path=9XyZ");

        await user.click(part("Backups"));
        expect(await picked("/Backups")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Use this folder" }));
        expect(props.onSelect).toHaveBeenCalledWith("/Backups");
    });

    it("stays where it is when a folder cannot be opened", async () => {
        serve({ "": [{ name: "locked", path: "locked" }] });
        const user = userEvent.setup();
        render(<FolderPickerDialog {...props} />);

        await user.click(await row("locked"));

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Cannot open locked"));
        expect(await picked("/")).toBeInTheDocument();
    });

    it("says so when the destination cannot list its folders", async () => {
        serve({ "": [] }, false);
        render(<FolderPickerDialog {...props} configName="Old FTP" />);

        expect(await screen.findByText("Old FTP cannot list its folders. Type the path in the field instead.")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Use this folder" })).toBeDisabled();
    });
});

describe("picking the Docker volume a restore goes into", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        serve({ "": [{ name: "app_data", path: "app_data" }, { name: "db_data", path: "db_data" }] });
    });

    it("picks a volume whole, the one in the field already picked", async () => {
        const user = userEvent.setup();
        render(<FolderPickerDialog {...props} configName="Docker host" flat itemNoun="volume" initialPath="db_data" />);

        expect(await picked("db_data")).toBeInTheDocument();
        expect(screen.queryByRole("navigation", { name: "Path" })).not.toBeInTheDocument();

        await user.click(await row("app_data"));
        expect(await picked("app_data")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Use this volume" }));
        expect(props.onSelect).toHaveBeenCalledWith("app_data");
    });
});
