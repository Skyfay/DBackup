/**
 * Every database of a family through DBackup: Test connection, a backup encrypted and compressed
 * through the real queue and runner of the image, a restore under a new name on the same server,
 * and the tools of the engine reading the original and the copy outside of DBackup. Redis and
 * Valkey restore by hand, so their backups are only checked.
 *
 * Each test is tagged with its family, `[postgres]`, which picks it for that Playwright project.
 */

import { expect, test } from "@playwright/test";
import { App, problemOf, unique } from "../support/app";
import { createSource, expectSameContentAfterRestore, localDestination, skipWhenUnavailable } from "../support/backups";
import { FAMILIES } from "../support/targets";

for (const family of FAMILIES) {
    for (const target of family.targets) {
        const does = target.database ? "restores under a new name with the same content" : "backs up";
        test(`[${family.name}] ${target.key} ${does}${target.knownBug ? " (known bug)" : ""}`, async ({ request }) => {
            skipWhenUnavailable(target.service);
            if (target.knownBug) test.fail(true, target.knownBug);
            const app = new App(request);
            const name = unique();

            const source = await createSource(app, target, name);
            const tested = await app.testConnection(source.connection);
            expect(tested.success, tested.message).toBe(true);

            const destination = await localDestination(app, name);
            const job = await app.job(`${name} ${target.key}`, source.id, [destination], await app.vaultKey());
            const backup = await app.backUp(job.id);
            expect(backup.status, problemOf(backup)).toBe("Success");
            expect(Number(backup.size)).toBeGreaterThan(0);

            if (target.database) await expectSameContentAfterRestore(app, target, source.id, destination, backup, name);
        });
    }
}
