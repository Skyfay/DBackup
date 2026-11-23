// @vitest-environment node
/**
 * The client of src/lib/prisma.ts keeps the logins of a sign-in provider encrypted in the database
 * and answers them in plain, on a read and on a write alike. The SSO plugin of better-auth locks a
 * provider with an update and compares the row it answers with the one it read, so an encrypted
 * answer ended every sign-in through a provider with SSO_PROVIDER_CHANGED.
 */
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encrypt } from "@/lib/crypto";

let root = "";
let prisma: typeof import("@/lib/prisma").default;

beforeAll(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), "dbackup-sso-decrypt-"));
    const url = `file:${path.join(root, "test.db")}`;
    execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as { prisma?: unknown }).prisma = undefined;
    prisma = (await import("@/lib/prisma")).default;
});

afterAll(async () => {
    await prisma?.$disconnect();
    rmSync(root, { recursive: true, force: true });
});

describe("the logins of a sign-in provider", () => {
    it("come back in plain from a create, a read and the update better-auth locks a provider with", async () => {
        const created = await prisma.ssoProvider.create({
            data: {
                providerId: "dex-0", issuer: "http://dex:5556/dex", domain: "example.com", adapterId: "generic", name: "Dex",
                clientId: encrypt("the-client"), clientSecret: encrypt("the-secret"),
                oidcConfig: JSON.stringify({ issuer: "http://dex:5556/dex", clientId: encrypt("the-client"), clientSecret: encrypt("the-secret") }),
            },
        });
        const read = await prisma.ssoProvider.findFirstOrThrow({ where: { providerId: "dex-0" } });
        const locked = await prisma.ssoProvider.update({ where: { id: created.id }, data: { providerId: "dex-0" } });

        for (const row of [created, read, locked]) {
            expect(row.clientId).toBe("the-client");
            expect(row.clientSecret).toBe("the-secret");
            expect(JSON.parse(row.oidcConfig ?? "{}")).toMatchObject({ clientId: "the-client", clientSecret: "the-secret" });
        }
        const [stored] = await prisma.$queryRawUnsafe<{ clientId: string; oidcConfig: string }[]>(`SELECT "clientId", "oidcConfig" FROM "SsoProvider"`);
        expect(stored.clientId).not.toBe("the-client");
        expect(stored.oidcConfig).not.toContain("the-client");
    });
});
