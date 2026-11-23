import { safeNextPath } from "@/lib/auth/sign-in-target";

/**
 * Where a sign-in through a provider leads, kept in the tab. A provider that refuses sends the
 * browser back to the login page with its error alone, so the page asked for would be lost.
 */
export const SSO_NEXT_KEY = "dbackup.ssoNext";

/** Keeps the page for the sign-in through a provider that starts now, or forgets it for none. */
export function rememberSsoNext(next: string | null): void {
    try {
        if (next) sessionStorage.setItem(SSO_NEXT_KEY, next);
        else sessionStorage.removeItem(SSO_NEXT_KEY);
    } catch {
        // Without the storage of the tab a refused sign-in leads to the Overview.
    }
}

/** The page the last sign-in through a provider was meant to lead to, checked again, or null. */
export function rememberedSsoNext(): string | null {
    try {
        return safeNextPath(sessionStorage.getItem(SSO_NEXT_KEY));
    } catch {
        return null;
    }
}
