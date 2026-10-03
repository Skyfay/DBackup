import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claimLinkToken, generateLinkToken, linkStatus, markTokenUsed, releaseLinkToken } from "@/lib/auth/download-tokens";

const link = () => generateLinkToken({ storageId: "nas", file: "Shop/backup.tar", userId: "u1", decrypt: true, pick: { databases: ["billing"] } });

describe("links for a command on another host", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-09-26T12:00:00Z"));
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("tells only the user who made a link that it was fetched, with the time and the host", () => {
        const { token } = link();
        expect(linkStatus(token, "u1")).toMatchObject({ state: "open" });

        expect(claimLinkToken(token)).toMatchObject({ pick: { databases: ["billing"] }, createdBy: "u1" });
        vi.setSystemTime(new Date("2026-09-26T12:03:14Z"));
        markTokenUsed(token, "10.0.0.5");

        expect(linkStatus(token, "u1")).toEqual({
            state: "fetched",
            expiresAt: new Date("2026-09-26T12:05:00Z").getTime(),
            fetchedAt: new Date("2026-09-26T12:03:14Z").getTime(),
            fetchedFrom: "10.0.0.5",
        });
        expect(linkStatus(token, "someone else")).toBeNull();
    });

    it("never serves one link to two requests at once, but lets a download that broke off run again", () => {
        const { token } = link();

        expect(claimLinkToken(token)).not.toBeNull();
        expect(claimLinkToken(token)).toBeNull();

        releaseLinkToken(token);
        expect(claimLinkToken(token)).not.toBeNull();
        markTokenUsed(token);
        releaseLinkToken(token);
        expect(claimLinkToken(token)).toBeNull();
    });

    it("counts a link nobody fetched within five minutes as expired", () => {
        const { token, expiresAt } = link();

        vi.setSystemTime(expiresAt + 1);

        expect(linkStatus(token, "u1")).toMatchObject({ state: "expired" });
        expect(claimLinkToken(token)).toBeNull();
    });
});
