import { describe, expect, it, vi } from "vitest";
import { INVITE_DAYS, INVITE_MAX_DAYS, INVITE_MIN_DAYS, INVITE_NOTE_MAX, inviteUrl, nextToExpire, openInvitationsLabel } from "@/components/dashboard/users/invitation-model";
import { INVITATION_DAYS, INVITATION_MAX_DAYS } from "@/services/tenant/invitation-service";

// Only the limits of the service are read, nothing reaches a database.
vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/services/auth/auth-service", () => ({ authService: {} }));

describe("an invitation link in the browser", () => {
    it("follows the limits of the server", () => {
        expect(INVITE_DAYS).toBe(INVITATION_DAYS);
        expect(INVITE_MAX_DAYS).toBe(INVITATION_MAX_DAYS);
        expect(INVITE_MIN_DAYS).toBe(1);
        expect(INVITE_NOTE_MAX).toBe(100);
    });

    it("hands out the full address of the page and the path the server returns", () => {
        expect(inviteUrl("https://backup.example.com", "/invite?token=abc")).toBe("https://backup.example.com/invite?token=abc");
        expect(inviteUrl("http://10.0.0.5:3000/", "invite?token=abc")).toBe("http://10.0.0.5:3000/invite?token=abc");
    });

    it("names the link that runs out first", () => {
        const links = [
            { id: "a", expiresAt: "2026-10-20T10:00:00.000Z" },
            { id: "b", expiresAt: "2026-10-16T10:00:00.000Z" },
            { id: "c", expiresAt: "2026-10-30T10:00:00.000Z" },
        ];
        expect(nextToExpire(links)?.id).toBe("b");
        expect(nextToExpire([])).toBeNull();
    });

    it("counts the open links", () => {
        expect(openInvitationsLabel(1)).toBe("1 open invitation");
        expect(openInvitationsLabel(3)).toBe("3 open invitations");
    });
});
