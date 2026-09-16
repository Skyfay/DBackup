/**
 * Which downloads a backup row offers.
 *
 * Kept free of React so the rules are unit-testable. They depend on the backup's format more
 * than on anything the user did: a seekable archive encrypts every entry on its own, so it has
 * no decrypted form as a whole, only decrypted dumps and a decrypted tar.gz of its contents.
 */

export interface DownloadableBackup {
    isEncrypted?: boolean;
    hasFileIndex?: boolean;
    combined?: { databases: number; directorySources: number };
    dbInfo?: { count: string | number; label: string };
    chain?: unknown;
}

export interface DownloadOptions {
    /** The stored file exactly as it is. */
    raw: { label: string };
    /** The backup decrypted and ready to use, for a backup that has one such file. */
    decrypted?: { label: string };
    /** Opens a picker to download one database out of several. */
    pickDatabase?: { label: string };
    /** Everything in the backup, unpacked into a tar.gz. */
    contents?: { label: string };
}

/** How many databases a row's metadata says the backup holds. */
export function databaseCountOf(file: DownloadableBackup): number {
    if (file.combined) return file.combined.databases;
    const count = Number(file.dbInfo?.count ?? 0);
    return Number.isFinite(count) ? count : 0;
}

export function getDownloadOptions(file: DownloadableBackup): DownloadOptions {
    if (!file.hasFileIndex) {
        return {
            raw: { label: file.isEncrypted ? "Download Encrypted (.enc)" : "Download" },
            ...(file.isEncrypted ? { decrypted: { label: "Download Decrypted" } } : {}),
        };
    }

    const databases = databaseCountOf(file);
    // `combined` is only recorded for a backup that has directory sources, so its absence on
    // a seekable archive means it holds databases and nothing else.
    const databaseOnly = !file.combined || file.combined.directorySources === 0;
    const singleDump = databaseOnly && databases === 1;

    return {
        raw: { label: file.isEncrypted ? "Download Encrypted Archive" : "Download Archive (.tar)" },
        ...(singleDump
            ? { decrypted: { label: file.isEncrypted ? "Download Decrypted Dump" : "Download Dump" } }
            : {}),
        ...(databases > 1 || (!databaseOnly && databases > 0)
            ? { pickDatabase: { label: "Download Database..." } }
            : {}),
        // A single dump already is the whole content, so a tar.gz holding just that is noise.
        ...(singleDump
            ? {}
            : {
                contents: {
                    label: file.chain
                        ? "Download Complete Snapshot"
                        : file.isEncrypted ? "Download Decrypted Contents" : "Download Contents",
                },
            }),
    };
}
