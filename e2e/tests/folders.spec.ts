/**
 * A folder through DBackup: files with a nested folder, Unicode in a name and binary data, backed
 * up encrypted and compressed, restored into another folder and compared file by file.
 */

import { expect, test } from "@playwright/test";
import { App, problemOf, unique } from "../support/app";
import { inApp, localDestination } from "../support/backups";

/** Every file below a folder with the SHA-256 of its content, as `sha256sum` prints it, sorted by name. */
const tree = (folder: string) => inApp(`cd '${folder}' && find . -type f -exec sha256sum {} + | sort -k 2`);

test("[small] a folder restores into another folder with the same files", async ({ request }) => {
    const app = new App(request);
    const name = unique();
    const files = `/data/e2e/${name}/files`;
    await inApp([
        `mkdir -p '${files}/docs/2026'`,
        `printf 'Files of the end-to-end tests.\\n' > '${files}/README.txt'`,
        `printf 'Unicode in the name and in the content: Zoë, 李雷.\\n' > '${files}/docs/2026/Grüezi 🦊.txt'`,
        `head -c 65536 /dev/urandom > '${files}/random.bin'`,
        "chown -R --reference=/data /data/e2e",
    ].join(" && "));

    const source = await app.connection({ name: `${name} files`, type: "storage", adapterId: "local-filesystem", config: { basePath: files }, storageRole: "SOURCE" });
    const destination = await localDestination(app, name);
    const job = await app.job(`${name} files`, source, [destination], await app.vaultKey(), "folder");
    const backup = await app.backUp(job.id);
    expect(backup.status, problemOf(backup)).toBe("Success");

    const restored = await app.restore(destination, {
        file: backup.path,
        scope: "files",
        directoryMapping: [{ entryId: job.sources[0].id, targetConfigId: destination, targetPath: "restored", selected: true }],
    });
    expect(restored.status, problemOf(restored)).toBe("Success");
    expect(await tree(`/data/e2e/${name}/backups/restored`)).toBe(await tree(files));
});
