import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserPasswordDialog } from "@/components/dashboard/users/user-password-dialog";
import { LEVEL_RULES, passwordProblem } from "@/lib/auth/password-policy";
import type { UserRow } from "@/services/user/users-types";

const mocks = vi.hoisted(() => ({ setUserPassword: vi.fn() }));

vi.mock("@/app/actions/auth/user-security", () => ({ setUserPassword: (...args: unknown[]) => mocks.setUserPassword(...args) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const LENA = { id: "u1", name: "Lena Graf", email: "lena@example.ch", methods: [{ kind: "password" }], sessions: 0 } as unknown as UserRow;

function open() {
    render(<UserPasswordDialog user={LENA} rules={LEVEL_RULES.strong} onClose={vi.fn()} onDone={vi.fn()} />);
    return userEvent.setup();
}

describe("a new password an admin sets for someone", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.setUserPassword.mockResolvedValue({ success: true, data: { signedOut: 0 } });
    });

    it("names the rule a typed password breaks and sets nothing", async () => {
        const user = open();

        await user.type(screen.getByLabelText("Password"), "Harbor-Lamp-42");
        expect(screen.getByRole("list", { name: "What the password needs" })).toHaveTextContent("16 characters or more · 14 now, still missing");
        await user.click(screen.getByRole("button", { name: "Set password" }));

        expect(screen.getByText("The password needs 16 characters or more.")).toBeInTheDocument();
        expect(mocks.setUserPassword).not.toHaveBeenCalled();
    });

    it("makes one with Generate that holds every rule, ticked off under the field", async () => {
        const user = open();

        await user.click(screen.getByRole("button", { name: "Generate" }));
        const password = (screen.getByLabelText("Password") as HTMLInputElement).value;

        expect(passwordProblem(password, LEVEL_RULES.strong, LENA)).toBeNull();
        for (const item of within(screen.getByRole("list", { name: "What the password needs" })).getAllByRole("listitem")) {
            expect(item).toHaveTextContent(/, done$/);
        }

        await user.click(screen.getByRole("button", { name: "Set password" }));
        expect(mocks.setUserPassword).toHaveBeenCalledWith("u1", { password, signOut: true });
    });
});
