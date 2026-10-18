/**
 * The address of an SMB share, `//server/share` or `\\server\share`, as smbclient and rpcclient
 * read it: two separators, the server, one separator, the share, then folders if any. smbclient
 * refuses a service with fewer separators, and an address that starts with `-` would reach it as
 * an option, so anything else is no address. A plain module, the form schema in
 * `definitions/storage.ts`, the local network check in `dialed-hosts.ts` and the adapter read it.
 */

/** Two separators, a server without separators, whitespace or a leading `-`, one separator, a share. */
const SMB_ADDRESS = /^[/\\]{2}([^/\\\s-][^/\\\s]*)[/\\]([^/\\]+)(?:[/\\].*)?$/;

/** What the form says about an address that does not read. */
export const SMB_ADDRESS_HINT = "Enter the share as //server/share or \\\\server\\share.";

/** The server and the share of an address, null when it has another form. */
export function parseSmbAddress(address: unknown): { server: string; share: string } | null {
    if (typeof address !== "string") return null;
    const match = SMB_ADDRESS.exec(address.trim());
    if (!match) return null;
    const share = match[2].trim();
    return share ? { server: match[1], share } : null;
}

/** Whether an address has the form smbclient reads. */
export function isSmbAddress(address: unknown): boolean {
    return parseSmbAddress(address) !== null;
}
