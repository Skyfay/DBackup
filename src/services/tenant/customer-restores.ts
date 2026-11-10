import { customerRestores, getAdapterDefinition } from "@/lib/adapters/definitions";

/**
 * Why a customer may not restore a database of a server of this engine themselves, null when they
 * may. Such an engine restores with the login of the provider's connection and cannot keep the code
 * of the dump to the rights of the customer, see `AdapterDefinition.customerRestores`. The service
 * of shared databases asks it when it names the target, the archive restore again before it stages
 * anything.
 */
export function customerRestoreRefusal(adapterId: string): string | null {
    if (customerRestores(adapterId)) return null;
    const engine = getAdapterDefinition(adapterId)?.name ?? "this engine";
    return `A customer cannot restore a ${engine} database of a shared server, since its restore runs with the login of the provider. The provider can restore it from its own History.`;
}
