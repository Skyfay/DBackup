import { describe, expect, it } from "vitest";
import { inviteSignInHref, inviteStep, refusalField } from "@/components/auth/invite-model";

const INVITATION = { tenantId: "t1", tenantName: "Acme", groupName: "Operators", expiresAt: "2026-10-22T00:00:00.000Z" };

describe("the page of an invitation", () => {
    it("says a link does not work when the server knows none, signed in or not", () => {
        expect(inviteStep({ invitation: null, signedIn: null })).toBe("gone");
        expect(inviteStep({ invitation: null, signedIn: { name: "Lena", email: "lena@example.com" } })).toBe("gone");
    });

    it("lets someone signed in join with the account they have", () => {
        expect(inviteStep({ invitation: INVITATION, signedIn: { name: "Lena", email: "lena@example.com" } })).toBe("join");
    });

    it("offers everyone else the sign-in or a new account", () => {
        expect(inviteStep({ invitation: INVITATION, signedIn: null })).toBe("sign-in");
    });

    it("signs in on a login page that comes back to the invitation", () => {
        const href = inviteSignInHref("tok+en/1");
        expect(new URL(href, "http://localhost").searchParams.get("next")).toBe("/invite?token=tok%2Ben%2F1");
    });
});

describe("a refusal of a new account from an invitation", () => {
    it("goes to the password when a rule of Settings > Passwords refuses it", () => {
        expect(refusalField("The password needs 12 characters or more.")).toBe("password");
        expect(refusalField("The password may not contain the name or the email.")).toBe("password");
    });

    it("goes to the email when an account has it already", () => {
        expect(refusalField("An account with this email exists already. Sign in with it to accept the invitation.")).toBe("email");
        expect(refusalField("Invalid email address.")).toBe("email");
    });

    it("goes to the name when it is too short", () => {
        expect(refusalField("Name must be at least 2 characters.")).toBe("name");
    });

    it("shows above the form when it is about the link", () => {
        expect(refusalField("This invitation does not work any more. Ask for a new one.")).toBeNull();
        expect(refusalField("The account could not be created.")).toBeNull();
    });
});
