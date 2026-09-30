import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KeyDeleteDialog } from "@/components/dashboard/vault/key-delete-dialog";
import { PermissionsProvider } from "@/components/permissions/permissions-context";
import { RecoveryKitDialog } from "@/components/dashboard/vault/recovery-kit-dialog";
import type { VaultKey } from "@/services/vault/vault-types";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const actions = vi.hoisted(() => ({ deleteEncryptionProfile: vi.fn(), bulkDeleteEncryptionProfiles: vi.fn(), revealMasterKey: vi.fn() }));
vi.mock("@/app/actions/backup/encryption", () => actions);
vi.mock("@/app/actions/settings/trash", () => ({ undoDeleteAction: vi.fn() }));
vi.mock("@/hooks/use-date-formatter", () => ({ useDateFormatter: () => ({ formatDate: () => "30 Oct 2026" }) }));

function key(overrides: Partial<VaultKey> = {}): VaultKey {
    return {
        id: "production",
        name: "Production",
        description: "Shop, CRM and the wiki",
        createdAt: "2026-03-14T10:00:00.000Z",
        updatedAt: "2026-03-14T10:00:00.000Z",
        keyId: "8a2f 91c3",
        jobs: [],
        configBackup: false,
        backups: 0,
        destinations: [],
        recent: [],
        kit: null,
        created: null,
        revealed: null,
        ...overrides,
    };
}

const JOB = { id: "shop", name: "Shop nightly", enabled: true, schedule: "0 3 * * *", sourceType: "postgres", hasFolders: false };
const BACKUP = {
    name: "FileBackup_2026-07-25.tar",
    path: "FileBackup_2026-07-25.tar",
    destinationId: "local",
    destinationName: "Local",
    adapterId: "local-filesystem",
    size: 52 * 1024 * 1024,
    createdAt: "2026-07-25T20:09:21.000Z",
    jobName: "FileBackup",
};

describe("KeyDeleteDialog", () => {
    beforeEach(() => vi.clearAllMocks());

    it("names the jobs that encrypt with the key and keeps Delete off", () => {
        render(<KeyDeleteDialog keyRow={key({ jobs: [JOB, { ...JOB, id: "crm", name: "CRM daily" }], backups: 84 })} canKit onKitDownloaded={vi.fn()} onClose={vi.fn()} onDeleted={vi.fn()} onRestored={vi.fn()} />);

        expect(screen.getByText("Delete Production?")).toBeInTheDocument();
        expect(screen.getByText("2 jobs still encrypt with it")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Shop nightly" })).toHaveAttribute("href", "/dashboard/jobs?job=shop");
        expect(screen.getByText("Its 84 backups stay as they are and still need this key.")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Delete key" })).toBeDisabled();
    });

    it("names the config backup as a user of the key", () => {
        render(<KeyDeleteDialog keyRow={key({ configBackup: true })} canKit onKitDownloaded={vi.fn()} onClose={vi.fn()} onDeleted={vi.fn()} onRestored={vi.fn()} />);

        expect(screen.getByText("The config backup still encrypts with it")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Configuration backup" })).toHaveAttribute("href", "/dashboard/settings?part=config-backup");
    });

    const withBackup = () => key({ backups: 1, recent: [BACKUP], destinations: [{ id: "local", name: "Local", adapterId: "local-filesystem", count: 1 }] });

    it("moves a key that backups need to Recently deleted, where a restore opens them again", async () => {
        const user = userEvent.setup();
        const onDeleted = vi.fn();
        actions.deleteEncryptionProfile.mockResolvedValue({ success: true });
        render(<KeyDeleteDialog keyRow={withBackup()} canKit onKitDownloaded={vi.fn()} onClose={vi.fn()} onDeleted={onDeleted} onRestored={vi.fn()} />);

        expect(screen.getByText("1 backup needs this key")).toBeInTheDocument();
        expect(screen.getByText(/Restore it until 30 Oct 2026 and the backup it encrypted opens again/)).toBeInTheDocument();
        // The backups it would leave unreadable only matter for a permanent delete.
        expect(screen.queryByText("FileBackup_2026-07-25.tar")).not.toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Delete key" }));

        await waitFor(() => expect(onDeleted).toHaveBeenCalledWith("production"));
        expect(actions.deleteEncryptionProfile).toHaveBeenCalledWith("production", { permanently: false });
    });

    it("deletes a key permanently only with the tick, and lists the backups that stay unreadable", async () => {
        const user = userEvent.setup();
        actions.deleteEncryptionProfile.mockResolvedValue({ success: true });
        render(<KeyDeleteDialog keyRow={withBackup()} canKit onKitDownloaded={vi.fn()} onClose={vi.fn()} onDeleted={vi.fn()} onRestored={vi.fn()} />);

        await user.click(screen.getByRole("checkbox", { name: "Delete it permanently now" }));

        expect(screen.getByText("Delete Production permanently?")).toBeInTheDocument();
        expect(screen.getByText("FileBackup_2026-07-25.tar")).toBeInTheDocument();
        expect(screen.getByText("Never in a recovery kit")).toBeInTheDocument();
        expect(screen.getByText("This cannot be undone")).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Delete key permanently" }));
        await waitFor(() => expect(actions.deleteEncryptionProfile).toHaveBeenCalledWith("production", { permanently: true }));
    });

    it("offers no permanent delete to someone who may not change the settings", () => {
        render(
            <PermissionsProvider permissions={["vault:read", "vault:write"]}>
                <KeyDeleteDialog keyRow={withBackup()} canKit onKitDownloaded={vi.fn()} onClose={vi.fn()} onDeleted={vi.fn()} onRestored={vi.fn()} />
            </PermissionsProvider>
        );

        expect(screen.getByText(/It moves to/)).toBeInTheDocument();
        expect(screen.queryByRole("checkbox", { name: "Delete it permanently now" })).not.toBeInTheDocument();
    });

    it("asks plainly for a key no listed backup needs", () => {
        render(<KeyDeleteDialog keyRow={key()} canKit onKitDownloaded={vi.fn()} onClose={vi.fn()} onDeleted={vi.fn()} onRestored={vi.fn()} />);

        expect(screen.getByText("Delete Production?")).toBeInTheDocument();
        expect(screen.getByText("Key ID 8a2f 91c3")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Delete key" })).toBeEnabled();
    });
});

describe("RecoveryKitDialog", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal("fetch", vi.fn(async () => new Response(new Blob(["zip"]), { status: 200, headers: { "Content-Disposition": 'attachment; filename="recovery_kit_2_profiles.zip"' } })));
        URL.createObjectURL = vi.fn(() => "blob:kit");
        URL.revokeObjectURL = vi.fn();
    });

    it("starts with every key, tells which were never in a kit, and downloads the picked ones", async () => {
        const user = userEvent.setup();
        const onDownloaded = vi.fn();
        const keys = [key(), key({ id: "offsite", name: "Offsite S3", kit: { at: "2026-09-20T10:00:00.000Z", by: "Manu", keys: 2 } }), key({ id: "test", name: "UI Test" })];
        render(<RecoveryKitDialog keys={keys} onClose={vi.fn()} onDownloaded={onDownloaded} />);

        expect(screen.getByText("3 of 3 keys")).toBeInTheDocument();
        expect(screen.getAllByText(/never in a kit/)).toHaveLength(2);

        await user.click(screen.getByRole("checkbox", { name: "UI Test" }));
        expect(screen.getByText("2 of 3 keys")).toBeInTheDocument();
        expect(screen.getByText("It opens every backup made with these 2 keys. Keep it away from your backups.")).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Download 2 keys" }));

        await waitFor(() => expect(onDownloaded).toHaveBeenCalledWith(["production", "offsite"]));
        expect(fetch).toHaveBeenCalledWith("/api/vault/recovery-kit?ids=production,offsite");
    });

    it("opens with only the keys it was asked for", () => {
        render(<RecoveryKitDialog keys={[key(), key({ id: "offsite", name: "Offsite S3" })]} picked={["offsite"]} onClose={vi.fn()} onDownloaded={vi.fn()} />);

        expect(screen.getByText("1 of 2 keys")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Download kit" })).toBeEnabled();
    });
});
