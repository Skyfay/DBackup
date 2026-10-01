import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CredentialsTab } from "@/components/dashboard/vault/credentials-tab";
import { KeysTab } from "@/components/dashboard/vault/keys-tab";
import type { VaultCredentialsModel, VaultKey, VaultKeysModel } from "@/services/vault/vault-types";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/app/actions/auth/table-preferences", () => ({ saveTableLayout: vi.fn(async () => ({ success: true })) }));
vi.mock("@/app/actions/backup/encryption", () => ({
    createEncryptionProfile: vi.fn(),
    deleteEncryptionProfile: vi.fn(),
    bulkDeleteEncryptionProfiles: vi.fn(),
    importEncryptionProfile: vi.fn(),
    inspectEncryptionKey: vi.fn(),
    revealMasterKey: vi.fn(async () => ({ success: true, data: "ab".repeat(32) })),
    updateEncryptionProfile: vi.fn(),
}));

const JOB = { id: "shop", name: "Shop nightly", enabled: true, schedule: "0 3 * * *", sourceType: "postgres", hasFolders: false };

function key(overrides: Partial<VaultKey>): VaultKey {
    return {
        id: "k",
        name: "Key",
        description: null,
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

const KEYS: VaultKeysModel = {
    keys: [
        key({
            id: "production",
            name: "Production",
            description: "Shop, CRM and the wiki",
            jobs: [JOB],
            backups: 214,
            destinations: [{ id: "nas", name: "NAS Backups", adapterId: "smb", count: 214 }],
            kit: { at: "2026-09-15T10:00:00.000Z", by: "Manu", keys: 2 },
        }),
        key({ id: "offsite", name: "Offsite S3", keyId: "5d07 e2b8" }),
    ],
    stats: {
        keys: 2,
        jobs: 1,
        keysInUse: 1,
        backups: 250,
        encrypted: 226,
        missing: { count: 12, keys: 1, destinations: [{ id: "nas", name: "NAS Backups", adapterId: "smb", count: 12 }] },
        neverInKit: ["Offsite S3"],
        lastKit: { at: "2026-09-15T10:00:00.000Z", by: "Manu", keys: 2 },
    },
    auditDays: 90,
};

const CREDENTIALS: VaultCredentialsModel = {
    profiles: [
        {
            id: "skynas",
            name: "SkyNas",
            type: "USERNAME_PASSWORD",
            description: "Admin of the Synology",
            createdAt: "2026-06-26T10:00:00.000Z",
            updatedAt: "2026-06-26T10:00:00.000Z",
            holds: "user admin",
            attention: null,
            usedBy: [
                { id: "smb", name: "SkyNas SMB", adapterId: "smb", role: "destination", slot: "primary", status: "ONLINE" },
                { id: "photos", name: "Photos share", adapterId: "smb", role: "source", slot: "primary", status: "OFFLINE" },
            ],
            created: { at: "2026-06-26T10:00:00.000Z", by: "Manu" },
            changed: null,
            revealed: null,
            reveals: 0,
        },
        {
            id: "drive",
            name: "Google Drive",
            type: "OAUTH",
            description: null,
            createdAt: "2026-07-18T10:00:00.000Z",
            updatedAt: "2026-07-18T10:00:00.000Z",
            holds: "not authorized yet",
            attention: "The app was never authorized, so its connections cannot log in.",
            usedBy: [],
            created: null,
            changed: null,
            revealed: null,
            reveals: 0,
        },
    ],
    stats: { profiles: 2, kinds: 2, topKind: "USERNAME_PASSWORD", inUse: 1, connections: 2, unused: 1, revealed: 0, lastReveal: null },
    auditDays: 90,
};

function serve(body: unknown) {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true, data: body }), { status: 200 })));
}

describe("KeysTab", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        serve(KEYS);
    });

    it("shows the numbers, the backups whose key is missing and a row per key", async () => {
        render(<KeysTab cards={false} canManage initialLayout={null} />);

        expect(await screen.findByText("Production")).toBeInTheDocument();
        expect(screen.getByText("12 backups at NAS Backups name a key the Vault does not have")).toBeInTheDocument();
        expect(screen.getByText("Encrypted backups")).toBeInTheDocument();
        expect(screen.getByText("Offsite S3", { selector: "button" })).toBeInTheDocument();
        expect(screen.getByText("Never downloaded")).toBeInTheDocument();
        expect(screen.getByText("5d07 e2b8")).toBeInTheDocument();
    });

    it("narrows the list to the keys never in a kit", async () => {
        const user = userEvent.setup();
        render(<KeysTab cards={false} canManage initialLayout={null} />);
        await screen.findByText("Production");

        await user.click(screen.getByRole("button", { name: /Never in a kit/ }));

        expect(screen.queryByRole("button", { name: "Production" })).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Offsite S3" })).toBeInTheDocument();
    });

    it("opens the details of a key with what encrypts with it and what it protects", async () => {
        const user = userEvent.setup();
        render(<KeysTab cards={false} canManage initialLayout={null} />);

        await user.click(await screen.findByRole("button", { name: "Production" }));

        const panel = await screen.findByRole("dialog");
        expect(within(panel).getByText("Key ID 8a2f 91c3 · Shop, CRM and the wiki")).toBeInTheDocument();
        expect(within(panel).getByRole("link", { name: "Shop nightly" })).toHaveAttribute("href", "/dashboard/jobs?job=shop");
        expect(within(panel).getByText("Protects 214 backups")).toBeInTheDocument();
        expect(within(panel).getByRole("button", { name: /Reveal key/ })).toBeInTheDocument();
    });

    it("offers nothing but looking without the right to write to the Vault", async () => {
        render(<KeysTab cards={false} canManage={false} initialLayout={null} />);
        await screen.findByText("Production");

        expect(screen.queryByRole("button", { name: "Import key" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Open menu for Production/ })).not.toBeInTheDocument();
    });
});

describe("CredentialsTab", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        serve(CREDENTIALS);
    });

    it("lists each profile with the connections that log in with it and marks one that needs a look", async () => {
        render(<CredentialsTab cards={false} access={{ canWrite: true, canDelete: true, canReveal: true }} initialLayout={null} />);

        expect(await screen.findByRole("button", { name: "SkyNas" })).toBeInTheDocument();
        expect(screen.getByText("SkyNas SMB, Photos share")).toBeInTheDocument();
        expect(screen.getByText("user admin")).toBeInTheDocument();
        expect(screen.getByText("not authorized yet")).toBeInTheDocument();
        expect(screen.getByText("Need a look")).toBeInTheDocument();
    });

    it("opens the details with a link to each connection on the Connections page", async () => {
        const user = userEvent.setup();
        render(<CredentialsTab cards={false} access={{ canWrite: true, canDelete: true, canReveal: true }} initialLayout={null} />);

        await user.click(await screen.findByRole("button", { name: "SkyNas" }));

        const panel = await screen.findByRole("dialog");
        expect(within(panel).getByText("Used by 2 connections")).toBeInTheDocument();
        expect(within(panel).getByRole("link", { name: "Photos share" })).toHaveAttribute("href", "/dashboard/connections?tab=directory-sources&open=photos");
        expect(within(panel).getByText("Offline")).toBeInTheDocument();
    });

    it("blocks the delete of a profile connections log in with and names them", async () => {
        const user = userEvent.setup();
        render(<CredentialsTab cards={false} access={{ canWrite: true, canDelete: true, canReveal: true }} initialLayout={null} />);

        await user.click(await screen.findByRole("button", { name: "Open menu for SkyNas" }));
        await user.click(await screen.findByRole("menuitem", { name: "Delete" }));

        const dialog = await screen.findByRole("alertdialog");
        expect(within(dialog).getByText("2 connections still log in with it")).toBeInTheDocument();
        expect(within(dialog).getByRole("button", { name: "Delete profile" })).toBeDisabled();
        await waitFor(() => expect(within(dialog).getAllByRole("link", { name: /Open/ })).toHaveLength(2));
    });
});
