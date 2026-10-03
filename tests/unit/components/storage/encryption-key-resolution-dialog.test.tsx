import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const actions = vi.hoisted(() => ({ getEncryptionProfiles: vi.fn(), recoverEncryptionKeyAction: vi.fn() }));
vi.mock("@/app/actions/backup/encryption", () => actions);

const { EncryptionKeyResolutionDialog } = await import("@/components/common/encryption-key-resolution-dialog");

const KEY = "ab".repeat(32);

describe("the dialog that asks for the key of a backup", () => {
    beforeAll(() => {
        // cmdk scrolls the highlighted row into view, which jsdom does not implement.
        Element.prototype.scrollIntoView = vi.fn();
    });

    beforeEach(() => {
        vi.clearAllMocks();
        actions.getEncryptionProfiles.mockResolvedValue({
            success: true,
            data: [{ id: "k1", name: "Main key", description: "For the shop", _count: { jobs: 2 } }],
        });
    });

    it("picks a key of the Vault from the list of the Vault", async () => {
        const user = userEvent.setup();
        const onConfirm = vi.fn();
        render(<EncryptionKeyResolutionDialog open onOpenChange={vi.fn()} onConfirm={onConfirm} profileIdHint="p-gone" />);

        expect(screen.getByRole("dialog", { name: "This backup needs its key" })).toHaveTextContent("p-gone");
        await user.click(await screen.findByRole("combobox"));
        expect(screen.getByRole("option", { name: /Main key/ })).toHaveTextContent("For the shop · Used by 2 jobs");
        await user.click(screen.getByRole("option", { name: /Main key/ }));
        await user.click(screen.getByRole("button", { name: "Use this key" }));

        expect(onConfirm).toHaveBeenCalledWith({ type: "profile", profileId: "k1" });
    });

    it("takes a typed key once it has the length of a key, for a file that is not kept anywhere", async () => {
        const user = userEvent.setup();
        const onConfirm = vi.fn();
        render(<EncryptionKeyResolutionDialog open onOpenChange={vi.fn()} onConfirm={onConfirm} />);

        await user.click(screen.getByRole("radio", { name: /Type the key/ }));
        await user.type(screen.getByLabelText("The key"), "abc");
        await user.click(screen.getByRole("button", { name: "Use this key" }));
        expect(screen.getByText("A key is 64 characters of 0 to 9 and a to f.")).toBeInTheDocument();
        expect(onConfirm).not.toHaveBeenCalled();

        await user.clear(screen.getByLabelText("The key"));
        await user.type(screen.getByLabelText("The key"), KEY);
        await user.click(screen.getByRole("button", { name: "Use this key" }));
        expect(onConfirm).toHaveBeenCalledWith({ type: "rawKey", keyHex: KEY });
    });

    it("says why the last key did not open the backup", () => {
        render(<EncryptionKeyResolutionDialog open onOpenChange={vi.fn()} onConfirm={vi.fn()} error="The supplied key does not open this backup." />);

        expect(screen.getByRole("alert")).toHaveTextContent("The supplied key does not open this backup.");
    });

    it("offers no typed key to someone who may not keep it in the Vault, for a backup it would be kept for", async () => {
        render(<EncryptionKeyResolutionDialog open onOpenChange={vi.fn()} onConfirm={vi.fn()} backup={{ storageConfigId: "nas", file: "a.sql.enc" }} canManageVault={false} />);

        expect(await screen.findByRole("radio", { name: /Type the key/ })).toBeDisabled();
    });
});
