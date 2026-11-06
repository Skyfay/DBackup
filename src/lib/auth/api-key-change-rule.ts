/**
 * Who may do what to an API key. A key acts as its owner, with the groups and the reach of its
 * owner, so whoever gets its secret or makes it do more acts as that owner. Rotating a key and
 * changing what it may do (its permissions, a later end or none) are for its owner and a platform
 * admin only. Anyone else who may change API keys only takes access away: they pause, delete or
 * rename a key of someone else, or let it run out sooner. Plain rules, read by the actions and
 * the API keys tab alike.
 */

/** Someone who acts on a key, as `getViewer` hands them on. */
export interface KeyActor {
    id: string;
    isPlatformAdmin: boolean;
}

/** Whether someone may rotate a key and change what it may do: its owner or a platform admin. */
export function holdsKey(actor: KeyActor | null, ownerId: string): boolean {
    return actor !== null && (actor.id === ownerId || actor.isPlatformAdmin);
}

/** Whether a new end of a key is no later than the one it has. A key that never runs out may get any end. */
export function endsNoLater(before: Date | null, after: Date | null): boolean {
    if (before === null) return true;
    return after !== null && after.getTime() <= before.getTime();
}

/** Whether two lists hold the same permissions, whatever their order. */
export function samePermissions(a: readonly string[], b: readonly string[]): boolean {
    const left = new Set(a);
    const right = new Set(b);
    return left.size === right.size && [...left].every((permission) => right.has(permission));
}

export const ROTATE_REFUSAL = "Only its owner or a platform admin rotates a key, since the new secret acts as its owner.";
export const RESUME_REFUSAL = "Only its owner or a platform admin enables a key of someone else again.";
export const PERMISSIONS_REFUSAL = "Only its owner or a platform admin changes what a key may do. You may rename it, let it run out sooner, disable or delete it.";
export const LATER_END_REFUSAL = "Only its owner or a platform admin lets a key run longer. You may let it run out sooner.";
