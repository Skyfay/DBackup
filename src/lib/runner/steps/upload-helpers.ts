import type { AdapterConfig, StorageAdapter, StorageSession } from "@/lib/core/interfaces";
import type { LogLevel, LogType } from "@/lib/core/logs";

type LogFn = (msg: string, level?: LogLevel, type?: LogType, details?: string) => void;

/**
 * Opens a persistent upload session for the given adapter if supported,
 * otherwise returns a shim that delegates each upload to the stateless
 * `adapter.upload()` method. The session is always closed after `fn` returns
 * or throws.
 *
 * Per-upload progress and log callbacks are passed through unchanged, so
 * live progress reporting (bytes, speed) works identically whether a real
 * session or the shim is used.
 */
export async function withStorageSession<T>(
    adapter: StorageAdapter,
    config: AdapterConfig,
    onLog: LogFn | undefined,
    fn: (session: StorageSession) => Promise<T>
): Promise<T> {
    const session = adapter.openSession
        ? await adapter.openSession(config, onLog)
        : createStatelessSessionShim(adapter, config);

    try {
        return await fn(session);
    } finally {
        await session.close().catch(() => { });
    }
}

function createStatelessSessionShim(adapter: StorageAdapter, config: AdapterConfig): StorageSession {
    return {
        upload: (localPath, remotePath, onProgress, onLog) =>
            adapter.upload(config, localPath, remotePath, onProgress, onLog),
        close: async () => { },
    };
}
