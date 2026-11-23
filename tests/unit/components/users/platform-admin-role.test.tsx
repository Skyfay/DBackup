import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { usePlatformAdminRole } from "@/components/dashboard/platform/platform-admin-role";
import { userActions } from "@/components/dashboard/users/user-actions";
import type { UserRow } from "@/services/user/users-types";

const mocks = vi.hoisted(() => ({ setPlatformAdmin: vi.fn(), success: vi.fn(), error: vi.fn() }));

vi.mock("@/app/actions/tenant/members", () => ({ setPlatformAdmin: (...args: unknown[]) => mocks.setPlatformAdmin(...args) }));
vi.mock("sonner", () => ({ toast: { success: (...args: unknown[]) => mocks.success(...args), error: (...args: unknown[]) => mocks.error(...args) } }));

const LENA: UserRow = {
    id: "lena",
    name: "Lena Meier",
    email: "lena@example.ch",
    image: null,
    createdAt: "2026-06-01T09:00:00.000Z",
    group: null,
    tenants: [{ tenantId: "default", group: { id: "admin", name: "Admin" } }],
    superAdmin: false,
    elsewhere: false,
    methods: [{ kind: "password" }],
    secondFactor: "none",
    lastSignIn: null,
    sessions: 0,
    apiKeys: 0,
    isYou: false,
};

const entriesOf = (user: UserRow, onPlatformAdmin?: (user: UserRow) => void) =>
    userActions(user, { onPlatformAdmin }).flatMap((group) => group.actions.map((action) => ({ group: group.label, id: action.id, label: action.label, tone: action.tone })));

describe("the platform admin role in the menu of a user", () => {
    it("offers Make platform admin, and the way back for a platform admin, in the amber of a warning", () => {
        expect(entriesOf(LENA, vi.fn())).toEqual([{ group: "Platform", id: "admin-on", label: "Make platform admin", tone: "warning" }]);
        expect(entriesOf({ ...LENA, superAdmin: true }, vi.fn())).toEqual([{ group: "Platform", id: "admin-off", label: "No platform admin any more", tone: "warning" }]);
    });

    it("never offers it on the own row, nor on a list that does not hand it out", () => {
        expect(entriesOf({ ...LENA, isYou: true }, vi.fn())).toEqual([]);
        expect(entriesOf(LENA)).toEqual([]);
    });
});

function RoleProbe({ on, onChanged }: { on: boolean; onChanged: () => void }) {
    const role = usePlatformAdminRole(onChanged);
    return (
        <>
            <button type="button" onClick={() => role.ask({ userId: "lena", name: "Lena Meier", on })}>Ask</button>
            {role.dialog}
        </>
    );
}

describe("giving or taking the platform admin role", () => {
    beforeEach(() => vi.clearAllMocks());

    it("asks first, then makes the account a platform admin and says so", async () => {
        mocks.setPlatformAdmin.mockResolvedValue({ success: true });
        const onChanged = vi.fn();
        render(<RoleProbe on onChanged={onChanged} />);
        const actor = userEvent.setup();

        await actor.click(screen.getByRole("button", { name: "Ask" }));
        expect(screen.getByText("Make Lena Meier a platform admin?")).toBeInTheDocument();
        expect(mocks.setPlatformAdmin).not.toHaveBeenCalled();

        await actor.click(screen.getByRole("button", { name: "Make platform admin" }));
        expect(mocks.setPlatformAdmin).toHaveBeenCalledWith("lena", true);
        expect(mocks.success).toHaveBeenCalledWith("Lena Meier is a platform admin now");
        expect(onChanged).toHaveBeenCalled();
    });

    it("keeps the last platform admin with the reason of the server", async () => {
        mocks.setPlatformAdmin.mockResolvedValue({ success: false, error: "The last platform admin stays one." });
        const onChanged = vi.fn();
        render(<RoleProbe on={false} onChanged={onChanged} />);
        const actor = userEvent.setup();

        await actor.click(screen.getByRole("button", { name: "Ask" }));
        await actor.click(screen.getByRole("button", { name: "Take it back" }));

        expect(mocks.setPlatformAdmin).toHaveBeenCalledWith("lena", false);
        expect(mocks.error).toHaveBeenCalledWith("The last platform admin stays one.");
        expect(onChanged).not.toHaveBeenCalled();
    });
});
