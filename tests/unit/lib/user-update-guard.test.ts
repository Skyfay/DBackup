/**
 * better-auth marks the email of an account as verified on its own, at a sign-in of a linked
 * identity whose provider calls it verified. The flag is DBackup's, a sign-in provider links an
 * account by its email only while it is true, so a change of better-auth never sets it.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ default: { user: { findUnique: vi.fn() } } }));

const { beforeUserUpdate } = await import("@/lib/auth/user-update-guard");

const CALLBACK = { path: "/sso/callback/:providerId" };

describe("a change better-auth makes to a user", () => {
    it("never marks the email as verified", async () => {
        const result = await beforeUserUpdate({ emailVerified: true }, CALLBACK);

        expect(result).toEqual({ data: { emailVerified: undefined } });
    });

    it("leaves the rest of the change as it is", async () => {
        const result = await beforeUserUpdate({ emailVerified: true, image: "https://idp.example/a.png" }, CALLBACK);

        // better-auth merges the answer into the change, so the image stays.
        expect({ emailVerified: true, image: "https://idp.example/a.png", ...result?.data }).toEqual({ emailVerified: undefined, image: "https://idp.example/a.png" });
    });

    it("lets the flag be taken away and leaves other changes alone", async () => {
        expect(await beforeUserUpdate({ emailVerified: false }, CALLBACK)).toBeUndefined();
        expect(await beforeUserUpdate({ name: "Anna" }, null)).toBeUndefined();
    });
});
