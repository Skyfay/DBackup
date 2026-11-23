/**
 * A download link is fetched without a session, so its maker is asked again when it is used: the
 * account through its groups in the tenant of the link, and an API key through what it holds and
 * its owner may now.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { makerMayDownload } from "@/lib/auth/download-maker";

const group = (permissions: string[]) => ({ permissions: JSON.stringify(permissions), fullAccess: false });
const lena = (permissions: string[], extra: Record<string, unknown> = {}) => ({
    platformRole: null,
    memberships: [{ tenantId: "acme", group: group(permissions) }],
    platformGroup: null,
    ...extra,
});
const key = (extra: Record<string, unknown> = {}) => ({
    userId: "lena", tenantId: "acme", enabled: true, expiresAt: null, permissions: JSON.stringify(["storage:download"]), ...extra,
});

beforeEach(() => {
    prismaMock.user.findUnique.mockResolvedValue(lena(["storage:read", "storage:download"]) as never);
    prismaMock.tenant.findUnique.mockResolvedValue({ addsApiKeys: true, sharesWithCustomers: false } as never);
    prismaMock.apiKey.findUnique.mockResolvedValue(key() as never);
});

describe("the maker of a link made with a session", () => {
    it("may still download while their group in the tenant gives it", async () => {
        expect(await makerMayDownload({ userId: "lena", tenantId: "acme" })).toBe(true);
    });

    it("may no longer once their group lost the right, they left the tenant or the account is gone", async () => {
        prismaMock.user.findUnique.mockResolvedValueOnce(lena(["storage:read"]) as never);
        expect(await makerMayDownload({ userId: "lena", tenantId: "acme" })).toBe(false);

        prismaMock.user.findUnique.mockResolvedValueOnce(lena(["storage:download"], { memberships: [] }) as never);
        expect(await makerMayDownload({ userId: "lena", tenantId: "acme" })).toBe(false);

        prismaMock.user.findUnique.mockResolvedValueOnce(null as never);
        expect(await makerMayDownload({ userId: "lena", tenantId: "acme" })).toBe(false);
    });

    it("may no longer once the tenant is gone", async () => {
        prismaMock.tenant.findUnique.mockResolvedValueOnce(null as never);
        expect(await makerMayDownload({ userId: "lena", tenantId: "acme" })).toBe(false);
    });

    it("may as a platform admin in any tenant that exists", async () => {
        prismaMock.user.findUnique.mockResolvedValueOnce(lena([], { platformRole: "ADMIN", memberships: [] }) as never);
        expect(await makerMayDownload({ userId: "lena", tenantId: "acme" })).toBe(true);
    });
});

describe("the maker of a link made with an API key", () => {
    const maker = { userId: "lena", tenantId: "acme", apiKeyId: "key-ci" };

    it("may still download while the key holds the right and its owner has it", async () => {
        expect(await makerMayDownload(maker)).toBe(true);
    });

    it("may no longer once the key is off, expired, lost the right or its owner lost it", async () => {
        prismaMock.apiKey.findUnique.mockResolvedValueOnce(key({ enabled: false }) as never);
        expect(await makerMayDownload(maker)).toBe(false);

        prismaMock.apiKey.findUnique.mockResolvedValueOnce(key({ expiresAt: new Date("2020-01-01") }) as never);
        expect(await makerMayDownload(maker)).toBe(false);

        prismaMock.apiKey.findUnique.mockResolvedValueOnce(key({ permissions: JSON.stringify(["storage:read"]) }) as never);
        expect(await makerMayDownload(maker)).toBe(false);

        prismaMock.user.findUnique.mockResolvedValueOnce(lena(["storage:read"]) as never);
        expect(await makerMayDownload(maker)).toBe(false);
    });

    it("may no longer once the platform switched the API keys of the tenant off, or for a key of another tenant or person", async () => {
        prismaMock.tenant.findUnique.mockResolvedValueOnce({ addsApiKeys: false, sharesWithCustomers: false } as never);
        expect(await makerMayDownload(maker)).toBe(false);

        prismaMock.apiKey.findUnique.mockResolvedValueOnce(key({ tenantId: "globex" }) as never);
        expect(await makerMayDownload(maker)).toBe(false);

        prismaMock.apiKey.findUnique.mockResolvedValueOnce(key({ userId: "max" }) as never);
        expect(await makerMayDownload(maker)).toBe(false);

        prismaMock.apiKey.findUnique.mockResolvedValueOnce(null as never);
        expect(await makerMayDownload(maker)).toBe(false);
    });
});
