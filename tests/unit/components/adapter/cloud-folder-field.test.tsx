import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FormProvider, useForm } from "react-hook-form";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/auth/client", () => ({ useSession: () => ({ data: null }) }));

import { CloudFolderField } from "@/components/adapter/cloud-folder-field";

type Folders = { name: string; path: string }[];

/** Answers the browse route of a drive like one whose folders are the tree, and a request for the way down with `trail`. */
function serve(tree: Record<string, Folders>, trail: Folders = []) {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}"));
        const at = body.folderPath ?? body.folderId ?? "";
        const answer = body.trail
            ? { success: true, data: { trail } }
            : tree[at]
              ? { success: true, data: { entries: tree[at].map((folder) => ({ ...folder, type: "directory" })) } }
              : { success: false, error: `Cannot open ${at}` };
        return { json: async () => answer } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
}

function Harness({ adapterId, config, authorized = true }: { adapterId: string; config: Record<string, string>; authorized?: boolean }) {
    const form = useForm({ defaultValues: { name: "Offsite", config } });
    return (
        <FormProvider {...form}>
            <CloudFolderField adapterId={adapterId} authorized={authorized} credentialId="oauth-app" description="Where the backups go." />
        </FormProvider>
    );
}

/** The footer shows the pick with its full path as the title. */
const picked = (value: string) => screen.findByTitle(value);
const row = async (name: string) => (await screen.findAllByRole("button", { name })).find((button) => button.hasAttribute("data-entry"))!;
const use = () => userEvent.click(screen.getByRole("button", { name: "Use this folder" }));

describe("the folder of a cloud drive", () => {
    beforeEach(() => vi.clearAllMocks());

    it("picks a Dropbox folder in the folder browser of the other connections, from where the field points", async () => {
        const fetchMock = serve({ "": [{ name: "Backups", path: "/Backups" }], "/Backups": [{ name: "prod", path: "/Backups/prod" }], "/Backups/prod": [] });
        const user = userEvent.setup();
        render(<Harness adapterId="dropbox" config={{ folderPath: "/Backups" }} />);

        await user.click(screen.getByRole("button", { name: "Browse Dropbox folders" }));
        const dialog = await screen.findByRole("dialog", { name: "Pick the folder" });
        expect(within(dialog).getByText("Offsite · Dropbox")).toBeInTheDocument();
        expect(await picked("/Backups")).toBeInTheDocument();

        await user.click(await row("prod"));
        expect(await picked("/Backups/prod")).toBeInTheDocument();
        await use();

        expect(screen.getByLabelText("Folder")).toHaveValue("/Backups/prod");
        expect(fetchMock).toHaveBeenCalledWith("/api/system/filesystem/dropbox", expect.objectContaining({ body: JSON.stringify({ credentialId: "oauth-app", folderPath: "/Backups" }) }));
    });

    it("walks to the folder of a OneDrive field without a leading slash and empties the field for the top", async () => {
        serve({ "": [{ name: "Backups", path: "Backups" }], Backups: [] });
        const user = userEvent.setup();
        render(<Harness adapterId="onedrive" config={{ folderPath: "Backups" }} />);

        await user.click(screen.getByRole("button", { name: "Browse OneDrive folders" }));
        expect(await picked("/Backups")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Go to /" }));
        expect(await picked("/")).toBeInTheDocument();
        await use();

        expect(screen.getByLabelText("Folder")).toHaveValue("");
    });

    it("opens a Google Drive folder at its whole path and puts the ID of the picked folder in the field", async () => {
        const fetchMock = serve(
            { "": [{ name: "Backups", path: "1AbC" }], "1AbC": [{ name: "Restores", path: "9XyZ" }], "9XyZ": [] },
            [{ name: "Backups", path: "1AbC" }, { name: "Restores", path: "9XyZ" }]
        );
        const user = userEvent.setup();
        render(<Harness adapterId="google-drive" config={{ folderId: "9XyZ" }} />);

        await user.click(screen.getByRole("button", { name: "Browse Google Drive folders" }));
        expect(await picked("/Backups/Restores")).toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledWith("/api/system/filesystem/google-drive", expect.objectContaining({ body: JSON.stringify({ credentialId: "oauth-app", folderId: "9XyZ", trail: true }) }));

        await user.click(within(screen.getByRole("navigation", { name: "Path" })).getByRole("button", { name: "Backups" }));
        expect(await picked("/Backups")).toBeInTheDocument();
        await use();

        expect(screen.getByLabelText("Folder ID")).toHaveValue("1AbC");
        expect(screen.getByText("Picked: /Backups")).toBeInTheDocument();
    });

    it("keeps the browser off until the drive is authorized", () => {
        const fetchMock = serve({});
        render(<Harness adapterId="dropbox" config={{ folderPath: "" }} authorized={false} />);

        expect(screen.getByRole("button", { name: "Browse Dropbox folders" })).toBeDisabled();
        expect(screen.getByText("Authorize Dropbox first to browse its folders.")).toBeInTheDocument();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
