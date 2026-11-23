/**
 * How often a tenant sends a test through a channel another tenant shares with it: once a minute
 * for each channel, so nobody sends messages in a loop through the mail server or the chat of
 * another tenant. The test of the recipients and Send a test of the notification settings share it.
 */

/** How long a tenant waits between two tests of one channel. */
export const TEST_COOLDOWN_MS = 60_000;

/** When each tenant last sent a test through a channel, by tenant and channel. */
const lastTests = new Map<string, number>();

const keyOf = (tenantId: string, configId: string) => `${tenantId}\n${configId}`;

/**
 * Claims the test of a channel for a tenant at `now`, false while one went out less than a minute
 * ago. The claim holds at once, so of two requests at the same moment only one sends.
 */
export function claimChannelTest(tenantId: string, configId: string, now = Date.now()): boolean {
    const key = keyOf(tenantId, configId);
    const last = lastTests.get(key);
    if (last !== undefined && now - last < TEST_COOLDOWN_MS) return false;
    lastTests.set(key, now);
    return true;
}

/** Gives back a claim of `now` when the test was refused before anything went out. */
export function releaseChannelTest(tenantId: string, configId: string, now: number): void {
    const key = keyOf(tenantId, configId);
    if (lastTests.get(key) === now) lastTests.delete(key);
}
