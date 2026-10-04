"use client";

import { useEffect, useState } from "react";
import { getRetentionPolicyTargets } from "@/app/actions/templates-retention";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import type { RetentionTargets } from "@/services/templates/templates-types";

const log = logger.child({ hook: "use-retention-targets" });

/** The destinations of a policy, or the ones that follow the default. Null while there are none to ask for. */
export type TargetScope = { policyId: string } | { followers: true } | null;

/**
 * Loads the destinations a change of a retention policy reaches, with the backups each holds, once
 * per policy. What a change removes is then worked out in the browser, so the numbers follow every
 * click at once. Null while it loads or when it could not be loaded.
 */
export function useRetentionTargets(scope: TargetScope) {
    const key = scope === null ? null : "followers" in scope ? "followers" : scope.policyId;
    const [state, setState] = useState<{ key: string; data: RetentionTargets | null } | null>(null);

    useEffect(() => {
        if (key === null) return;
        let ignore = false;
        const ask = key === "followers" ? ({ followers: true } as const) : { policyId: key };
        getRetentionPolicyTargets(ask)
            .then((result) => {
                if (ignore) return;
                if (!result.success) log.warn("The destinations of a policy could not be loaded", { error: result.error });
                setState({ key, data: result.success ? result.data : null });
            })
            .catch((error: unknown) => {
                // Without the right to read templates the action throws instead of answering.
                log.warn("The destinations of a policy could not be loaded", {}, wrapError(error));
                if (!ignore) setState({ key, data: null });
            });
        return () => {
            ignore = true;
        };
    }, [key]);

    const current = key !== null && state !== null && state.key === key;
    return { targets: current ? (state?.data ?? null) : null, loading: key !== null && !current };
}
