/**
 * Filenames derived from a database name.
 *
 * A database name is user data from a foreign server and can hold anything that server
 * accepts - a Firebird alias is a full path, MSSQL allows dots and slashes in delimited
 * identifiers. Every place that turns one into a filename goes through here, so a name like
 * `../../etc/x` can never become a path segment in an archive member, a local temp file, a
 * download or a Recovery Kit extraction.
 *
 * Client-safe: no Node imports, the restore page and the Storage Explorer use it too.
 */

import { EXTENSION_BY_FORMAT } from "./format";
import type { DumpFormat } from "./types";

/**
 * Makes a name usable as a single path segment.
 *
 * Separators, NUL and control characters become `_`, and so does a leading dot, which is
 * what turns `..` into something that is no longer a parent reference.
 */
export function safeNameSegment(name: string): string {
    const replaced = name.replace(/[/\\\u0000-\u001f\u007f]/g, "_").replace(/^\./, "_");
    return replaced.length > 0 ? replaced : "_";
}

/** Filename of a dump inside an archive or an extraction folder, e.g. `shop.sql`. */
export function databaseDumpFileName(name: string, format: DumpFormat): string {
    return `${safeNameSegment(name)}.${EXTENSION_BY_FORMAT[format]}`;
}

/**
 * Filename a single dump is downloaded under, e.g. `nightly_2026-09-16.tar` and `shop`
 * give `nightly_2026-09-16_shop.sql`. The archive's name comes first so dumps of the same
 * database from different backups do not overwrite each other in a downloads folder.
 */
export function databaseDownloadFileName(archiveFile: string, name: string, format: DumpFormat): string {
    const base = archiveFile.split(/[\\/]/).pop() ?? archiveFile;
    const stem = base.includes(".") ? base.slice(0, base.lastIndexOf(".")) : base;
    return `${stem}_${databaseDumpFileName(name, format)}`;
}
