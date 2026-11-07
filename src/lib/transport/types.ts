import type { Duplex, Readable, Transform, Writable } from "node:stream";

import type { ReachPolicy } from "@/lib/network/reach-policy";

/**
 * Transport layer contracts.
 *
 * An ExecutionHost answers "how do I run a process and move bytes", so adapters
 * only have to answer "what do I run". `direct` runs inside the DBackup container,
 * `ssh` runs on the target machine. A future `agent` slots in behind the same
 * interface without touching a single adapter.
 */

export type HostKind = "direct" | "ssh";

/**
 * SSH connection parameters, normalized away from the two different field
 * conventions used in stored adapter configs (prefixed `sshHost` for most
 * adapters, unprefixed `host` for SQLite).
 */
export interface SshConnectionConfig {
    host: string;
    port?: number;
    username: string;
    authType: "password" | "privateKey" | "agent";
    password?: string;
    privateKey?: string;
    passphrase?: string;
    /**
     * Set for a connection of a tenant that blocks the local network: the SSH server is dialed at
     * an address checked at connect time, see `reach-check.ts`. Never read from a stored field.
     */
    reach?: ReachPolicy;
}

export interface ExecOptions {
    /**
     * Extra environment for the process. The SSH transport renders these as
     * `export K='v'; cmd` rather than putting them in argv, so secrets never
     * show up in the remote `ps` output.
     */
    env?: Record<string, string | undefined>;
    cwd?: string;
    /** Bytes written to stdin, which is then closed. Mutually exclusive with `stdinFile`. */
    stdin?: string | Buffer;
    /** Feed a file that already lives ON THIS HOST to stdin. Mutually exclusive with `stdin`. */
    stdinFile?: string;
    timeoutMs?: number;
    /**
     * Bytes buffered per stream before the call fails. Output is never silently
     * truncated: exceeding this rejects. Defaults to 16 MiB.
     */
    maxBuffer?: number;
}

export interface ExecResult {
    stdout: string;
    stderr: string;
    /** null when the process was killed by a signal. A non-zero code never throws. */
    code: number | null;
    signal?: string;
}

export interface SpawnOptions extends Omit<ExecOptions, "stdin" | "maxBuffer"> {
    /** Open a writable stdin on the returned process. Defaults to false. */
    stdin?: boolean;
}

/**
 * A running process, normalized across `child_process` and ssh2's ClientChannel.
 */
export interface HostProcess {
    readonly stdout: Readable;
    readonly stderr: Readable;
    /** null unless `SpawnOptions.stdin` was set. */
    readonly stdin: Writable | null;
    /**
     * Resolves when the process closes. Deliberately does NOT reject on a
     * non-zero exit: callers such as pg_restore treat some non-zero codes as
     * success, so the decision belongs to them.
     */
    exit(): Promise<{ code: number | null; signal?: string }>;
    kill(signal?: NodeJS.Signals): void;
}

export interface TempFileOptions {
    /** Appended to the generated name, e.g. ".cnf". */
    suffix?: string;
    /** Written before the callback runs. Replaces withLocalMyCnf / withRemoteMyCnf. */
    content?: string | Buffer;
    /** POSIX mode applied after creation. The SSH transport chmods over SFTP. */
    mode?: number;
}

export interface TransferOptions {
    onProgress?: (transferred: number, total: number) => void;
}

export interface StageInputOptions extends TransferOptions {
    /**
     * Rewrite bytes on the way in. Applied identically on both transports, which
     * is what lets adapters drop remote `sed` pipelines and their quoting bugs.
     */
    transform?: () => Transform;
    /** Verify the staged byte count against what was written. Defaults to true. */
    verifySize?: boolean;
}

/**
 * A local address that proxies to `remoteHost:remotePort` as reachable from the
 * execution host. Lets native drivers (tedious, the mongodb driver) reach a
 * database that only listens on the target machine's loopback.
 */
export interface PortForward {
    readonly host: string;
    readonly port: number;
    /** false when the host is direct and the address is simply the original one. */
    readonly forwarded: boolean;
    /**
     * First transport-level forwarding error, if any. Surfaced because the
     * driver-side symptom is unreadable: with `AllowTcpForwarding no` the
     * forward fails per connection and tedious only reports a reset peer.
     */
    readonly lastError: Error | null;
    close(): Promise<void>;
}

export interface HostStat {
    size: number;
    isDirectory: boolean;
}

export interface ExecutionHost {
    readonly kind: HostKind;
    /** Loggable target description. Never contains secrets. "local" or "ssh://ops@10.0.0.4:22". */
    readonly label: string;
    /** Directory for temporary files on this host. */
    readonly tmpDir: string;

    /** Run to completion and buffer output. argv[0] is the binary. Never a shell string. */
    exec(argv: string[], options?: ExecOptions): Promise<ExecResult>;
    /** Start a process and return its streams, for dump and restore piping. */
    spawn(argv: string[], options?: SpawnOptions): Promise<HostProcess>;
    /** First candidate found on this host's PATH. Throws when none exist. Memoized per host. */
    which(...candidates: string[]): Promise<string>;

    withTempFile<T>(options: TempFileOptions, fn: (path: string) => Promise<T>): Promise<T>;
    /** Make a local file usable by commands on this host, then clean up. */
    stageInput<T>(localPath: string, options: StageInputOptions, fn: (hostPath: string) => Promise<T>): Promise<T>;
    /** Give a command a path to write on this host, then land the bytes at localPath. */
    captureOutput<T>(localPath: string, options: TransferOptions, fn: (hostPath: string) => Promise<T>): Promise<T>;

    putFile(localPath: string, hostPath: string, options?: TransferOptions): Promise<void>;
    getFile(hostPath: string, localPath: string, options?: TransferOptions): Promise<void>;
    removeFile(hostPath: string): Promise<void>;
    /** null when the path does not exist. */
    stat(hostPath: string): Promise<HostStat | null>;

    /** TCP stream to host:port as reachable from this host. */
    connect(remoteHost: string, remotePort: number): Promise<Duplex>;
    /**
     * Stream to a Unix domain socket as reachable from this host.
     *
     * Exists for clients that speak a protocol over a socket rather than a port -
     * the Docker daemon is the first - and returns a bare stream rather than a
     * local address on purpose. A client that accepts a connection factory can
     * then be pointed at a remote daemon with no listener in between, and a
     * future agent transport that has no TCP to offer at all still fits.
     */
    connectSocket(socketPath: string): Promise<Duplex>;
    /** Expose host:port at a local address a native driver can dial. */
    forwardPort(remoteHost: string, remotePort: number): Promise<PortForward>;

    /** Idempotent. Closes the SFTP session, every forward, and the connection. */
    dispose(): Promise<void>;
}

/**
 * Describes which transport an adapter config asks for, without holding any
 * connection. Produced by a TransportResolver, consumed by createHost.
 */
export type TransportSpec =
    /** `reach` holds `connect` to checked addresses for a tenant that blocks the local network. */
    | { kind: "direct"; reach?: ReachPolicy }
    | { kind: "ssh"; ssh: SshConnectionConfig }
    /** Commands run on one transport, files move over another. MSSQL's legacy fileTransferMode. */
    | { kind: "composite"; exec: TransportSpec; files: TransportSpec };

/**
 * Maps an adapter config onto a TransportSpec. Adapters that follow the standard
 * `connectionMode` + `ssh*` convention need no resolver of their own.
 */
export type TransportResolver = (config: Record<string, unknown>) => TransportSpec;
