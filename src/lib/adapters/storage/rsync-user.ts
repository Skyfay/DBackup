/**
 * The login name rsync puts in front of the host, `user@host:path`, and OpenSSH reads from
 * `user@host`. Both read the host after the last `@`, so a name may hold `@` like the Windows or
 * AD login `alice@corp.local`, since DBackup always puts the host after it. rsync ends the host
 * part at the first `:` and takes a spec with a `/` before it for a local path, and OpenSSH takes
 * an argument that starts with `-` for an option, so a name with one of these would make either
 * tool dial another host or run with another option than the connection says. A plain module,
 * read by the form schema, the credential profiles and the adapter.
 */

/** Why a name is no plain login name, null when it is one. */
export function rsyncUsernameProblem(username: unknown): string | null {
    if (typeof username !== "string" || username === "") return "The rsync login needs a username.";
    if (username.startsWith("-")) return "An rsync username never starts with -.";
    if (/[:/]/.test(username)) return "An rsync username holds no : or /. Put the server into Host.";
    // Whitespace and control characters, which no login name holds.
    const control = [...username].some((char) => (char.codePointAt(0) ?? 0) < 0x20 || char.codePointAt(0) === 0x7f);
    if (control || /\s/.test(username)) return "An rsync username holds no spaces or control characters.";
    return null;
}
