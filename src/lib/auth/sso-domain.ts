/**
 * The email domain of a sign-in provider: the login page sends an email of it straight to the
 * provider, and a provider of a tenant signs in only emails of it. Plain functions, so the form in
 * the browser and the checks on the server read a domain alike.
 */

/** Labels of letters, digits and dashes joined by dots, at least two of them, like acme.ch. */
const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** A domain as it is saved and compared: trimmed, in lowercase, without a leading @. Empty is none. */
export function normalizeDomain(value: string | null | undefined): string | null {
    const clean = (value ?? "").trim().toLowerCase().replace(/^@+/, "");
    return clean === "" ? null : clean;
}

/** Whether a normalized value is a domain, like acme.ch, and not an email or an address. */
export function isEmailDomain(value: string): boolean {
    return DOMAIN.test(value) && /[a-z]/.test(value.slice(value.lastIndexOf(".") + 1));
}

/** The domain of an email in lowercase, null for a value without one. */
export function domainOfEmail(email: string | null | undefined): string | null {
    const at = (email ?? "").trim().lastIndexOf("@");
    if (at < 1) return null;
    return normalizeDomain((email ?? "").trim().slice(at + 1));
}

/** Whether an email belongs to a domain, the domain itself and never one below it. */
export function emailOfDomain(email: string | null | undefined, domain: string | null | undefined): boolean {
    const own = domainOfEmail(email);
    const wanted = normalizeDomain(domain);
    return own !== null && wanted !== null && own === wanted;
}
