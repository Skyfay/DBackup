// @vitest-environment node
/**
 * Backup data that lies in the temporary folder, a download, a decrypted or unpacked dump, a file
 * staged for a restore or an entry compressed before it is sealed, goes into the private folder of
 * `src/lib/private-temp-dir.ts` (0700, files 0600). A file made with `path.join(getTempDir(), ...)`
 * takes the default mode, 0644 in the Docker image, so anyone else on the host could read it. New
 * code asks `privateTempPath()`, `privateTempDir()` or `withPrivateTempDir()`, and only the places
 * below call `getTempDir()` itself, each for the reason it gives.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../../../src");

/** The files that may call `getTempDir()`, by their path below `src/`, and why. */
const ALLOWED: Record<string, string> = {
    "lib/temp-dir.ts": "defines it",
    "lib/private-temp-dir.ts": "makes the private folder and the folders of `withPrivateTempDir` in it",
    "lib/adapters/own-data.ts": "compares the paths of a connection with the folder, writes nothing",
    "services/restore/temp-space.ts": "measures the free space of the folder, writes nothing",
    "services/system/database-service.ts": "measures the free space before the copy of the database, which goes through `privateTempPath`",
    "lib/adapters/database/common/tar-utils.ts": "`createTempDir` makes a folder of its own with `mkdtemp` (0700) for the files of a run",
    "lib/adapters/database/mssql/restore.ts": "extracts the .bak files into a folder of its own made with `mkdtemp` (0700)",
    "lib/adapters/storage/rsync.ts": "writes the key and the file list new with 0600, and names the control socket of ssh",
    "lib/adapters/storage/common/read-sidecar.ts": "a `.meta.json` of an adapter without `read()`, no dump or file of a backup",
    "services/backup/key-recovery.ts": "the head of an encrypted backup, probed for the key that opens it",
    "services/config/restore-pipeline.ts": "the configuration backup as downloaded, which is always encrypted",
};

function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(full);
        return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
    });
}

/** The files of `src/` whose code, not a comment, calls `getTempDir()`. */
function callers(): string[] {
    return sourceFiles(SRC)
        .filter((file) => {
            const code = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
            return /\bgetTempDir\s*\(/.test(code);
        })
        .map((file) => path.relative(SRC, file).split(path.sep).join("/"))
        .sort();
}

describe("files in the temporary folder", () => {
    it("go into the private folder, never straight into the temporary folder with the default mode", () => {
        const unlisted = callers().filter((file) => !(file in ALLOWED));
        expect(unlisted, "Use privateTempPath(), privateTempDir() or withPrivateTempDir() from @/lib/private-temp-dir").toEqual([]);
    });

    it("lists only places that still call it, so the exceptions stay current", () => {
        const found = new Set(callers());
        expect(Object.keys(ALLOWED).filter((file) => !found.has(file))).toEqual([]);
    });
});
