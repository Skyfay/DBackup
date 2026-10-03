import type { BaseAdapter } from "@/lib/core/interfaces";
import { withHost } from "./factory";
import type { TransportResolver } from "./types";

/**
 * The single entry point for calling `ping()` / `test()` on an adapter of
 * unknown kind.
 *
 * Those two methods take an optional host, because storage and notification
 * adapters implement them too and manage their own connections. That optionality
 * is the one place a caller could forget the transport and have a source
 * configured for SSH silently checked over a direct connection, so every such
 * call is funnelled through here and the transport lint guard keeps it that way.
 */

type ConnectivityResult = { success: boolean; message: string; version?: string };

/** Adapter shape this module needs, kept structural so tests can pass a stub. */
type CheckableAdapter = Pick<BaseAdapter, "id" | "test" | "ping"> & {
    transport?: TransportResolver;
};

/**
 * Run the cheapest available connectivity check with a transport built from the
 * adapter's own config.
 *
 * Returns null when the adapter implements neither check.
 *
 * The timeout is applied INSIDE the host scope on purpose. Racing a timeout
 * against the scope itself would skip its cleanup, leaking one socket per check
 * for every unreachable source, once a minute, forever.
 */
export async function runConnectivityCheck(
    adapter: CheckableAdapter,
    config: unknown,
    options: { timeoutMs?: number; label?: string } = {},
): Promise<ConnectivityResult | null> {
    const checkFn = adapter.ping ?? adapter.test;
    if (!checkFn) return null;

    return withHost(adapter, config, async (host) => {
        const call = checkFn.call(adapter, config, host);
        if (!options.timeoutMs) return call;
        return withTimeoutInsideScope(call, options.timeoutMs, options.label ?? adapter.id);
    });
}

/**
 * Run the full `test()` check specifically, ignoring any cheaper `ping()`.
 *
 * Used where the caller wants the write-and-delete verification and the version
 * string, such as the manual "Test connection" button and the version probe the
 * dump step runs before choosing dialect-specific flags.
 */
export async function runAdapterTest(
    adapter: CheckableAdapter,
    config: unknown,
    options: { timeoutMs?: number; label?: string } = {},
): Promise<ConnectivityResult | null> {
    if (!adapter.test) return null;
    const testFn = adapter.test;

    return withHost(adapter, config, async (host) => {
        const call = testFn.call(adapter, config, host);
        if (!options.timeoutMs) return call;
        return withTimeoutInsideScope(call, options.timeoutMs, options.label ?? adapter.id);
    });
}

/**
 * Rejects when the call takes longer than the timeout. Meant to run inside a host scope, so the
 * scope still closes its connection when the timeout wins, see `runConnectivityCheck`.
 */
export function withTimeoutInsideScope<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms: ${label}`)), timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
