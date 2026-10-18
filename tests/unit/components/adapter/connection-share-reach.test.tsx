/**
 * The share dialog of a destination for someone of a platform group of some tenants: it ticks only
 * the tenants the platform group reaches, shows the tenants beyond it that get the destination as
 * they are, offers no All tenants and no terms that hold for those tenants too. A share with every
 * tenant does not open for them at all.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OUTSIDE_REACH } from "@/lib/tenant/sharing-reach";
import type { ConnectionShareView, ShareTenantUse } from "@/services/sharing/connection-shares";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const actions = vi.hoisted(() => ({
    getConnectionShare: vi.fn(),
    previewShareLoss: vi.fn(),
    saveConnectionShare: vi.fn(),
    stopSharingWith: vi.fn(),
    deleteSharedBackups: vi.fn(),
}));
vi.mock("@/app/actions/tenant/connection-share", () => actions);

import { ConnectionShareDialog } from "@/components/adapter/connection-share-dialog";
import { ShareDialogLoader } from "@/components/adapter/connection-share-card";

const tenantUse = (tenantId: string, name: string): ShareTenantUse => ({ tenantId, name, jobs: 1, templates: 0, backups: 2, size: 20, jobsWithoutKey: 0, lastBackup: null });

/** A NAS shared with Globex, which the platform group reaches, and Initech, which it does not. */
const limited = (fields: Partial<ConnectionShareView> = {}): ConnectionShareView => ({
    configId: "acme-nas",
    name: "NAS",
    kind: "destination",
    email: false,
    shared: true,
    cleanupPending: false,
    settings: { allTenants: false, tenantIds: ["globex", "initech"], encryptedOnly: false, ownRecipients: false },
    candidates: [{ id: "globex", name: "Globex" }, { id: "umbrella", name: "Umbrella" }],
    reach: { outside: [{ id: "initech", name: "Initech" }], allTenants: OUTSIDE_REACH.everyTenant, terms: OUTSIDE_REACH.terms(["Initech"]) },
    own: { backups: 1, size: 10 },
    uses: [tenantUse("globex", "Globex"), tenantUse("initech", "Initech")],
    ...fields,
});

describe("sharing a destination in a platform group of some tenants", () => {
    beforeEach(() => {
        for (const action of Object.values(actions)) action.mockReset();
        toast.success.mockReset();
        toast.error.mockReset();
    });

    it("ticks only the tenants it reaches, keeps the others as they are, and offers no All tenants and no terms", async () => {
        const user = userEvent.setup();
        actions.previewShareLoss.mockResolvedValue({ success: true, data: [] });
        actions.saveConnectionShare.mockResolvedValue({ success: true, data: { gained: ["Umbrella"], lost: [] } });
        render(<ConnectionShareDialog view={limited()} onOpenChange={vi.fn()} onSaved={vi.fn()} />);
        const dialog = screen.getByRole("dialog", { name: "Share NAS" });

        expect(within(dialog).getByRole("radio", { name: /All tenants/ })).toBeDisabled();
        expect(within(dialog).getByText(OUTSIDE_REACH.everyTenant)).toBeInTheDocument();
        expect(within(dialog).getByRole("checkbox", { name: "Initech, beyond your reach" })).toBeDisabled();
        expect(within(dialog).getByRole("switch", { name: "Only encrypted backups" })).toBeDisabled();

        await user.click(within(dialog).getByRole("checkbox", { name: /Umbrella/ }));
        await user.click(within(dialog).getByRole("button", { name: "Share with 3 tenants" }));

        await waitFor(() => expect(actions.saveConnectionShare).toHaveBeenCalledWith("acme-nas", expect.objectContaining({ allTenants: false, tenantIds: ["globex", "initech", "umbrella"] }), false));
    });

    it("does not open a share with every tenant, and says why", async () => {
        const onClose = vi.fn();
        actions.getConnectionShare.mockResolvedValue({
            success: true,
            data: limited({ settings: { allTenants: true, tenantIds: [], encryptedOnly: false, ownRecipients: false }, reach: { outside: [], allTenants: OUTSIDE_REACH.sharedWithEvery("NAS"), terms: null } }),
        });
        render(<ShareDialogLoader configId="acme-nas" onClose={onClose} onSaved={vi.fn()} />);

        await waitFor(() => expect(onClose).toHaveBeenCalled());
        expect(toast.error).toHaveBeenCalledWith("NAS is shared with every tenant. Only someone whose platform group reaches every tenant changes that.");
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("opens as before for someone who reaches every tenant", async () => {
        render(<ConnectionShareDialog view={limited({ candidates: [{ id: "globex", name: "Globex" }, { id: "initech", name: "Initech" }], reach: { outside: [], allTenants: null, terms: null } })} onOpenChange={vi.fn()} onSaved={vi.fn()} />);
        const dialog = screen.getByRole("dialog", { name: "Share NAS" });

        expect(within(dialog).getByRole("radio", { name: /All tenants/ })).toBeEnabled();
        expect(within(dialog).getByRole("checkbox", { name: /Initech/ })).toBeEnabled();
        expect(within(dialog).getByRole("switch", { name: "Only encrypted backups" })).toBeEnabled();
    });
});
