"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { domainOfEmail, isEmailDomain } from "@/lib/auth/sso-domain";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import type { DomainProvider, LoginProvider } from "@/services/auth/login-page-service";
import { providerOfEmail } from "./login-problems";

const log = logger.child({ component: "use-domain-provider" });

/** How long the email rests before the server is asked, so a domain is asked about once it is typed. */
const LOOKUP_DELAY_MS = 400;

/** Asks the server which provider a domain goes to, null for none. Throws when it could not tell. */
export async function lookUpDomainProvider(domain: string): Promise<DomainProvider | null> {
    const response = await fetch("/api/login/provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain }),
    });
    if (!response.ok) throw new Error(`The lookup answered ${response.status}`);
    const body = (await response.json()) as { success?: boolean; data?: { provider?: DomainProvider | null } };
    return body.success ? body.data?.provider ?? null : null;
}

/**
 * The provider the typed email goes to. One of the platform comes from the page itself, one of a
 * tenant from the server, asked once per domain a moment after the typing stops. `resolve` answers
 * for the email on Continue and waits for the server when it was not asked yet.
 */
export function useDomainProvider(email: string, providers: LoginProvider[], routing: boolean) {
    const asked = useRef(new Map<string, Promise<DomainProvider | null>>());
    const [found, setFound] = useState<{ domain: string; provider: DomainProvider | null } | null>(null);

    const ask = useCallback((domain: string): Promise<DomainProvider | null> => {
        const known = asked.current.get(domain);
        if (known) return known;
        const pending = lookUpDomainProvider(domain).catch((error: unknown) => {
            // Asked again next time, a failure is no answer.
            log.warn("Looking up the provider of a domain failed", {}, wrapError(error));
            asked.current.delete(domain);
            return null;
        });
        asked.current.set(domain, pending);
        return pending;
    }, []);

    const local = providerOfEmail(providers, email);
    const domain = domainOfEmail(email);
    const remote = routing && !local && domain !== null && isEmailDomain(domain) ? domain : null;

    useEffect(() => {
        if (!remote) return;
        let current = true;
        const timer = setTimeout(() => {
            void ask(remote).then((provider) => {
                if (current) setFound({ domain: remote, provider });
            });
        }, LOOKUP_DELAY_MS);
        return () => {
            current = false;
            clearTimeout(timer);
        };
    }, [remote, ask]);

    const claimed: DomainProvider | undefined = local ?? (remote && found?.domain === remote ? found.provider ?? undefined : undefined);

    const resolve = useCallback(async (value: string): Promise<DomainProvider | null> => {
        const own = providerOfEmail(providers, value);
        if (own) return own;
        const typed = domainOfEmail(value);
        if (!routing || !typed || !isEmailDomain(typed)) return null;
        return ask(typed);
    }, [providers, routing, ask]);

    return { claimed, resolve };
}
