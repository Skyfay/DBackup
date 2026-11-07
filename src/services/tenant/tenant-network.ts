import prisma from "@/lib/prisma";
import { announcedHostsReason, dialedHosts, HostFormatError } from "@/lib/adapters/dialed-hosts";
import { NotFoundError, ValidationError } from "@/lib/logging/errors";
import { MAX_ALLOWED_RANGES, parseCidr, rangesOfColumn, toRanges } from "@/lib/network/local-network";
import { firstBlockedAddress, UnresolvedHostError, type LocalHit } from "@/lib/network/reach-check";
import type { ReachPolicy } from "@/lib/network/reach-policy";
import { currentTenantId } from "@/lib/tenant/current";
import { HOME_TENANT_ID } from "@/lib/tenant/home";

/**
 * Whether the connections of a tenant reach the local network of the server DBackup runs on, which
 * the platform decides: `Tenant.blocksLocalNetwork`, on for a new tenant, and the ranges it allows
 * anyway in `Tenant.allowedNetworks`. The home tenant is the platform and never blocked.
 *
 * A connection belongs to the tenant of its row, so a destination or a channel another tenant
 * shares follows the setting of that tenant, not the one of the customer whose run uses it.
 */

/** What the platform set for a tenant. */
export interface TenantNetwork {
    /** Its connections reach no address of the local network outside `allowed`. */
    blocks: boolean;
    /** The ranges it reaches anyway, in their short form, like `10.10.10.0/24`. */
    allowed: string[];
}

/** The setting of a tenant from its row. The home tenant blocks nothing, whatever the column says. */
export function networkOfRow(row: { id: string; blocksLocalNetwork: boolean; allowedNetworks: string }): TenantNetwork {
    return { blocks: row.id !== HOME_TENANT_ID && row.blocksLocalNetwork, allowed: rangesOfColumn(row.allowedNetworks) };
}

/**
 * Whether the connections of a tenant stay off the local network, for the adapters whose tools find
 * a server on their own, see `network-fact.ts`. The home tenant never does. A tenant nobody named, or
 * one that is gone, counts as one that does, so a fact nobody knows keeps the tools to DNS.
 */
export async function tenantBlocksLocalNetwork(tenantId: string | null | undefined): Promise<boolean> {
    if (tenantId === HOME_TENANT_ID) return false;
    if (!tenantId) return true;
    const row = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { blocksLocalNetwork: true } });
    return row ? row.blocksLocalNetwork : true;
}

/**
 * What the clients of a tenant hold their connections to: whether its tools stay off the local
 * network where they find a server on their own, like `tenantBlocksLocalNetwork`, and the policy the
 * clients that check their addresses at connect time follow, see `reach-policy.ts`. The policy
 * follows `assertHostsReachable`: none outside a tenant, in the home tenant, for a tenant that
 * blocks nothing and for one that is gone, so a connection the check lets through is never refused
 * at connect time for a reason the check does not know.
 */
export async function tenantReach(tenantId: string | null | undefined): Promise<{ blocks: boolean; policy: ReachPolicy | null }> {
    if (tenantId === HOME_TENANT_ID) return { blocks: false, policy: null };
    if (!tenantId) return { blocks: true, policy: null };
    const row = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { blocksLocalNetwork: true, allowedNetworks: true } });
    if (!row) return { blocks: true, policy: null };
    return { blocks: row.blocksLocalNetwork, policy: row.blocksLocalNetwork ? { allowed: toRanges(rangesOfColumn(row.allowedNetworks)) } : null };
}

/** The sentence that refuses a host of the local network, which names the platform as the one to ask. */
export function localNetworkRefusal(tenantName: string, hit: LocalHit): string {
    const what = hit.host === hit.address ? `${hit.address} is one` : `${hit.host} is ${hit.address}`;
    return `${tenantName} reaches no address of the local network, ${what}. The platform allows ranges for it under Platform, Tenants.`;
}

/**
 * Refuses hosts that resolve into the local network for a tenant that blocks it, outside the ranges
 * it is allowed, and hosts that do not resolve, or not in time, since nothing says where they lead.
 * Passes outside a tenant, in the home tenant and for a tenant that blocks nothing.
 *
 * @throws ValidationError naming the host and its address, or the host that does not resolve.
 */
export async function assertHostsReachable(tenantId: string | null | undefined, hosts: readonly string[] | (() => readonly string[])): Promise<void> {
    if (!tenantId || tenantId === HOME_TENANT_ID || (Array.isArray(hosts) && hosts.length === 0)) return;
    const row = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, blocksLocalNetwork: true, allowedNetworks: true } });
    if (!row?.blocksLocalNetwork) return;
    // The hosts are read only for a tenant that blocks, so an address no client reads changes
    // nothing for the others, its connection fails on its own there.
    let named: readonly string[];
    try {
        named = typeof hosts === "function" ? hosts() : hosts;
    } catch (error: unknown) {
        if (error instanceof HostFormatError) throw new ValidationError(`${row.name} reaches no address of the local network, and this address names no host to check. ${error.message}`, { field: "config" });
        throw error;
    }
    let hit: LocalHit | null;
    try {
        hit = await firstBlockedAddress(named, toRanges(rangesOfColumn(row.allowedNetworks)));
    } catch (error: unknown) {
        if (error instanceof UnresolvedHostError) throw new ValidationError(`${row.name} reaches no address of the local network. ${error.message}`, { field: "config" });
        throw error;
    }
    if (hit) throw new ValidationError(localNetworkRefusal(row.name, hit), { field: "config" });
}

/**
 * Refuses a config of a connection of a tenant whose hosts lie in its blocked local network, see
 * `dialed-hosts.ts`, and one that dials hosts its server announces, which no check sees beforehand,
 * see `announcedHostsReason`.
 */
export async function assertTenantReach(tenantId: string | null | undefined, adapterId: string, config: Record<string, unknown>): Promise<void> {
    if (!tenantId || tenantId === HOME_TENANT_ID) return;
    let hosts: string[];
    try {
        const announced = announcedHostsReason(adapterId, config);
        if (announced) throw new HostFormatError(announced);
        hosts = dialedHosts(adapterId, config);
    } catch (error: unknown) {
        if (!(error instanceof HostFormatError)) throw error;
        // Refused only where the tenant blocks the local network, see `assertHostsReachable`.
        await assertHostsReachable(tenantId, () => {
            throw error;
        });
        return;
    }
    await assertHostsReachable(tenantId, hosts);
}

/** The same for the tenant the code that runs now acts for, like a form tried before it is saved. */
export async function assertReachFromHere(adapterId: string, config: Record<string, unknown>): Promise<void> {
    await assertTenantReach(await currentTenantId(), adapterId, config);
}

/** The ranges of a change in their short form, each once, or a refusal that names the one that does not read. */
function cleanAllowed(allowed: readonly string[]): string[] {
    const texts: string[] = [];
    for (const entry of allowed) {
        const parsed = parseCidr(entry);
        if (!parsed.ok) throw new ValidationError(parsed.error, { field: "allowed" });
        if (!texts.includes(parsed.text)) texts.push(parsed.text);
    }
    if (texts.length > MAX_ALLOWED_RANGES) throw new ValidationError(`A tenant has at most ${MAX_ALLOWED_RANGES} allowed ranges. Allow a wider range instead.`, { field: "allowed" });
    return texts;
}

/**
 * Sets whether a tenant reaches the local network and the ranges it reaches anyway. The home tenant
 * is the platform and reaches what the server reaches.
 *
 * @throws ValidationError for the home tenant or a range that does not read.
 * @throws NotFoundError for a tenant that is gone.
 */
export async function setNetwork(id: string, next: TenantNetwork): Promise<{ name: string; before: TenantNetwork; after: TenantNetwork }> {
    if (id === HOME_TENANT_ID) throw new ValidationError("The home tenant is the platform and reaches the network of its server.");
    const allowed = cleanAllowed(next.allowed);
    const row = await prisma.tenant.findUnique({ where: { id }, select: { id: true, name: true, blocksLocalNetwork: true, allowedNetworks: true } });
    if (!row) throw new NotFoundError("Tenant", id);
    const after: TenantNetwork = { blocks: next.blocks, allowed };
    await prisma.tenant.update({ where: { id }, data: { blocksLocalNetwork: after.blocks, allowedNetworks: JSON.stringify(after.allowed) } });
    return { name: row.name, before: networkOfRow(row), after };
}
