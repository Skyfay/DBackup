/**
 * Backups through the real queue, runner and restore pipeline against the servers of the lab.
 * Every source is backed up encrypted and compressed, restored under a new name on its own
 * server and read back with the tools of its engine, which must find the same content.
 */

import { createHash } from "crypto";
import { readdirSync, readFileSync, rmSync } from "fs";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Execution } from "@prisma/client";
import prisma from "@/lib/prisma";
import { localBackupDir } from "../../lab/src/folders";
import { config, lab, labSources, restoresItself, type LabSource } from "./support/lab";
import { drop, fingerprint } from "./support/places";
import { backUp, createJob, namesIn, problemOf, restore } from "./support/runs";

const sources = labSources();
const destinationKeys = Object.keys(lab.destinations);

/**
 * Bugs these tests found that are not fixed yet, by the key of the source. Such a case passes
 * while it still fails and fails once the bug is gone, which is when its line goes.
 */
const KNOWN_BUGS: Record<string, string> = {
    "firebird-3": "The gbak of Firebird 5, which DBackup ships, restores into a Firebird 3 server only over the service manager. Over a client connection it fails with a BLR syntax error.",
};

/**
 * Restores the dataset database of a backup under a new name, compares it and removes it again.
 * LAB_KEEP=1 leaves the restored database there to look at.
 */
async function expectRestoredContent(source: LabSource, backup: Execution, storageConfigId: string, suffix: string): Promise<void> {
    const target = source.restoreAs(suffix);
    await drop(source.engine, source.place, target.location);
    try {
        const restored = await restore({
            storageConfigId,
            file: backup.path!,
            targetSourceId: lab.sources[source.key],
            databaseMapping: { [source.database]: target.name },
        });
        expect(restored.status, problemOf(restored)).toBe("Success");

        const original = await fingerprint(source.engine, source.place, source.location);
        const copy = await fingerprint(source.engine, source.place, target.location);
        expect(copy.split(target.location).join(source.location)).toBe(original);
    } finally {
        if (!process.env.LAB_KEEP) await drop(source.engine, source.place, target.location);
    }
}

describe("a backup of every source", () => {
    for (const source of sources.filter(restoresItself)) {
        const known = KNOWN_BUGS[source.key];
        (known ? it.fails : it)(`restores ${source.key} under a new name with the same content${known ? " (known bug)" : ""}`, async () => {
            const jobId = await createJob(`Round trip ${source.key}`, lab.sources[source.key], [lab.destinations.local]);
            const backup = await backUp(jobId);
            expect(backup.status, problemOf(backup)).toBe("Success");
            expect(namesIn(backup)).toContain(source.database);

            await expectRestoredContent(source, backup, lab.destinations.local, "restored");
        });
    }

    // Redis and Valkey restore by copying the file into the server by hand.
    it.each(sources.filter((source) => !restoresItself(source)))("backs up $key", async (source) => {
        const jobId = await createJob(`Backup ${source.key}`, lab.sources[source.key], [lab.destinations.local]);
        const backup = await backUp(jobId);
        expect(backup.status, problemOf(backup)).toBe("Success");
        expect(Number(backup.size)).toBeGreaterThan(0);
    });
});

describe("one backup to every destination", () => {
    const source = sources.find((entry) => entry.key === "sqlite")!;
    let backup: Execution;

    beforeAll(async () => {
        const jobId = await createJob("Round trip to every destination", lab.sources.sqlite, destinationKeys.map((key) => lab.destinations[key]));
        backup = await backUp(jobId);
    });

    it("uploads to all of them", () => {
        expect(backup.status, problemOf(backup)).toBe("Success");
    });

    it.each(destinationKeys)("restores from %s", async (key) => {
        await expectRestoredContent(source, backup, lab.destinations[key], `from_${key}`);
    });
});

describe("a backup of a folder", () => {
    const original = path.join(config.storageRoot, "lab", "files");
    const target = path.join(localBackupDir(config, lab.workspace), "restored-files");

    /** Every file below a folder with the SHA-256 of its content. */
    const tree = (root: string) => readdirSync(root, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => {
            const file = path.join(entry.parentPath, entry.name);
            return [path.relative(root, file), createHash("sha256").update(readFileSync(file)).digest("hex")];
        })
        .sort(([a], [b]) => a.localeCompare(b));

    afterAll(() => {
        rmSync(target, { recursive: true, force: true });
    });

    it("restores every file into another folder with the same content", async () => {
        const jobId = await createJob("Round trip Lab Files", lab.sources.files, [lab.destinations.local], "folder");
        const backup = await backUp(jobId);
        expect(backup.status, problemOf(backup)).toBe("Success");

        const entry = await prisma.jobSource.findFirstOrThrow({ where: { jobId } });
        const restored = await restore({
            storageConfigId: lab.destinations.local,
            file: backup.path!,
            scope: "files",
            directoryMapping: [{ entryId: entry.id, targetConfigId: lab.destinations.local, targetPath: "restored-files", selected: true }],
        });
        expect(restored.status, problemOf(restored)).toBe("Success");
        expect(tree(target)).toEqual(tree(original));
    });
});
