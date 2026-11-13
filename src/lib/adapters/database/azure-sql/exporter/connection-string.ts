import type { AzureSQLConfig } from "@/lib/adapters/definitions";
import type { PinnedServer } from "./pinned-server";

/**
 * The ADO.NET connection string SqlPackage is given.
 *
 * Its own file so the password has exactly one home and exactly one test. The
 * quoting below is the whole reason: a password containing `;` silently truncates
 * an unquoted connection string, and the resulting error names the wrong problem.
 */

/**
 * Quote a value for an ADO.NET connection string.
 *
 * Always quoted rather than only when it looks necessary. Deciding per value means
 * a rule to get wrong, and the cases that need it are exactly the ones nobody
 * tests: `;` ends the pair, `=` splits it, leading or trailing spaces are stripped.
 * Double quotes are the delimiter, so an embedded one is doubled.
 */
function quote(value: string): string {
    return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Build the connection string for one database.
 *
 * `Encrypt=True` and `TrustServerCertificate=False` are pinned rather than
 * configurable. Azure presents a real certificate on every connection, so relaxing
 * either is never a legitimate setup.
 *
 * `pinned` is the checked address of the host for a tenant that blocks the local network, from
 * `pinnedServer`, which every caller that hands the string to SqlPackage asks first.
 */
export function buildConnectionString(config: AzureSQLConfig, database: string, pinned: PinnedServer | null = null): string {
    const port = config.port || 1433;

    const pairs: [string, string][] = [
        // For a tenant that blocks the local network the checked address, so SqlPackage resolves
        // nothing itself, and the name for the certificate check, see `pinned-server.ts`.
        ["Server", `tcp:${pinned ? pinned.address : config.host},${port}`],
        ...(pinned && pinned.name !== pinned.address ? [["HostNameInCertificate", pinned.name] as [string, string]] : []),
        ["Initial Catalog", database],
        ["User ID", config.user],
        ["Password", config.password || ""],
        ["Encrypt", "True"],
        ["TrustServerCertificate", "False"],
        ["Connection Timeout", "30"],
    ];

    return pairs.map(([key, value]) => `${key}=${quote(value)}`).join(";") + ";";
}

/**
 * The same string with the password replaced, for logs and error messages.
 *
 * Never derived by regex from the real string. A redactor that has to find the
 * secret can miss it, and this one cannot, because it is handed the value.
 */
export function describeConnection(config: AzureSQLConfig, database: string): string {
    return `${config.host}:${config.port || 1433}/${database} as ${config.user}`;
}
