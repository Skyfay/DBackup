/**
 * Cloudflare D1 through DBackup, against the test account of Cloudflare: Test connection, a backup
 * encrypted and compressed through the real queue and runner of the image, a restore under a new
 * name that creates the database, and a restore over that database after it changed. The test
 * reads both databases through the API of Cloudflare and compares them.
 *
 * Without an account (`E2E_D1_ACCOUNT_ID` and `E2E_D1_TOKEN`, or `cloudflareD1` of the lab config)
 * the test skips, also in CI, where a pull request from a fork gets no secrets.
 */

import { expect, test } from "@playwright/test";
import { App, problemOf, unique } from "../support/app";
import { localDestination } from "../support/backups";
import { D1, d1Account } from "../support/cloudflare";

test("[cloud] cloudflare-d1 restores under a new name and over a changed database with the same content", async ({ request }) => {
    const account = d1Account();
    test.skip(!account, "No Cloudflare test account, set E2E_D1_ACCOUNT_ID and E2E_D1_TOKEN or cloudflareD1 in the lab config");
    test.setTimeout(10 * 60_000);
    const d1 = new D1(account!);
    const app = new App(request);
    const name = unique();
    const original = `${name}-shop`;
    const copy = `${name}-copy`;

    await d1.deleteLeftovers();
    await d1.createShop(original);
    try {
        const connection = {
            adapterId: "cloudflare-d1",
            config: { accountId: account!.accountId, database: "", checkLargeIntegers: true, newDatabaseLocation: "auto" },
            primaryCredentialId: await app.credential(`${name} token`, "TOKEN", { token: account!.token }),
        };
        const tested = await app.testConnection(connection);
        expect(tested.success, tested.message).toBe(true);
        const sourceId = await app.connection({ ...connection, name: `${name} cloudflare-d1`, type: "database" });

        const destination = await localDestination(app, name);
        const job = await app.job(`${name} cloudflare-d1`, sourceId, [destination], await app.vaultKey(), "database", [original]);
        const backup = await app.backUp(job.id);
        expect(backup.status, problemOf(backup)).toBe("Success");
        expect(Number(backup.size)).toBeGreaterThan(0);

        const before = await d1.fingerprint(original);
        const restored = await app.restore(destination, { file: backup.path, targetSourceId: sourceId, databaseMapping: { [original]: copy } });
        expect(restored.status, problemOf(restored)).toBe("Success");
        expect(await d1.fingerprint(copy)).toBe(before);

        // A restore over an existing database replaces what changed since, and keeps the database.
        const target = (await d1.find(copy))!;
        await d1.query(target.uuid, "INSERT INTO customers (name, email, created_at) VALUES ('Later', 'later@example.ch', '2030-01-01'); CREATE TABLE added_later (x INTEGER);");
        const replaced = await app.restore(destination, { file: backup.path, targetSourceId: sourceId, databaseMapping: { [original]: copy } });
        expect(replaced.status, problemOf(replaced)).toBe("Success");
        expect(await d1.fingerprint(copy)).toBe(before);
        expect((await d1.find(copy))?.uuid).toBe(target.uuid);
    } finally {
        // CI sets E2E_KEEP for the runner it throws away, but these databases live at Cloudflare.
        if (!process.env.E2E_KEEP || process.env.CI) {
            await d1.delete(copy).catch(() => undefined);
            await d1.delete(original).catch(() => undefined);
        }
    }
});
