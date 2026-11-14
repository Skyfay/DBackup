/**
 * Which waiting run gets a free slot of the queue every tenant shares. One rule for the queue
 * itself (`processQueue`) and for the plan of it the Timeline draws (`planQueue`), so the two
 * agree. Plain functions, so the rule can be tested.
 *
 * The order between tenants, then inside one:
 * 1. The tenant with the fewest runs that hold a slot now.
 * 2. Among those the tenant whose last run started longest ago, one that never started first.
 * 3. Inside a tenant the oldest waiting run.
 *
 * So a tenant with many waiting runs holds back a run of another tenant by no more than the runs
 * that hold a slot already, never by its whole line.
 */

/** When each tenant last got a slot, as any number that grows with time. */
export type LastServed = Map<string | undefined, number>;

/**
 * The index of the run that gets the slot, or -1 for no candidates.
 *
 * @param candidates The runs that may start now, oldest first.
 * @param running How many runs of each tenant hold a slot now.
 * @param lastServed When each tenant last got a slot. A tenant that is missing never did.
 */
export function pickFairly(
    candidates: { tenantId?: string }[],
    running: Map<string | undefined, number>,
    lastServed: LastServed,
): number {
    let best = -1;
    let bestRunning = Number.POSITIVE_INFINITY;
    let bestServed = Number.POSITIVE_INFINITY;
    for (let index = 0; index < candidates.length; index++) {
        const tenant = candidates[index].tenantId;
        const count = running.get(tenant) ?? 0;
        const served = lastServed.get(tenant) ?? Number.NEGATIVE_INFINITY;
        // Strictly better only, so the oldest run wins a tie and stays first inside its tenant.
        if (count < bestRunning || (count === bestRunning && served < bestServed)) {
            best = index;
            bestRunning = count;
            bestServed = served;
        }
    }
    return best;
}
