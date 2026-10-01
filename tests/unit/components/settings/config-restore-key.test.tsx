import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { KeyResolutionResult } from "@/components/common/encryption-key-resolution-dialog";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
// The key dialog as a stub: what it says, and a key to pick of each kind.
vi.mock("@/components/common/encryption-key-resolution-dialog", () => ({
    EncryptionKeyResolutionDialog: ({ open, error, onConfirm }: { open: boolean; error?: string; onConfirm: (result: KeyResolutionResult) => void }) =>
        open ? (
            <div data-testid="key-dialog">
                {error && <p>{error}</p>}
                <button type="button" onClick={() => onConfirm({ type: "rawKey", keyHex: "ab".repeat(32) })}>Use the typed key</button>
                <button type="button" onClick={() => onConfirm({ type: "profile", profileId: "key-1" })}>Use key-1</button>
            </div>
        ) : null,
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const { ConfigRestoreDialog } = await import("@/components/dashboard/settings/config-restore-dialog");
const { DatabaseCopyRestore } = await import("@/components/dashboard/storage/restore/database-copy-restore");

const keyRequired = (error = "Encryption profile p-gone is missing, and no other profile could decrypt this file.") => ({
    status: 422,
    json: async () => ({ success: false, code: "ENCRYPTION_KEY_REQUIRED", profileId: "p-gone", error }),
});
const WRONG = "The supplied key does not open this backup.";

/** The modal behind the stub hides it from roles and clicks, which the stub does not mind. */
const setup = () => userEvent.setup({ pointerEventsCheck: 0 });

async function checkAFile(user: ReturnType<typeof setup>) {
    render(<ConfigRestoreDialog open onOpenChange={vi.fn()} />);
    await user.upload(screen.getByLabelText("Configuration backup"), new File(["x"], "config_backup.db.gz.enc"));
    // Submitted directly, since jsdom does not count a file set by user-event for `required`.
    fireEvent.submit(screen.getByRole("button", { name: "Check the file" }).closest("form")!);
}

describe("a key that does not open a configuration backup", () => {
    beforeEach(() => fetchMock.mockReset());

    it("keeps the key dialog of Restore from a file open and says why, instead of asking again in silence", async () => {
        const user = setup();
        fetchMock.mockResolvedValueOnce(keyRequired()).mockResolvedValueOnce(keyRequired(WRONG));
        await checkAFile(user);

        expect(await screen.findByTestId("key-dialog")).not.toHaveTextContent(WRONG);
        await user.click(screen.getByText("Use key-1"));

        expect(await screen.findByText(WRONG)).toBeInTheDocument();
        expect(screen.getByTestId("key-dialog")).toBeInTheDocument();
    });

    it("sends only the key of the latest try, so a profile picked after a typed key counts", async () => {
        const user = setup();
        fetchMock.mockResolvedValueOnce(keyRequired()).mockResolvedValueOnce(keyRequired(WRONG)).mockResolvedValueOnce(keyRequired(WRONG));
        await checkAFile(user);

        await user.click(await screen.findByText("Use the typed key"));
        await screen.findByText(WRONG);
        await user.click(screen.getByText("Use key-1"));

        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
        const sent = fetchMock.mock.calls[2][1].body as FormData;
        expect(sent.get("encryptionProfileIdOverride")).toBe("key-1");
        expect(sent.has("encryptionKeyHex")).toBe(false);
    });

    it("keeps the key dialog of a copy at a destination open and says why, instead of closing and opening it again", async () => {
        const user = setup();
        fetchMock.mockResolvedValueOnce(keyRequired()).mockResolvedValueOnce(keyRequired(WRONG));
        render(
            <DatabaseCopyRestore
                file={{ name: "config_backup.db.gz.enc", path: "config/config_backup.db.gz.enc", size: 1024, lastModified: "2026-10-01T03:00:00.000Z" }}
                destinationId="nas"
                canRestore
                canManageVault
                onCancel={vi.fn()}
            />
        );

        await user.click(await screen.findByText("Use key-1"));

        expect(await screen.findByText(WRONG)).toBeInTheDocument();
        expect(fetchMock).toHaveBeenLastCalledWith("/api/settings/config-backup/restore/destination", expect.objectContaining({ body: expect.stringContaining('"profileId":"key-1"') }));
    });
});
