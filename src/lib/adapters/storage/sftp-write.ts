import Client from "ssh2-sftp-client";
import crypto from "crypto";
import path from "path";

/**
 * How an SFTP upload writes a file without writing through an entry already at its name.
 *
 * A file backup restores into folders that other users and programs write to as well. A symbolic
 * link planted at the name of a restored file would carry its bytes to wherever it points, since
 * the server follows a link when it opens a path, outside the folder of the restore and the path of
 * the connection, like `.ssh/authorized_keys` of the account. So a file is opened at its name only
 * with an exclusive create, which fails on any entry there. Onto a name that holds an entry already,
 * it is written to a new name beside it, then moved over the name with `posix-rename@openssh.com`,
 * which replaces a link or a file there and never follows it. A file it replaces hands its mode and,
 * where the login may set it, its owner to the new one, as writing into it did before.
 */

type Step = (transferred: number, chunk: number, total: number) => void;

/** The options of a transfer, see `TRANSFER_TUNING` in `sftp.ts`. */
export interface SftpTransferOptions {
    concurrency: number;
    chunkSize: number;
    step?: Step;
}

/** The raw ssh2 channel behind the wrapper, for the open flags and the extensions it does not offer. */
type Attributes = { mode: number; uid: number; gid: number };
type RawChannel = {
    _extensions?: Record<string, string>;
    lstat?(remotePath: string, cb: (err: Error | undefined, attrs: Attributes) => void): void;
    setstat?(remotePath: string, attrs: Partial<Attributes>, cb: (err?: Error) => void): void;
    open(remotePath: string, flags: string, ...rest: unknown[]): void;
    fastPut(localPath: string, remotePath: string, options: SftpTransferOptions, cb: (err?: Error | null) => void): void;
};

function rawChannel(client: Client): RawChannel | undefined {
    const raw = (client as unknown as { sftp?: RawChannel }).sftp;
    return typeof raw?.fastPut === "function" && typeof raw.open === "function" ? raw : undefined;
}

/** Whether the server replaces an entry by a rename, the extension OpenSSH and most servers since offer. */
function replacesByRename(raw: RawChannel): boolean {
    return raw._extensions?.["posix-rename@openssh.com"] === "1";
}

/**
 * `fastPut` onto a name that holds nothing yet. ssh2 opens the destination with `w`, which writes
 * through a link at the name. Here it opens with `wx`, an exclusive create, so the bytes land in a
 * new file of this upload or nowhere. Every other call goes to the channel itself.
 */
function putExclusive(raw: RawChannel, localPath: string, remotePath: string, options: SftpTransferOptions): Promise<void> {
    const channel = new Proxy(raw, {
        get(target, key) {
            if (key === "open") {
                return (openPath: string, flags: string, ...rest: unknown[]) =>
                    target.open(openPath, openPath === remotePath && flags === "w" ? "wx" : flags, ...rest);
            }
            const value: unknown = Reflect.get(target, key);
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
    return new Promise((resolve, reject) => {
        raw.fastPut.call(channel, localPath, remotePath, options, (err) => (err ? reject(err) : resolve()));
    });
}

/** The mode and owner of the file at `remotePath`, undefined when they cannot be read. */
function attributesOf(raw: RawChannel, remotePath: string): Promise<Attributes | undefined> {
    return new Promise((resolve) => {
        if (!raw.lstat) return resolve(undefined);
        raw.lstat(remotePath, (err, attrs) => resolve(err ? undefined : attrs));
    });
}

/**
 * Gives the new file the owner and mode of the one it replaces, each as far as the server lets the
 * login. The owner first, since a change of owner clears the setuid and setgid bits of a mode.
 */
async function carryOver(raw: RawChannel, remotePath: string, from: Attributes): Promise<void> {
    const set = (attrs: Partial<Attributes>) =>
        new Promise<void>((resolve) => (raw.setstat ? raw.setstat(remotePath, attrs, () => resolve()) : resolve()));
    await set({ uid: from.uid, gid: from.gid });
    await set({ mode: from.mode & 0o7777 });
}

/**
 * Writes `localPath` to `destination`, never through an entry already there, see the top of this
 * file. A server without `posix-rename` has a link at the name removed first, then the file is
 * created exclusively where nothing is left, and a regular file there is written over as before.
 */
export async function putReplacing(client: Client, localPath: string, destination: string, options: SftpTransferOptions): Promise<void> {
    const raw = rawChannel(client);
    const existing = await client.exists(destination);
    if (raw && existing === false) {
        // An entry that turns up at the name in the meantime fails the create.
        await putExclusive(raw, localPath, destination, options);
        return;
    }

    if (raw && replacesByRename(raw)) {
        const replaced = existing === "-" ? await attributesOf(raw, destination) : undefined;
        // A name of fixed length, so a long file name never makes one too long for the server.
        const temp = path.posix.join(path.posix.dirname(destination), `.dbackup-${crypto.randomUUID()}.part`);
        try {
            await putExclusive(raw, localPath, temp, options);
            if (replaced) await carryOver(raw, temp, replaced);
            await client.posixRename(temp, destination);
        } catch (error) {
            await client.delete(temp, true).catch(() => { });
            throw error;
        }
        return;
    }

    // `delete` removes the link itself, never what it points at.
    if (existing === "l") await client.delete(destination);
    if (raw && existing !== "-") {
        await putExclusive(raw, localPath, destination, options);
        return;
    }
    await client.fastPut(localPath, destination, options);
}
