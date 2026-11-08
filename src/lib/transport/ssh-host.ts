import { createWriteStream } from "node:fs";
import { Readable, type Duplex, type Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Client, ClientChannel, SFTPWrapper } from "ssh2";

import { logger } from "@/lib/logging/logger";
import { BaseHost } from "./base-host";
import { openSshClient } from "./ssh-connection";
import { buildRemoteCommand } from "./ssh-escape";
import { createPortForward } from "./port-forward";
import type {
    HostKind,
    HostProcess,
    HostStat,
    PortForward,
    SpawnOptions,
    SshConnectionConfig,
    TransferOptions,
} from "./types";

const log = logger.child({ service: "SshHost" });

/**
 * In-flight exec channels allowed at once.
 *
 * OpenSSH defaults to MaxSessions 10 and the SFTP session claims one of those.
 * Adapters fan out (Postgres counts tables under Promise.all), and one host is
 * now shared across a whole job run, so the limit is reachable without a cap.
 */
const MAX_CONCURRENT_CHANNELS = 4;

/**
 * Runs commands on the target machine over SSH.
 *
 * The connection is opened lazily on first use, which is what keeps `test()`
 * returning `{ success: false, message }` on a failed handshake instead of
 * throwing out of the surrounding scope helper.
 */
export class SshHost extends BaseHost {
    readonly kind: HostKind = "ssh";
    readonly label: string;
    readonly tmpDir = "/tmp";

    private clientPromise: Promise<Client> | null = null;
    private sftpPromise: Promise<SFTPWrapper> | null = null;
    private sftpUnavailable = false;
    private readonly whichCache = new Map<string, Promise<string>>();
    private readonly forwards = new Set<PortForward>();
    private disposed = false;

    private activeChannels = 0;
    private readonly channelQueue: Array<() => void> = [];

    constructor(private readonly config: SshConnectionConfig) {
        super();
        this.label = `ssh://${config.username}@${config.host}:${config.port ?? 22}`;
    }

    private client(): Promise<Client> {
        if (this.disposed) {
            return Promise.reject(new Error(`Host ${this.label} has already been disposed.`));
        }
        if (!this.clientPromise) {
            this.clientPromise = openSshClient(this.config);
            // Keep the rejection for real awaiters without tripping Node's
            // unhandled-rejection warning when nothing awaits it.
            this.clientPromise.catch(() => {});
        }
        return this.clientPromise;
    }

    /**
     * One SFTP session per host, memoized as a promise rather than as the
     * resolved wrapper. Memoizing the wrapper lets two concurrent callers each
     * open a channel, which is exactly the exhaustion this cache exists to avoid.
     */
    private sftp(): Promise<SFTPWrapper> {
        if (!this.sftpPromise) {
            this.sftpPromise = this.client().then(
                (client) =>
                    new Promise<SFTPWrapper>((resolve, reject) => {
                        client.sftp((err, sftp) => (err ? reject(err) : resolve(sftp)));
                    }),
            );
            this.sftpPromise.catch(() => {});
        }
        return this.sftpPromise;
    }

    private acquireChannel(): Promise<() => void> {
        return new Promise((resolve) => {
            const grant = () => {
                this.activeChannels++;
                let released = false;
                resolve(() => {
                    if (released) return;
                    released = true;
                    this.activeChannels--;
                    this.channelQueue.shift()?.();
                });
            };
            if (this.activeChannels < MAX_CONCURRENT_CHANNELS) {
                grant();
            } else {
                this.channelQueue.push(grant);
            }
        });
    }

    async spawn(argv: string[], options: SpawnOptions = {}): Promise<HostProcess> {
        // SSH has no argv form: the protocol's exec request carries one string
        // that the remote shell interprets, so a command string has to be built.
        // buildRemoteCommand is the only thing that builds one, and it puts every
        // argument, environment value, cwd and stdin path through shellEscape,
        // which single-quotes it and rejects NUL. ssh-escape.test.ts proves that
        // by round-tripping hostile values - `a'; rm -rf /; echo '`, `$(id)`,
        // backticks, newlines - through a real shell and comparing the arguments
        // that come back out.
        //
        // CodeQL flags the client.exec call below as js/command-line-injection.
        // It sees config data reaching an exec sink and cannot model shellEscape
        // as a sanitizer. Anything that builds a command by concatenation instead
        // of going through here would be a real finding.
        const command = buildRemoteCommand(argv, options);
        const client = await this.client();
        const release = await this.acquireChannel();

        // The channel is wrapped inside the callback, synchronously.
        //
        // Awaiting the channel first and wrapping afterwards loses events: the
        // await yields, and ssh2 can deliver exit, data and close for a short
        // command in that same batch, before any listener exists. The exit
        // status then never arrives, exec() reports `code: null` for a command
        // that succeeded, and every `code !== 0` check in the adapters reads it
        // as a failure. It showed up as an intermittent "binary not found" for
        // a binary that is plainly there.
        return await new Promise<HostProcess>((resolve, reject) => {
            client.exec(command, (err, ch) => {
                if (err) {
                    release();
                    reject(err);
                    return;
                }
                resolve(wrapChannel(ch, options.stdin === true, release));
            });
        });
    }

    // Not `async`, so the memoized promise is returned by identity. See DirectHost.
    which(...candidates: string[]): Promise<string> {
        if (candidates.length === 0) {
            return Promise.reject(new Error("which() needs at least one candidate."));
        }
        const key = candidates.join("\0");
        let pending = this.whichCache.get(key);
        if (!pending) {
            pending = this.resolveBinary(candidates);
            this.whichCache.set(key, pending);
            pending.catch(() => this.whichCache.delete(key));
        }
        return pending;
    }

    private async resolveBinary(candidates: string[]): Promise<string> {
        for (const candidate of candidates) {
            const result = await this.exec(["command", "-v", candidate]);
            if (result.code === 0 && result.stdout.trim()) {
                return result.stdout.trim();
            }
        }
        throw new Error(
            `None of the following binaries were found on ${this.label}: ${candidates.join(", ")}`,
        );
    }

    async putFile(localPath: string, hostPath: string, options: TransferOptions = {}): Promise<void> {
        const sftp = await this.sftp();
        await new Promise<void>((resolve, reject) => {
            const opts: Record<string, unknown> = {};
            if (options.onProgress) {
                opts.step = (transferred: number, _chunk: number, total: number) =>
                    options.onProgress?.(transferred, total);
            }
            sftp.fastPut(localPath, hostPath, opts, (err) =>
                err ? reject(new Error(`SFTP upload failed: ${err.message}`)) : resolve(),
            );
        });
    }

    async getFile(hostPath: string, localPath: string, options: TransferOptions = {}): Promise<void> {
        if (!this.sftpUnavailable) {
            let sftp: SFTPWrapper;
            try {
                sftp = await this.sftp();
            } catch (error) {
                // The SFTP subsystem can be disabled server-side while exec still
                // works. Falling back keeps backups running on those hosts.
                this.sftpUnavailable = true;
                log.warn("SFTP subsystem unavailable, falling back to cat for downloads", {
                    host: this.label,
                    reason: error instanceof Error ? error.message : String(error),
                });
                return this.getFileViaCat(hostPath, localPath);
            }

            await new Promise<void>((resolve, reject) => {
                const opts: Record<string, unknown> = {};
                if (options.onProgress) {
                    opts.step = (transferred: number, _chunk: number, total: number) =>
                        options.onProgress?.(transferred, total);
                }
                sftp.fastGet(hostPath, localPath, opts, (err) =>
                    err ? reject(new Error(`SFTP download failed: ${err.message}`)) : resolve(),
                );
            });
            return;
        }

        return this.getFileViaCat(hostPath, localPath);
    }

    private async getFileViaCat(hostPath: string, localPath: string): Promise<void> {
        const proc = await this.spawn(["cat", hostPath]);
        const stderrChunks: Buffer[] = [];
        proc.stderr.on("data", (chunk: Buffer) => stderrChunks.push(Buffer.from(chunk)));

        await pipeline(proc.stdout, createWriteStream(localPath));
        const { code } = await proc.exit();
        if (code !== 0) {
            const detail = Buffer.concat(stderrChunks).toString("utf8").trim();
            throw new Error(`Reading ${hostPath} on ${this.label} failed with code ${code}: ${detail}`);
        }
    }

    async removeFile(hostPath: string): Promise<void> {
        try {
            const sftp = await this.sftp();
            await new Promise<void>((resolve) => sftp.unlink(hostPath, () => resolve()));
        } catch {
            await this.exec(["rm", "-f", hostPath]).catch(() => {});
        }
    }

    async stat(hostPath: string): Promise<HostStat | null> {
        const sftp = await this.sftp();
        return new Promise((resolve) => {
            sftp.stat(hostPath, (err, stats) => {
                if (err || !stats) return resolve(null);
                resolve({ size: stats.size, isDirectory: stats.isDirectory() });
            });
        });
    }

    /**
     * A new temp file, created exclusively (`wx`), like `writeHostFile` of `DirectHost`. The temp
     * folder of the target is shared with every account there, so a file or a link someone laid
     * under the name first fails the write instead of receiving a login like a `.my.cnf`.
     */
    protected async writeHostFile(hostPath: string, content: string | Buffer, mode?: number): Promise<void> {
        const sftp = await this.sftp();
        await new Promise<void>((resolve, reject) => {
            const stream = sftp.createWriteStream(hostPath, mode !== undefined ? { flags: "wx", mode } : { flags: "wx" });
            stream.once("error", reject);
            stream.once("close", () => resolve());
            stream.end(content);
        });

        if (mode !== undefined) {
            // SFTP servers may apply a umask to the mode passed at creation, so
            // set it explicitly. This is what keeps a .my.cnf at 0600.
            await new Promise<void>((resolve, reject) => {
                sftp.chmod(hostPath, mode, (err) => (err ? reject(err) : resolve()));
            });
        }
    }

    /** A new temp file like `writeHostFile`, so a file or a link laid under the name first never receives the bytes. */
    protected async openHostWriteStream(hostPath: string): Promise<Writable> {
        const sftp = await this.sftp();
        return sftp.createWriteStream(hostPath, { flags: "wx" });
    }

    async connect(remoteHost: string, remotePort: number): Promise<Duplex> {
        const client = await this.client();
        return new Promise((resolve, reject) => {
            client.forwardOut("127.0.0.1", 0, remoteHost, remotePort, (err, channel) =>
                err ? reject(err) : resolve(channel),
            );
        });
    }

    /**
     * A `direct-streamlocal@openssh.com` channel to a socket on the target machine.
     *
     * Takes no slot from the channel limiter, and that is not an oversight:
     * OpenSSH counts only shell, login and subsystem channels against
     * MaxSessions, so a forwarding channel does not compete with `spawn` or SFTP.
     * `connect` and `forwardPort` skip it for the same reason.
     *
     * The failure gets its own message because ssh2 reports a refused forward as
     * a bare channel-open failure, which names none of the causes that actually
     * occur: an sshd older than 6.7, which has no such channel type at all,
     * `AllowStreamLocalForwarding no`, and - the one that costs the most time -
     * an SSH server that is not OpenSSH. NetBird and Tailscale both intercept
     * port 22 with an embedded server that cannot forward a socket, so pointing
     * the reader at sshd_config sends them to a file that decides nothing.
     */
    async connectSocket(socketPath: string): Promise<Duplex> {
        const client = await this.client();
        return new Promise((resolve, reject) => {
            client.openssh_forwardOutStreamLocal(socketPath, (err, channel) => {
                if (err) {
                    const error = new Error(
                        `${this.label} would not forward the socket ${socketPath}: ${err.message}. ` +
                        `This needs OpenSSH 6.7 or newer with AllowStreamLocalForwarding enabled. ` +
                        `If the host is on a mesh VPN, check which SSH server actually answers: ` +
                        `NetBird and Tailscale redirect port 22 to an embedded server that cannot forward a socket at all.`,
                    );
                    // Marked so a caller can tell "this server has no such channel type" from
                    // "the socket is not there", and fall back rather than give up.
                    (error as { streamLocalUnsupported?: boolean }).streamLocalUnsupported = true;
                    reject(error);
                    return;
                }
                resolve(channel);
            });
        });
    }

    async forwardPort(remoteHost: string, remotePort: number): Promise<PortForward> {
        const client = await this.client();
        const forward = await createPortForward(client, remoteHost, remotePort);
        this.forwards.add(forward);
        return forward;
    }

    async dispose(): Promise<void> {
        if (this.disposed) return;
        this.disposed = true;

        for (const forward of this.forwards) {
            await forward.close().catch(() => {});
        }
        this.forwards.clear();
        this.whichCache.clear();

        if (this.sftpPromise) {
            await this.sftpPromise.then((sftp) => sftp.end()).catch(() => {});
            this.sftpPromise = null;
        }
        if (this.clientPromise) {
            await this.clientPromise.then((client) => client.end()).catch(() => {});
            this.clientPromise = null;
        }
    }
}

/**
 * Adapt an ssh2 ClientChannel onto the HostProcess contract.
 *
 * The channel is itself the stdout stream and carries stderr on a side channel.
 * Exit resolves on `close` rather than `exit` so buffered output is flushed
 * before callers read it, but the code is captured from `exit`.
 */
function wrapChannel(channel: ClientChannel, exposeStdin: boolean, release: () => void): HostProcess {
    let exitInfo: { code: number | null; signal?: string } = { code: null };
    let failure: Error | null = null;
    let finished = false;
    const waiters: Array<{
        resolve: (value: { code: number | null; signal?: string }) => void;
        reject: (error: Error) => void;
    }> = [];

    channel.on("exit", (code: number | null, signal?: string) => {
        exitInfo = { code: code ?? null, signal: signal ?? undefined };
    });

    channel.on("close", () => {
        finished = true;
        release();
        waiters.splice(0).forEach((w) => w.resolve(exitInfo));
    });

    channel.on("error", (err: Error) => {
        failure = err;
        finished = true;
        release();
        waiters.splice(0).forEach((w) => w.reject(err));
    });

    return {
        stdout: channel as unknown as Readable,
        stderr: channel.stderr as Readable,
        stdin: exposeStdin ? (channel as unknown as Writable) : null,
        exit() {
            if (failure) return Promise.reject(failure);
            if (finished) return Promise.resolve(exitInfo);
            return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
        },
        kill(signal) {
            channel.signal(signal ?? "TERM");
            channel.close();
        },
    };
}
