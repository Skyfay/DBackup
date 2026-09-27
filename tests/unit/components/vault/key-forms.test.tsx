import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditKeyDialog } from "@/components/dashboard/vault/edit-key-dialog";
import { ImportKeyDialog } from "@/components/dashboard/vault/import-key-dialog";
import { EncryptionKeyDialog } from "@/components/settings/encryption-key-dialog";
import type { VaultKey } from "@/services/vault/vault-types";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const actions = vi.hoisted(() => ({
    createEncryptionProfile: vi.fn(),
    importEncryptionProfile: vi.fn(),
    inspectEncryptionKey: vi.fn(),
    updateEncryptionProfile: vi.fn(),
}));
vi.mock("@/app/actions/backup/encryption", () => actions);

const KEY = "ab".repeat(32);

describe("ImportKeyDialog", () => {
    beforeEach(() => vi.clearAllMocks());

    it("counts the characters, names the Key ID of a whole key and imports it", async () => {
        const user = userEvent.setup();
        const onImported = vi.fn();
        actions.inspectEncryptionKey.mockResolvedValue({ success: true, data: { keyId: "8a2f 91c3", existing: null } });
        actions.importEncryptionProfile.mockResolvedValue({ success: true, data: { id: "k" } });
        render(<ImportKeyDialog taken={["Production"]} onClose={vi.fn()} onImported={onImported} />);

        await user.type(screen.getByLabelText("Name"), "Old production");
        await user.type(screen.getByLabelText("Key"), KEY.slice(0, 10));
        expect(screen.getByText("10 of 64 characters")).toBeInTheDocument();

        await user.type(screen.getByLabelText("Key"), KEY.slice(10));
        expect(await screen.findByText("Key ID 8a2f 91c3, a hex key of 256 bits")).toBeInTheDocument();
        expect(actions.inspectEncryptionKey).toHaveBeenCalledWith(KEY);

        await user.click(screen.getByRole("button", { name: "Import key" }));
        await waitFor(() => expect(onImported).toHaveBeenCalled());
        expect(actions.importEncryptionProfile).toHaveBeenCalledWith("Old production", KEY, undefined, []);
    });

    it("stops at a name the Vault has and a key it holds already", async () => {
        const user = userEvent.setup();
        actions.inspectEncryptionKey.mockResolvedValue({ success: true, data: { keyId: "8a2f 91c3", existing: { id: "p", name: "Production" } } });
        render(<ImportKeyDialog taken={["Production"]} onClose={vi.fn()} onImported={vi.fn()} />);

        await user.type(screen.getByLabelText("Name"), "Production");
        await user.click(screen.getByLabelText("Key"));
        await user.paste(KEY);
        expect(await screen.findByText("This key is in the Vault already, as Production.")).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Import key" }));
        expect(screen.getByText("The Vault holds a key by this name already.")).toBeInTheDocument();
        expect(actions.importEncryptionProfile).not.toHaveBeenCalled();
    });
});

describe("EditKeyDialog", () => {
    beforeEach(() => vi.clearAllMocks());

    const keyRow: VaultKey = {
        id: "production",
        name: "Production",
        description: null,
        createdAt: "2026-03-14T10:00:00.000Z",
        updatedAt: "2026-03-14T10:00:00.000Z",
        keyId: "8a2f 91c3",
        jobs: [],
        configBackup: false,
        backups: 214,
        destinations: [],
        recent: [],
        kit: null,
        created: null,
        revealed: null,
    };

    it("keeps a name another key has and saves a free one with the description", async () => {
        const user = userEvent.setup();
        const onSaved = vi.fn();
        actions.updateEncryptionProfile.mockResolvedValue({ success: true });
        render(<EditKeyDialog keyRow={keyRow} taken={["Offsite S3"]} onClose={vi.fn()} onSaved={onSaved} />);

        expect(screen.getByText("214 backups")).toBeInTheDocument();
        const name = screen.getByLabelText("Name");
        await user.clear(name);
        await user.type(name, "Offsite S3");
        await user.click(screen.getByRole("button", { name: "Save changes" }));
        expect(screen.getByText("The Vault holds a key by this name already.")).toBeInTheDocument();

        await user.clear(name);
        await user.type(name, "Main");
        await user.type(screen.getByLabelText("Description"), "Shop and CRM");
        await user.click(screen.getByRole("button", { name: "Save changes" }));

        await waitFor(() => expect(onSaved).toHaveBeenCalled());
        expect(actions.updateEncryptionProfile).toHaveBeenCalledWith("production", { name: "Main", description: "Shop and CRM" });
    });
});

describe("EncryptionKeyDialog with its kit", () => {
    beforeEach(() => vi.clearAllMocks());

    it("offers the recovery kit of the new key right after it was made", async () => {
        const user = userEvent.setup();
        const onCreated = vi.fn();
        actions.createEncryptionProfile.mockResolvedValue({ success: true, data: { id: "k1", name: "Backup key", description: null, keyId: "6668 7aad" } });
        render(<EncryptionKeyDialog open onOpenChange={vi.fn()} taken={[]} onCreated={onCreated} withKit />);

        await user.click(screen.getByRole("button", { name: "Create key" }));

        expect(await screen.findByText("Backup key is ready")).toBeInTheDocument();
        expect(screen.getByText("Key ID 6668 7aad")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Download recovery kit" })).toBeInTheDocument();
        expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: "k1", keyId: "6668 7aad" }));
    });
});
