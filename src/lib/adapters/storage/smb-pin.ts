import { parseSmbAddress } from "@/lib/adapters/smb-address";
import { reachableAddress } from "@/lib/network/checked-socket";
import { reachOf } from "@/lib/network/reach-policy";

/**
 * The `-I` option of smbclient and rpcclient for a share of a tenant that blocks the local network:
 * the address of the server checked right before the call, the first that answers on port 445
 * where it has several, see `checked-socket.ts`. The tools then
 * dial that address and keep the name of the share address for the session itself, so the name
 * cannot lead elsewhere the second time. None for any other tenant.
 *
 * Not covered: a DFS referral, which sends smbclient on to another server it names. smbclient 4.22
 * has no option and no smb.conf setting to stop following one (checked against `smbclient --help`,
 * `man smbclient` and `man smb.conf`), so a referral reaches a server the check never saw. A name
 * in it still goes through the DNS-only lookup of `SMB_RESOLVE_OPTIONS`.
 */
/** The port smbclient and rpcclient dial, the one of SMB over TCP. */
const SMB_PORT = 445;

export async function smbAddressOptions(config: { address?: unknown }): Promise<string[]> {
    const reach = reachOf(config);
    if (!reach) return [];
    const parsed = parseSmbAddress(config.address);
    if (!parsed) return [];
    return ["-I", await reachableAddress(parsed.server, SMB_PORT, reach.allowed)];
}
