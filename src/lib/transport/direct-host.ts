import { spawn as spawnChild, type ChildProcess } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, stat as fsStat, unlink, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import { PassThrough, Readable, type Duplex, type Writable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { checkedSocket } from "@/lib/network/checked-socket";
import type { ReachPolicy } from "@/lib/network/reach-policy";

import { BaseHost } from "./base-host";
import type {
    HostKind,
    HostProcess,
    HostStat,
    PortForward,
    SpawnOptions,
    StageInputOptions,
    TransferOptions,
} from "./types";

/**
 * Runs commands inside the DBackup container itself, against a reachable TCP port.
 *
 * This is the `connectionMode: "direct"` transport. File operations are plain
 * filesystem calls, so staging and capturing are free: the file is already where
 * the command expects it.
 */
export class DirectHost extends BaseHost {
    readonly kind: HostKind = "direct";
    readonly label = "local";
    readonly tmpDir = os.tmpdir();

    private readonly whichCache = new Map<string, Promise<string>>();

    /** `reach` holds `connect` to checked addresses for a tenant that blocks the local network, see `reach-check.ts`. */
    constructor(private readonly reach?: ReachPolicy) {
        super();
    }

    async spawn(argv: string[], options: SpawnOptions = {}): Promise<HostProcess> {
        if (argv.length === 0) {
            throw new Error("Cannot spawn an empty argv array.");
        }
        const [command, ...args] = argv;

        // stdin is ignored unless the caller asked for it, so a command that reads
        // stdin cannot hang waiting for input nobody is going to send.
        const wantsStdin = options.stdin === true || options.stdinFile !== undefined;

        const child = spawnChild(command, args, {
            cwd: options.cwd,
            env: buildEnv(options.env),
            stdio: [wantsStdin ? "pipe" : "ignore", "pipe", "pipe"],
        });

        if (options.stdinFile !== undefined && child.stdin) {
            createReadStream(options.stdinFile).pipe(child.stdin);
        }

        return wrapChildProcess(child, options.stdin === true);
    }

    // Deliberately not `async`: returning the memoized promise itself is what
    // makes the cache observable, and it avoids an extra microtask per lookup.
    which(...candidates: string[]): Promise<string> {
        if (candidates.length === 0) {
            return Promise.reject(new Error("which() needs at least one candidate."));
        }
        // NUL separates because a binary name cannot contain one. Any printable
        // separator would let which("a b") and which("a", "b") share a cache
        // entry and resolve to each other's binary.
        const key = candidates.join("\0");
        let pending = this.whichCache.get(key);
        if (!pending) {
            pending = this.resolveBinary(candidates);
            this.whichCache.set(key, pending);
            // A failed lookup must not be cached: the operator may install the
            // tool and retry without restarting DBackup.
            pending.catch(() => this.whichCache.delete(key));
        }
        return pending;
    }

    private async resolveBinary(candidates: string[]): Promise<string> {
        for (const candidate of candidates) {
            // An explicit path configured by the user is used as-is.
            if (candidate.includes("/")) {
                const found = await fsStat(candidate).catch(() => null);
                if (found?.isFile()) return candidate;
                continue;
            }
            const result = await this.exec(["which", candidate]);
            if (result.code === 0 && result.stdout.trim()) {
                return candidate;
            }
        }
        throw new Error(
            `None of the following binaries were found on ${this.label}: ${candidates.join(", ")}`,
        );
    }

    async putFile(localPath: string, hostPath: string, options: TransferOptions = {}): Promise<void> {
        await this.copyWithProgress(localPath, hostPath, options);
    }

    async getFile(hostPath: string, localPath: string, options: TransferOptions = {}): Promise<void> {
        await this.copyWithProgress(hostPath, localPath, options);
    }

    private async copyWithProgress(from: string, to: string, options: TransferOptions): Promise<void> {
        if (from === to) return;
        if (!options.onProgress) {
            await copyFile(from, to);
            return;
        }

        const total = (await fsStat(from)).size;
        let transferred = 0;
        const counter = new PassThrough();
        counter.on("data", (chunk: Buffer) => {
            transferred += chunk.length;
            options.onProgress?.(transferred, total);
        });

        await pipeline(createReadStream(from), counter, createWriteStream(to));
    }

    async removeFile(hostPath: string): Promise<void> {
        await unlink(hostPath).catch(() => {});
    }

    async stat(hostPath: string): Promise<HostStat | null> {
        const result = await fsStat(hostPath).catch(() => null);
        if (!result) return null;
        return { size: result.size, isDirectory: result.isDirectory() };
    }

    /**
     * Writes a new temp file, refusing one that is there already, a link included, so nobody who
     * lays a file or a link under the name first gets the content, like the password of an option file.
     */
    protected async writeHostFile(hostPath: string, content: string | Buffer, mode?: number): Promise<void> {
        await writeFile(hostPath, content, mode !== undefined ? { flag: "wx", mode } : { flag: "wx" });
    }

    /** A new temp file like `writeHostFile`, so a file or a link laid under the name first never receives the bytes. */
    protected async openHostWriteStream(hostPath: string): Promise<Writable> {
        return createWriteStream(hostPath, { flags: "wx" });
    }

    /**
     * The file already lives on this host, so unless it has to be rewritten there
     * is nothing to stage. Skipping the copy avoids duplicating multi-gigabyte
     * dumps on the way into a restore.
     */
    override async stageInput<T>(
        localPath: string,
        options: StageInputOptions,
        fn: (hostPath: string) => Promise<T>,
    ): Promise<T> {
        if (!options.transform) {
            return fn(localPath);
        }
        return super.stageInput(localPath, options, fn);
    }

    /** The command can write straight to its final destination. */
    override async captureOutput<T>(
        localPath: string,
        _options: TransferOptions,
        fn: (hostPath: string) => Promise<T>,
    ): Promise<T> {
        return fn(localPath);
    }

    async connect(remoteHost: string, remotePort: number): Promise<Duplex> {
        // To checked addresses only, the next one where the first does not answer.
        if (this.reach) return checkedSocket(remoteHost, remotePort, this.reach.allowed);
        return new Promise((resolve, reject) => {
            const socket = net.createConnection({ host: remoteHost, port: remotePort });
            socket.once("connect", () => {
                socket.removeListener("error", reject);
                resolve(socket);
            });
            socket.once("error", reject);
        });
    }

    async connectSocket(socketPath: string): Promise<Duplex> {
        return new Promise((resolve, reject) => {
            const socket = net.createConnection({ path: socketPath });
            socket.once("connect", () => {
                socket.removeListener("error", reject);
                resolve(socket);
            });
            socket.once("error", reject);
        });
    }

    /** No tunnel is needed, so the original address is handed back unchanged. */
    async forwardPort(remoteHost: string, remotePort: number): Promise<PortForward> {
        return {
            host: remoteHost,
            port: remotePort,
            forwarded: false,
            lastError: null,
            close: async () => {},
        };
    }

    async dispose(): Promise<void> {
        this.whichCache.clear();
    }
}

/** Merge extra variables over the current environment, dropping undefined values. */
function buildEnv(extra?: Record<string, string | undefined>): NodeJS.ProcessEnv {
    if (!extra) return process.env;
    const merged: NodeJS.ProcessEnv = { ...process.env };
    for (const [key, value] of Object.entries(extra)) {
        if (value === undefined) {
            delete merged[key];
        } else {
            merged[key] = value;
        }
    }
    return merged;
}

/** Adapt a ChildProcess onto the HostProcess contract. */
function wrapChildProcess(child: ChildProcess, exposeStdin: boolean): HostProcess {
    let settled: { code: number | null; signal?: string } | null = null;
    let failure: Error | null = null;
    const waiters: Array<{ resolve: (v: { code: number | null; signal?: string }) => void; reject: (e: Error) => void }> = [];

    child.on("error", (err) => {
        failure = err;
        waiters.splice(0).forEach((w) => w.reject(err));
    });

    child.on("close", (code, signal) => {
        settled = { code, signal: signal ?? undefined };
        waiters.splice(0).forEach((w) => w.resolve(settled!));
    });

    return {
        stdout: child.stdout ?? Readable.from([]),
        stderr: child.stderr ?? Readable.from([]),
        stdin: exposeStdin ? child.stdin ?? null : null,
        exit() {
            if (failure) return Promise.reject(failure);
            if (settled) return Promise.resolve(settled);
            return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
        },
        kill(signal) {
            child.kill(signal);
        },
    };
}
