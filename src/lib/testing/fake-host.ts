import { PassThrough, Readable, type Duplex, type Writable } from "node:stream";

import type {
    ExecOptions,
    ExecResult,
    ExecutionHost,
    HostKind,
    HostProcess,
    HostStat,
    PortForward,
    SpawnOptions,
    StageInputOptions,
    TempFileOptions,
} from "@/lib/transport/types";

/**
 * An in-memory ExecutionHost for adapter unit tests.
 *
 * Typed as ExecutionHost rather than `any` on purpose: adding a method to the
 * interface has to break this file at compile time, not silently leave every
 * adapter test running against a stale fake.
 *
 * Tests assert on `host.calls.exec`, which records argv ARRAYS. That is strictly
 * stronger than the old approach of matching substrings inside an assembled
 * shell string, and it is identical for both transports, so most adapter suites
 * collapse into one table of expectations run against direct and ssh alike.
 */

export interface FakeHostCalls {
    exec: string[][];
    spawn: string[][];
    which: string[][];
    putFile: Array<{ localPath: string; hostPath: string }>;
    getFile: Array<{ hostPath: string; localPath: string }>;
    tempFiles: Array<{ path: string; content: string; mode?: number }>;
    removed: string[];
    forwards: Array<{ host: string; port: number }>;
    /** Socket paths passed to connectSocket(), in order. */
    sockets: string[];
    disposed: number;
}

export interface FakeHostOptions {
    kind?: HostKind;
    label?: string;
    tmpDir?: string;
    /** Result for a given argv. Return undefined to fall back to a zero exit. */
    onExec?: (argv: string[], options?: ExecOptions) => Partial<ExecResult> | undefined;
    /** Streams for a spawned process. stdout defaults to empty, exit code to 0. */
    onSpawn?: (argv: string[], options?: SpawnOptions) => { stdout?: string; stderr?: string; code?: number } | undefined;
    /**
     * Binary resolution. Return undefined to accept the default (the first
     * candidate), or null to simulate a binary that is not installed.
     */
    onWhich?: (candidates: string[]) => string | null | undefined;
    /** Sizes reported by stat(), keyed by path. */
    files?: Record<string, number>;
    /** Paths stat() reports as directories. Needed by anything that checks a target is a folder. */
    directories?: string[];
}

export interface FakeHost extends ExecutionHost {
    readonly calls: FakeHostCalls;
}

/** Drop keys whose value is undefined so they do not override defaults. */
function definedOnly<T extends object>(value: T | undefined): Partial<T> {
    if (!value) return {};
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function createFakeHost(options: FakeHostOptions = {}): FakeHost {
    const calls: FakeHostCalls = {
        exec: [],
        spawn: [],
        which: [],
        putFile: [],
        getFile: [],
        tempFiles: [],
        removed: [],
        forwards: [],
        sockets: [],
        disposed: 0,
    };

    const files = { ...(options.files ?? {}) };
    const directories = new Set(options.directories ?? []);
    let tempCounter = 0;
    const tmpDir = options.tmpDir ?? "/tmp";

    const host: FakeHost = {
        kind: options.kind ?? "direct",
        label: options.label ?? (options.kind === "ssh" ? "ssh://test@fake:22" : "local"),
        tmpDir,
        calls,

        async exec(argv, execOptions) {
            calls.exec.push([...argv]);
            const result = options.onExec?.(argv, execOptions);
            // Explicit undefined fields must not clobber the defaults: a handler
            // that returns { stdout, code: undefined } means "successful exit",
            // not "no exit code".
            return { stdout: "", stderr: "", code: 0, ...definedOnly(result) };
        },

        async spawn(argv, spawnOptions): Promise<HostProcess> {
            calls.spawn.push([...argv]);
            const result = definedOnly(options.onSpawn?.(argv, spawnOptions));

            const stdout = new PassThrough();
            const stderr = new PassThrough();
            const stdin = spawnOptions?.stdin ? new PassThrough() : null;

            setImmediate(() => {
                if (result.stdout) stdout.write(result.stdout);
                if (result.stderr) stderr.write(result.stderr);
                stdout.end();
                stderr.end();
            });

            return {
                stdout: stdout as unknown as Readable,
                stderr: stderr as unknown as Readable,
                stdin: stdin as unknown as Writable | null,
                async exit() {
                    return { code: result.code ?? 0 };
                },
                kill() {},
            };
        },

        which(...candidates) {
            calls.which.push([...candidates]);
            const requested = options.onWhich?.(candidates);
            if (requested === null) {
                return Promise.reject(new Error(`No binary found: ${candidates.join(", ")}`));
            }
            return Promise.resolve(requested ?? candidates[0]);
        },

        async withTempFile(tempOptions: TempFileOptions, fn) {
            const path = `${tmpDir}/fake_${++tempCounter}${tempOptions.suffix ?? ""}`;
            calls.tempFiles.push({
                path,
                content: tempOptions.content?.toString() ?? "",
                mode: tempOptions.mode,
            });
            files[path] = tempOptions.content?.toString().length ?? 0;
            try {
                return await fn(path);
            } finally {
                delete files[path];
                calls.removed.push(path);
            }
        },

        async stageInput(localPath, _stageOptions: StageInputOptions, fn) {
            // Mirrors DirectHost: without a transform the file is already usable.
            return fn(localPath);
        },

        async captureOutput(localPath, _transferOptions, fn) {
            return fn(localPath);
        },

        async putFile(localPath, hostPath) {
            calls.putFile.push({ localPath, hostPath });
            files[hostPath] = files[localPath] ?? 0;
        },

        async getFile(hostPath, localPath) {
            calls.getFile.push({ hostPath, localPath });
            files[localPath] = files[hostPath] ?? 0;
        },

        async removeFile(hostPath) {
            calls.removed.push(hostPath);
            delete files[hostPath];
        },

        async stat(hostPath): Promise<HostStat | null> {
            if (directories.has(hostPath)) return { size: 0, isDirectory: true };
            if (!(hostPath in files)) return null;
            return { size: files[hostPath], isDirectory: false };
        },

        async connect(): Promise<Duplex> {
            return new PassThrough();
        },

        async connectSocket(socketPath): Promise<Duplex> {
            calls.sockets.push(socketPath);
            return new PassThrough();
        },

        async forwardPort(remoteHost, remotePort): Promise<PortForward> {
            calls.forwards.push({ host: remoteHost, port: remotePort });

            // Mirrors DirectHost: with nothing to tunnel through, the original
            // address is handed back unchanged rather than a loopback stand-in.
            if ((options.kind ?? "direct") !== "ssh") {
                return {
                    host: remoteHost,
                    port: remotePort,
                    forwarded: false,
                    lastError: null,
                    close: async () => {},
                };
            }

            return {
                host: "127.0.0.1",
                port: 15000 + calls.forwards.length,
                forwarded: true,
                lastError: null,
                close: async () => {},
            };
        },

        async dispose() {
            calls.disposed++;
        },
    };

    return host;
}
