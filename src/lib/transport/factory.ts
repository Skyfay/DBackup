import { CompositeHost } from "./composite-host";
import { DirectHost } from "./direct-host";
import { SshHost } from "./ssh-host";
import { resolveTransport } from "./spec";
import type { ExecutionHost, TransportResolver, TransportSpec } from "./types";

/**
 * Build a host from a spec. Synchronous and free of I/O.
 *
 * Connecting is deferred to the first operation that needs it. That laziness is
 * load-bearing: `test()` has to keep returning `{ success: false, message }` on a
 * failed SSH handshake, which it cannot do if creating the host already threw.
 */
export function createHost(spec: TransportSpec): ExecutionHost {
    switch (spec.kind) {
        case "direct":
            return new DirectHost(spec.reach);
        case "ssh":
            return new SshHost(spec.ssh);
        case "composite":
            return new CompositeHost(createHost(spec.exec), createHost(spec.files));
    }
}

/**
 * Run `fn` with a host resolved from the adapter's config, disposing it afterwards.
 *
 * Scope this around a whole unit of work rather than a single adapter call. A
 * combined backup that calls getDatabases, test, then dumpOne per database used
 * to open one SSH connection each; wrapping the step collapses that to one.
 *
 * Any timeout must be applied INSIDE this callback. Racing a timeout against
 * withHost itself skips the finally block and leaks the connection.
 */
export async function withHost<T>(
    adapter: { id: string; transport?: TransportResolver },
    config: unknown,
    fn: (host: ExecutionHost) => Promise<T>,
): Promise<T> {
    const host = createHost(resolveTransport(adapter, config));
    try {
        return await fn(host);
    } finally {
        await host.dispose().catch(() => {});
    }
}
