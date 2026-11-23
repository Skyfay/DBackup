/**
 * The address of an SMB share, `//server/share` or `\\server\share`, as smbclient and rpcclient
 * read it: two separators, the server, one separator, the share, then folders if any. smbclient
 * refuses a service with fewer separators, and an address that starts with `-` would reach it as
 * an option, so anything else is no address. The server is one the tools dial as written, see
 * `SMB_SERVER`, so the host the local network check sees is the host they connect to. A plain
 * module, the form schema in `definitions/storage.ts`, the local network check in `dialed-hosts.ts`
 * and the adapter read it.
 */

import { blocksLocalNetwork } from "./network-fact";

/**
 * Two separators, a server, one separator, a share. No part holds a semicolon, a double quote or a
 * control character, which rpcclient reads as part of its command, see `smbCommandRefusal`. A share
 * keeps its spaces, smbclient takes the address as an argument of its own.
 */
const SMB_ADDRESS = /^[/\\]{2}([^/\\]+)[/\\]([^/\\;"\x00-\x1f\x7f]+)(?:[/\\][^;"\x00-\x1f\x7f]*)?$/;

/**
 * The servers smbclient and rpcclient dial as written, and the local network check of a tenant reads
 * the same way: a name or an IPv4 address of letters, digits, `_`, `.` and `-` that starts with a
 * letter, a digit or `_`, or a bare IPv6 address with an optional zone. Anything else they read
 * otherwise, so it is no server here:
 *
 * - `server#20` dials `server`, the suffix is a NetBIOS name type.
 * - rpcclient takes a binding string, `ncacn_ip_tcp:10.0.0.9[135]` dials 10.0.0.9 on port 135.
 * - `server:445`, `[fd00::9]` and `user@server` are names to both tools, which no resolver knows,
 *   so the check would see nothing and the tools would ask the network by NetBIOS.
 * - A name of other letters goes to the resolver as bytes the check never looked up.
 */
const SMB_SERVER = /^(?:[A-Za-z0-9_][A-Za-z0-9_.-]*|[0-9A-Fa-f]*:[0-9A-Fa-f]*:[0-9A-Fa-f:.]*(?:%[A-Za-z0-9_.-]+)?)$/;

/** What the form says about an address that does not read. */
export const SMB_ADDRESS_HINT = "Enter the share as //server/share or \\\\server\\share, with a server name, an IPv4 address or an IPv6 address without brackets.";

/** The server and the share of an address, null when it has another form. */
export function parseSmbAddress(address: unknown): { server: string; share: string } | null {
    if (typeof address !== "string") return null;
    const match = SMB_ADDRESS.exec(address.trim());
    if (!match || !SMB_SERVER.test(match[1])) return null;
    const share = match[2].trim();
    return share ? { server: match[1], share } : null;
}

/**
 * The options every smbclient and rpcclient call of a connection of a tenant that blocks the local
 * network carries. The tools look a name up in lmhosts, WINS, DNS and then by a NetBIOS broadcast
 * into the local network, which the local network check of a tenant cannot see. DNS alone answers
 * what the check asked.
 */
export const SMB_RESOLVE_OPTIONS: readonly string[] = ["--option=name resolve order=host"];

/**
 * The resolve options of the smbclient and rpcclient calls of a config: `SMB_RESOLVE_OPTIONS` while
 * its tenant blocks the local network or nobody knows, none for the home tenant and a tenant without
 * the block, whose servers keep answering to their NetBIOS name. See `network-fact.ts`.
 */
export function smbResolveOptions(config: unknown): readonly string[] {
    return blocksLocalNetwork(config) ? SMB_RESOLVE_OPTIONS : [];
}

/**
 * Whether a login names a Kerberos realm, `user@realm`. smbclient then asks a KDC of that realm,
 * which it finds through DNS itself, so the local network check of a tenant cannot see it.
 * rpcclient reads the domain and the user as one login, `domain\user`, so a domain counts too.
 */
export function namesKerberosRealm(value: unknown): boolean {
    return typeof value === "string" && value.includes("@");
}

/**
 * Whether a user name or a domain of an SMB login holds a `%`. smbclient and rpcclient read
 * `-U user%secret` as the user and its password, and that password wins over the one DBackup hands
 * over in `PASSWD` (checked against Samba 4.22), so a `%` would sign in with another password than
 * the one of the connection and put it into the argv, where anyone on the machine reads it.
 * rpcclient takes the domain inside the same `-U domain\user`, so the domain counts too.
 */
export function smbLoginHasPercent(value: unknown): boolean {
    return typeof value === "string" && value.includes("%");
}

/** What the form and a refused run say about a `%` in the user name or the domain. */
export const SMB_LOGIN_HINT = "The user name and the domain cannot hold a %, which smbclient reads as the start of a password.";

/** Whether an address has the form smbclient reads. */
export function isSmbAddress(address: unknown): boolean {
    return parseSmbAddress(address) !== null;
}

/**
 * smbclient takes its commands through `-c` as one line, which it splits at every semicolon whatever
 * the quotes say, and samba-client puts each path into double quotes without escaping anything. A
 * semicolon in a name ends the command and starts the next one, like a `put` of any file of the
 * server DBackup runs on or a `get` that overwrites one, a double quote ends the quotes and adds
 * arguments, and a control character ends the line. No escape exists for any of them, so a path
 * that holds one never reaches smbclient. A backslash is a separator on every SMB server and
 * DBackup turns it into one before smbclient sees it, so it needs no refusal.
 */
const SMB_COMMAND_UNSAFE = /[;"\x00-\x1f\x7f]/;

/** What someone reads whose path or folder setting smbclient cannot take, with the path quoted safely. */
export function smbCommandRefusal(value: string): string | null {
    if (!SMB_COMMAND_UNSAFE.test(value)) return null;
    return `The SMB path ${JSON.stringify(value)} holds a semicolon, a double quote or a control character, which smbclient reads as part of its command, so DBackup does not pass it on.`;
}

/** What the form says about a folder setting smbclient cannot take. */
export const SMB_FOLDER_HINT = "The folder cannot hold a semicolon, a double quote or a control character, which smbclient reads as part of its command.";

/** Whether smbclient can take a path in its command, see `smbCommandRefusal`. */
export function isSmbCommandSafe(value: string): boolean {
    return !SMB_COMMAND_UNSAFE.test(value);
}
