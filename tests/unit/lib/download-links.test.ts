import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claimLinkToken, generateFileDownloadToken, generateLinkToken, generateSelectionDownloadToken, linkStatus, markTokenUsed, releaseLinkToken } from "@/lib/auth/download-tokens";

const MAKER = { userId: "u1", tenantId: "default", storageId: "nas" };
const link = () => generateLinkToken({ tenantId: "default", storageId: "nas", file: "Shop/backup.tar", userId: "u1", decrypt: true, pick: { databases: ["billing"] } });

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
        expect(linkStatus(token, MAKER)).toMatchObject({ state: "open" });

        expect(claimLinkToken(token)).toMatchObject({ pick: { databases: ["billing"] }, createdBy: "u1" });
        vi.setSystemTime(new Date("2026-09-26T12:03:14Z"));
        markTokenUsed(token, "10.0.0.5");

        expect(linkStatus(token, MAKER)).toEqual({
            state: "fetched",
            expiresAt: new Date("2026-09-26T12:05:00Z").getTime(),
            fetchedAt: new Date("2026-09-26T12:03:14Z").getTime(),
            fetchedFrom: "10.0.0.5",
        });
        expect(linkStatus(token, { ...MAKER, userId: "someone else" })).toBeNull();
    });

    it("tells nothing to the same user in another tenant, with an API key or at another destination", () => {
        const { token } = link();

        expect(linkStatus(token, { ...MAKER, tenantId: "acme" })).toBeNull();
        expect(linkStatus(token, { ...MAKER, tenantId: null })).toBeNull();
        expect(linkStatus(token, { ...MAKER, apiKeyId: "key-1" })).toBeNull();
        expect(linkStatus(token, { ...MAKER, storageId: "s3" })).toBeNull();
        expect(linkStatus(token, MAKER)).toMatchObject({ state: "open" });
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

    it("claims no other token as a link, since those belong to the session that asked for them", () => {
        expect(claimLinkToken(generateSelectionDownloadToken({ storageId: "nas", file: "Shop/backup.tar", userId: "u1", fileName: "pick.tar.gz" }))).toBeNull();
        expect(claimLinkToken(generateFileDownloadToken({ storageId: "nas", file: "Shop/backup.tar", userId: "u1", tempFile: "/nonexistent/dbackup-test/never-written", fileName: "x.sql", contentType: "application/sql" }))).toBeNull();
        expect(claimLinkToken(link().token)).toMatchObject({ kind: "link", tenantId: "default", createdBy: "u1" });
    });

    it("counts a link nobody fetched within five minutes as expired", () => {
        const { token, expiresAt } = link();

        vi.setSystemTime(expiresAt + 1);

        expect(linkStatus(token, MAKER)).toMatchObject({ state: "expired" });
        expect(claimLinkToken(token)).toBeNull();
    });
});
