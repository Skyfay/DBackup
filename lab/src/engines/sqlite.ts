/**
 * SQLite, a file instead of a server: one on this machine, one in the SSH host and one on each
 * native server. A restore takes a file name and writes it next to the database of its source.
 */

import path from "path";
import type { Run } from "./types";

/** The database of a SQLite source at `file`, as the archive names it, and where a copy of it goes. */
export function sqliteDatabase(file: string) {
    const folder = path.posix.dirname(file);
    return {
        name: path.posix.basename(file),
        location: file,
        restoreAs: (suffix: string) => ({ name: `shop_${suffix}.db`, location: `${folder}/shop_${suffix}.db` }),
    };
}

export const SQLITE = {
    fingerprint: (run: Run, file: string) => run(`sqlite3 ${file} .dump`),
    drop: async (run: Run, file: string) => {
        await run(`rm -f ${file}`);
    },
};
