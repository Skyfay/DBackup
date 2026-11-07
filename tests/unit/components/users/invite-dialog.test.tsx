import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InviteDialog } from "@/components/dashboard/users/invite-dialog";
import { PermissionsProvider } from "@/components/permissions/permissions-context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import type { UsersGroup } from "@/services/user/users-types";

const mocks = vi.hoisted(() => ({ createInvitation: vi.fn(), copy: vi.fn() }));

vi.mock("@/app/actions/tenant/invitation", () => ({ createInvitation: (...args: unknown[]) => mocks.createInvitation(...args) }));
vi.mock("@/lib/clipboard", () => ({ COPY_FAILED: "Copying failed.", copyToClipboard: (...args: unknown[]) => mocks.copy(...args) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const GROUPS: UsersGroup[] = [
    { id: "admin", name: "Admin", members: 1, permissions: [], superAdmin: true },
    { id: "operators", name: "Operators", members: 2, permissions: [PERMISSIONS.JOBS.READ, PERMISSIONS.JOBS.EXECUTE], superAdmin: false },
];

/** A tenant admin who may change users and run jobs, but not do everything. */
const TENANT_ADMIN = [PERMISSIONS.USERS.READ, PERMISSIONS.USERS.WRITE, PERMISSIONS.JOBS.READ, PERMISSIONS.JOBS.EXECUTE];

function open(onCreated = vi.fn()) {
    render(
        <PermissionsProvider permissions={TENANT_ADMIN}>
            <InviteDialog open groups={GROUPS} viewerPlatformAdmin={false} onOpenChange={vi.fn()} onCreated={onCreated} />
        </PermissionsProvider>
    );
    return { user: userEvent.setup(), onCreated };
}

describe("an invitation link a tenant admin hands out", () => {
    beforeAll(() => {
        // cmdk scrolls the highlighted row into view, which jsdom does not implement.
        Element.prototype.scrollIntoView = vi.fn();
    });

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.createInvitation.mockResolvedValue({ success: true, data: { id: "i1", path: "/invite?token=abcdefghijklmnopqrstuvwxyz", expiresAt: "2026-10-22T10:00:00.000Z" } });
        mocks.copy.mockResolvedValue(true);
    });

    it("offers only the groups that may do no more than the admin, and says why the others are missing", async () => {
        const { user } = open();

        await user.click(screen.getByRole("combobox", { name: "Group" }));

        expect(screen.getByRole("option", { name: /Operators/ })).toBeInTheDocument();
        expect(screen.queryByRole("option", { name: /Admin/ })).not.toBeInTheDocument();
        expect(screen.queryByRole("option", { name: /No group/ })).not.toBeInTheDocument();
        expect(screen.getByText("Admin may do more than you may, so it is not listed")).toBeInTheDocument();
    });

    it("needs a group before it makes a link", async () => {
        const { user } = open();

        await user.click(screen.getByRole("button", { name: "Create link" }));

        expect(await screen.findByText("Pick the group they join with.")).toBeInTheDocument();
        expect(mocks.createInvitation).not.toHaveBeenCalled();
    });

    it("makes a link for a week by default and shows its full address once, to copy", async () => {
        const { user, onCreated } = open();

        await user.click(screen.getByRole("combobox", { name: "Group" }));
        await user.click(screen.getByRole("option", { name: /Operators/ }));
        await user.type(screen.getByLabelText("Note"), "Jane from accounting");
        await user.click(screen.getByRole("button", { name: "Create link" }));

        expect(mocks.createInvitation).toHaveBeenCalledWith({ groupId: "operators", note: "Jane from accounting", days: 7 });
        const url = `${window.location.origin}/invite?token=abcdefghijklmnopqrstuvwxyz`;
        expect(await screen.findByText(url)).toBeInTheDocument();
        expect(screen.getByText("Invitation for Jane from accounting")).toBeInTheDocument();
        expect(screen.getByText(/Works once, until/)).toBeInTheDocument();
        expect(onCreated).toHaveBeenCalledTimes(1);

        await user.click(screen.getByRole("button", { name: "Copy" }));
        expect(mocks.copy).toHaveBeenCalledWith(url);
        expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
    });
});
