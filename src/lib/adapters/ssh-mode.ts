import { getAdapterDefinition } from "./definitions";

/**
 * Whether an adapter has an SSH mode: a `connectionMode` that takes `ssh` (the `sshFields` of
 * `definitions/shared.ts`), or SQLite's `mode`, which does the same. Read from the schema, so a
 * new adapter with an SSH mode needs no entry here, and the SSH test of a form refuses every
 * other adapter id instead of logging in to the SSH host its config happens to carry.
 */
export function hasSshMode(adapterId: string): boolean {
    const schema = getAdapterDefinition(adapterId)?.configSchema as { shape?: Record<string, { safeParse?: (value: unknown) => { success: boolean } }> } | undefined;
    const shape = schema?.shape;
    if (!shape) return false;
    return ["connectionMode", "mode"].some((key) => Object.hasOwn(shape, key) && shape[key]?.safeParse?.("ssh").success === true);
}
