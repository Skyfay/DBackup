import { randomUUID } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import type { Duplex, Writable } from "node:stream";

import { BaseHost } from "./base-host";
import type {
    ExecutionHost,
    HostKind,
    HostProcess,
    HostStat,
    PortForward,
    SpawnOptions,
    TransferOptions,
} from "./types";

/**
 * Runs commands on one transport while moving files over another.
 *
 * This exists for one real configuration: MSSQL with `connectionMode: "direct"`
 * and `fileTransferMode: "ssh"`. There, T-SQL goes straight to the server over
 * TDS while the .bak file travels by SFTP. Modelling it as a host rather than as
 * a branch is what keeps mssql/dump.ts and mssql/restore.ts free of transport
 * checks: `captureOutput` is correct in all three MSSQL modes.
 */
export class CompositeHost extends BaseHost {
    readonly kind: HostKind;
    readonly label: string;
    readonly tmpDir: string;

    constructor(
        private readonly execHost: ExecutionHost,
        private readonly fileHost: ExecutionHost,
    ) {
        super();
        // Commands are what "kind" describes, so it follows the exec transport.
        this.kind = execHost.kind;
        this.label = `${execHost.label} + files via ${fileHost.label}`;
        // Staged and captured files land wherever the file transport can reach.
        this.tmpDir = fileHost.tmpDir;
    }

    spawn(argv: string[], options?: SpawnOptions): Promise<HostProcess> {
        return this.execHost.spawn(argv, options);
    }

    which(...candidates: string[]): Promise<string> {
        return this.execHost.which(...candidates);
    }

    connect(remoteHost: string, remotePort: number): Promise<Duplex> {
        return this.execHost.connect(remoteHost, remotePort);
    }

    connectSocket(socketPath: string): Promise<Duplex> {
        return this.execHost.connectSocket(socketPath);
    }

    forwardPort(remoteHost: string, remotePort: number): Promise<PortForward> {
        return this.execHost.forwardPort(remoteHost, remotePort);
    }

    putFile(localPath: string, hostPath: string, options?: TransferOptions): Promise<void> {
        return this.fileHost.putFile(localPath, hostPath, options);
    }

    getFile(hostPath: string, localPath: string, options?: TransferOptions): Promise<void> {
        return this.fileHost.getFile(hostPath, localPath, options);
    }

    removeFile(hostPath: string): Promise<void> {
        return this.fileHost.removeFile(hostPath);
    }

    stat(hostPath: string): Promise<HostStat | null> {
        return this.fileHost.stat(hostPath);
    }

    protected async writeHostFile(hostPath: string, content: string | Buffer, mode?: number): Promise<void> {
        // Stage the bytes locally, then push them over the file transport. The
        // file transport's own writeHostFile is protected and belongs to a
        // different instance, so this goes through the public putFile instead.
        const localPath = join(os.tmpdir(), `dbackup_${randomUUID()}`);
        // Created exclusively, so a file or a link laid under the name first fails the write.
        await writeFile(localPath, content, mode !== undefined ? { flag: "wx", mode } : { flag: "wx" });
        try {
            await this.fileHost.putFile(localPath, hostPath);
        } finally {
            await unlink(localPath).catch(() => {});
        }
    }

    protected async openHostWriteStream(): Promise<Writable> {
        throw new Error(
            "CompositeHost does not support streaming writes. Use putFile or stageInput without a transform.",
        );
    }

    async dispose(): Promise<void> {
        await this.execHost.dispose().catch(() => {});
        await this.fileHost.dispose().catch(() => {});
    }
}

/** True when this host moves files over a different transport than it runs commands on. */
export function isCompositeHost(host: ExecutionHost): boolean {
    return host instanceof CompositeHost;
}
