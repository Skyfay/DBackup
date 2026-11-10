/**
 * The Sharing area of the API key editor in a tenant that shares databases: offered while there is
 * another tenant, and kept while the key holds one of its rights already, so a save with only one
 * tenant left never drops them.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiKeyFormDialog, keyOffersSharing } from "@/components/dashboard/api-keys/api-key-form-dialog";
import { PERMISSIONS } from "@/lib/auth/permissions";
import type { ApiKeyRow } from "@/services/auth/api-keys-types";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/auth/client", () => ({
    useSession: () => ({ data: { user: { timezone: "UTC", dateFormat: "yyyy-MM-dd", timeFormat: "HH:mm" } } }),
}));

const actions = vi.hoisted(() => ({ createApiKey: vi.fn(), updateApiKey: vi.fn() }));
vi.mock("@/app/actions/auth/api-key", () => actions);

/** The MSP alone, which shares databases, with no customer left. */
const view = vi.hoisted(() => ({ tenantCount: 1 }));
vi.mock("@/components/tenant/tenant-view", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/components/tenant/tenant-view")>()),
    useTenantView: () => ({
        tenants: [{ id: "msp", name: "MSP", logo: null, sharesWithCustomers: true, allowances: {} }],
        activeTenantId: "msp",
        allTenants: false,
        isPlatformAdmin: false,
        tenantCount: view.tenantCount,
    }),
}));

const SHARING = [PERMISSIONS.PLATFORM.SHARING_READ, PERMISSIONS.PLATFORM.SHARING_WRITE];

function keyOf(fields: Partial<ApiKeyRow>): ApiKeyRow {
    const permissions = [PERMISSIONS.JOBS.READ, ...SHARING];
    return {
        id: "key-1", name: "Hosting panel", prefix: "dbackup_abcdefgh", permissions, effective: permissions, paused: [],
        ownerPermissions: [PERMISSIONS.JOBS.READ, ...SHARING], owner: { id: "u-owner", name: "Owner" } as ApiKeyRow["owner"],
        state: "active" as ApiKeyRow["state"], expiresAt: null, lastUsedAt: null, createdAt: "2026-10-01T00:00:00.000Z", lastRun: null,
        isMine: true, tenantId: "msp", platform: false,
        ...fields,
    };
}

function renderEdit(key: ApiKeyRow) {
    render(
        <ApiKeyFormDialog
            open
            mode={{ kind: "edit", key }}
            keys={[key]}
            viewerPermissions={[PERMISSIONS.API_KEYS.WRITE, PERMISSIONS.JOBS.READ, ...SHARING]}
            onOpenChange={vi.fn()}
        />,
    );
}

describe("the Sharing area of a key", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        view.tenantCount = 1;
        actions.updateApiKey.mockResolvedValue({ success: true });
    });

    it("is offered while there is another tenant, or while the key holds one of its rights", () => {
        expect(keyOffersSharing(true, 2, [])).toBe(true);
        expect(keyOffersSharing(true, 1, [])).toBe(false);
        expect(keyOffersSharing(false, 3, [])).toBe(false);
        expect(keyOffersSharing(true, 1, [PERMISSIONS.PLATFORM.SHARING_READ])).toBe(true);
        expect(keyOffersSharing(false, 1, [PERMISSIONS.PLATFORM.SHARING_WRITE])).toBe(true);
    });

    it("keeps the sharing rights of a key when its owner renames it with only one tenant left", async () => {
        const user = userEvent.setup();
        renderEdit(keyOf({}));

        const form = await screen.findByRole("dialog");
        expect(within(form).getByText("Sharing")).toBeInTheDocument();
        await user.clear(within(form).getByLabelText("Name"));
        await user.type(within(form).getByLabelText("Name"), "Panel");
        expect(within(form).getByText("Changed: the name")).toBeInTheDocument();
        await user.click(within(form).getByRole("button", { name: /^Save/ }));

        await waitFor(() => expect(actions.updateApiKey).toHaveBeenCalledTimes(1));
        expect(actions.updateApiKey.mock.calls[0][1].permissions.sort()).toEqual([PERMISSIONS.JOBS.READ, ...SHARING].sort());
    });

    it("sends the same rights for a rename by someone who only renames a key of another", async () => {
        const user = userEvent.setup();
        renderEdit(keyOf({ isMine: false }));

        const form = await screen.findByRole("dialog");
        await user.type(within(form).getByLabelText("Name"), " 2");
        await user.click(within(form).getByRole("button", { name: /^Save/ }));

        await waitFor(() => expect(actions.updateApiKey).toHaveBeenCalledTimes(1));
        expect(actions.updateApiKey.mock.calls[0][1].permissions.sort()).toEqual([PERMISSIONS.JOBS.READ, ...SHARING].sort());
    });

    it("is left out with one tenant for a key that holds none of its rights", async () => {
        renderEdit(keyOf({ permissions: [PERMISSIONS.JOBS.READ], effective: [PERMISSIONS.JOBS.READ] }));

        const form = await screen.findByRole("dialog");
        expect(within(form).queryByText("Sharing")).not.toBeInTheDocument();
    });
});
