import type { AzureSQLConfig } from "@/lib/adapters/definitions";
import { sqlServerHost } from "@/lib/adapters/dialed-hosts";
import { AdapterError } from "@/lib/logging/errors";
import { reachableAddress } from "@/lib/network/checked-socket";
import { isAddressLiteral } from "@/lib/network/local-network";
import { reachOf } from "@/lib/network/reach-policy";

/**
 * The server SqlPackage dials for a connection of a tenant that blocks the local network: an
 * address checked right before the call, see `checked-socket.ts`, with the name kept for the
 * certificate check. SqlPackage resolves a name on its own, so without this a name that answers
 * otherwise for it than for the check of the config would reach an address of the local network.
 * The pool of the catalog reads pins its own dials, see `mssql/connector.ts`.
 *
 * Not covered: a routing redirect at login, which the driver of SqlPackage follows on its own and
 * offers no hook for. The user guide of tenants names it.
 */
export interface PinnedServer {
    /** The checked address `Server` holds. */
    address: string;
    /** The name as typed, which the certificate of the server is checked against. */
    name: string;
}

/**
 * The checked address of the host of a config, null for a tenant that blocks nothing, whose
 * SqlPackage dials the name as before.
 *
 * @throws AdapterError for a host that is more than a name or an address, BlockedAddressError or
 * UnresolvedHostError for a name that leads into the blocked network or nowhere.
 */
export async function pinnedServer(config: AzureSQLConfig): Promise<PinnedServer | null> {
    const reach = reachOf(config);
    if (!reach) return null;
    const typed = typeof config.host === "string" ? config.host.trim() : "";
    const name = sqlServerHost(typed);
    // A prefix, an instance or a port in the host would be read by SqlPackage on its own again.
    if (!name || name !== typed.replace(/^\[|\]$/g, "")) {
        throw new AdapterError("azure-sql", "config", "The host must be the plain name or address of the server, without a prefix, an instance or a port.");
    }
    const address = isAddressLiteral(name) ? name : await reachableAddress(name, Number(config.port) || 1433, reach.allowed);
    return { address, name };
}
