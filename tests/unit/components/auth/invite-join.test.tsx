import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
    accept: vi.fn(),
    announce: vi.fn(),
    push: vi.fn(),
    refresh: vi.fn(),
    viewer: vi.fn(),
    sessionId: vi.fn(),
    setActive: vi.fn(),
    acceptService: vi.fn(),
}));

describe("joining a tenant through an invitation", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
    });

    it("tells the other tabs of the browser about the tenant the session works in now, before it opens the dashboard", async () => {
        vi.doMock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }));
        vi.doMock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
        vi.doMock("@/lib/auth/client", () => ({ signOut: vi.fn() }));
        vi.doMock("@/app/actions/tenant/invitation", () => ({ acceptInvitation: (...args: unknown[]) => mocks.accept(...args) }));
        vi.doMock("@/components/tenant/tenant-sync", () => ({ announceTenantSwitch: (...args: unknown[]) => mocks.announce(...args) }));
        mocks.accept.mockResolvedValue({ success: true, data: { tenantId: "acme", tenantName: "Acme GmbH", joined: true } });
        const order: string[] = [];
        mocks.announce.mockImplementation(() => order.push("announce"));
        mocks.push.mockImplementation(() => order.push("push"));
        const { InviteStep } = await import("@/components/auth/invite-step");

        render(
            <InviteStep
                token={"t".repeat(32)}
                invitation={{ tenantId: "acme", tenantName: "Acme GmbH", groupName: "Operators", expiresAt: new Date(Date.now() + 86_400_000).toISOString() }}
                signedIn={{ name: "Ada", email: "ada@example.ch" }}
                passwordSignUp
                rules={null}
            />
        );
        await userEvent.setup().click(screen.getByRole("button", { name: "Join Acme GmbH" }));

        await waitFor(() => expect(mocks.announce).toHaveBeenCalledExactlyOnceWith("acme", "Acme GmbH"));
        expect(order).toEqual(["announce", "push"]);
        expect(mocks.push).toHaveBeenCalledWith("/dashboard");
    });

    it("warns an account whose provider of a customer's tenant stops signing it in once it joins", async () => {
        vi.doMock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }));
        vi.doMock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
        vi.doMock("@/lib/auth/client", () => ({ signOut: vi.fn() }));
        vi.doMock("@/app/actions/tenant/invitation", () => ({ acceptInvitation: (...args: unknown[]) => mocks.accept(...args) }));
        vi.doMock("@/components/tenant/tenant-sync", () => ({ announceTenantSwitch: vi.fn() }));
        const { InviteStep } = await import("@/components/auth/invite-step");
        const invitation = { tenantId: "globex", tenantName: "Globex AG", groupName: "Operators", expiresAt: new Date(Date.now() + 86_400_000).toISOString() };

        const { rerender } = render(<InviteStep token={"t".repeat(32)} invitation={invitation} signedIn={{ name: "Lena", email: "lena@acme.ch" }} passwordSignUp rules={null} endsProviders={["Acme Entra ID"]} />);

        expect(screen.getByRole("alert")).toHaveTextContent("Your sign-in provider stops signing you in");
        expect(screen.getByRole("alert")).toHaveTextContent("Once you join Globex AG, Acme Entra ID no longer signs you in.");
        // Joining stays possible, the warning only says what it ends.
        expect(screen.getByRole("button", { name: "Join Globex AG" })).toBeEnabled();

        rerender(<InviteStep token={"t".repeat(32)} invitation={invitation} signedIn={{ name: "Lena", email: "lena@acme.ch" }} passwordSignUp rules={null} />);
        expect(screen.queryByRole("alert")).toBeNull();
    });

    it("answers with the tenant joined by its id, which the page announces", async () => {
        vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));
        vi.doMock("@/lib/auth/access-control", () => ({
            checkPermission: vi.fn(),
            currentSessionId: () => mocks.sessionId(),
            getViewer: () => mocks.viewer(),
        }));
        vi.doMock("@/services/audit-service", () => ({ auditService: { log: vi.fn() } }));
        vi.doMock("@/services/tenant/invitation-service", () => ({ INVITATION_MAX_DAYS: 30, invitationService: { accept: (...args: unknown[]) => mocks.acceptService(...args) } }));
        vi.doMock("@/services/tenant/tenant-service", () => ({ tenantService: { setActive: (...args: unknown[]) => mocks.setActive(...args) } }));
        vi.doMock("@/services/user/group-service", () => ({ groupService: {} }));
        mocks.viewer.mockResolvedValue({ id: "u1", isPlatformAdmin: false });
        mocks.sessionId.mockResolvedValue("s1");
        mocks.acceptService.mockResolvedValue({ tenantId: "acme", tenantName: "Acme GmbH", joined: true });
        const { acceptInvitation } = await vi.importActual<typeof import("@/app/actions/tenant/invitation")>("@/app/actions/tenant/invitation");

        const result = await acceptInvitation("t".repeat(32));

        expect(result).toEqual({ success: true, data: { tenantId: "acme", tenantName: "Acme GmbH", joined: true } });
        expect(mocks.setActive).toHaveBeenCalledWith("s1", "u1", "acme", false);
    });
});
