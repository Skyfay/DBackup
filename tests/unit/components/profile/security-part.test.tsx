import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SecurityPart } from "@/components/dashboard/profile/security-part";
import type { ProfileModel } from "@/services/user/profile-model";

const mocks = vi.hoisted(() => ({ session: null as null | { user: { twoFactorEnabled: boolean; passkeyTwoFactor: boolean } } }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/actions/auth/user", () => ({ togglePasskeyTwoFactor: vi.fn() }));
vi.mock("@/lib/auth/client", () => ({ authClient: { useSession: () => ({ data: mocks.session, refetch: vi.fn() }) } }));
vi.mock("@/components/dashboard/settings/settings-frame", () => ({ PartFrame: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/dashboard/profile/passkeys-section", () => ({
    PasskeysSection: () => null,
    usePasskeys: () => ({ passkeys: [{ id: "k1", name: "1Password", createdAt: null, backedUp: true }], load: vi.fn() }),
}));
vi.mock("@/components/dashboard/profile/security-dialogs", () => ({ BackupCodesDialog: () => null, PasswordDialog: () => null, TwoFactorOffDialog: () => null, TwoFactorOnDialog: () => null }));
vi.mock("@/components/dashboard/profile/sign-in-providers", () => ({ SignInProviders: () => null }));

function model(twoFactorEnabled: boolean, passkeyTwoFactor: boolean): ProfileModel {
    return {
        user: { id: "u1", twoFactorEnabled, passkeyTwoFactor },
        hasPassword: true,
        showSignInProviders: false,
        can: { updateName: true, updateEmail: true, updatePassword: true, manage2FA: true, managePasskeys: true, manageSso: true, seeGroups: true },
    } as unknown as ProfileModel;
}

describe("the second factor in the Security part of the profile", () => {
    beforeEach(() => {
        mocks.session = null;
    });

    it("shows the authenticator app off while a passkey is the second factor, which sets the flag of better-auth too", () => {
        render(<SecurityPart model={model(true, true)} />);

        expect(screen.getByText("Off. A passkey is the second factor instead.")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "New backup codes" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Turn off" })).not.toBeInTheDocument();
        expect(screen.getByRole("switch", { name: /A passkey counts as the second factor/ })).toBeChecked();
    });

    it("shows the authenticator app on with its codes while it is the second factor", () => {
        mocks.session = { user: { twoFactorEnabled: true, passkeyTwoFactor: false } };
        render(<SecurityPart model={model(true, false)} />);

        expect(screen.getByText("On. After the password DBackup asks for a code from the app.")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "New backup codes" })).toBeInTheDocument();
        expect(screen.getByRole("switch", { name: /A passkey counts as the second factor/ })).toBeDisabled();
    });
});
