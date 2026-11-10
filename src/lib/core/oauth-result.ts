import { CONFIG_BACKUP_LOGIN_LOCKED } from "@/lib/core/config-backup-locks";

/**
 * How an OAuth callback of a cloud storage login tells the Connections page how it went. The
 * address carries a fixed code and the provider, never a sentence, since anyone can write a link
 * with `?oauth=error&message=` that the page would show as a toast of DBackup. The page reads the
 * sentence of a code from here and ignores a code it does not know.
 */

export const OAUTH_PROVIDER_NAMES = { dropbox: "Dropbox", "google-drive": "Google Drive", onedrive: "OneDrive" } as const;

export type OAuthResultProvider = keyof typeof OAUTH_PROVIDER_NAMES;

/** Why a callback failed, one code a case. */
export type OAuthErrorCode =
    | "denied"
    | "missing_code"
    | "auth_required"
    | "no_rights"
    | "state_expired"
    | "locked"
    | "token_exchange"
    | "no_refresh_token"
    | "failed";

/** What a callback that broke shows. The error itself, which can carry the answer of the provider or a path of the server, goes to the log. */
export const OAUTH_CALLBACK_FAILED = "The authorization could not be completed. See the server log for details.";

/** What a callback shows when the provider reports a refused authorization, whatever it adds. */
export const OAUTH_DENIED = "Authorization was denied by the user.";

/** What the provider needs to hand out a refresh token, the hint of `no_refresh_token`. */
const REFRESH_TOKEN_HINTS: Record<OAuthResultProvider, string> = {
    dropbox: "Ensure the app has 'offline' access configured.",
    "google-drive": "Please revoke app access in your Google Account settings and try again.",
    onedrive: "Ensure the app has 'offline_access' scope configured.",
};

const ERROR_TEXTS: Record<OAuthErrorCode, (provider: OAuthResultProvider | null) => string> = {
    denied: () => OAUTH_DENIED,
    missing_code: () => "Missing authorization code or state.",
    auth_required: () => "Authentication required. Please log in and try again.",
    no_rights: () => "You may not change saved logins in this tenant.",
    state_expired: () => "This authorization ran out or belongs to another session. Start it again from the saved login.",
    locked: () => CONFIG_BACKUP_LOGIN_LOCKED,
    token_exchange: (provider) => `${provider ? `${OAUTH_PROVIDER_NAMES[provider]} refused` : "The provider refused"} the token exchange. See the server log for details.`,
    no_refresh_token: (provider) => `No refresh token received.${provider ? ` ${REFRESH_TOKEN_HINTS[provider]}` : ""}`,
    failed: () => OAUTH_CALLBACK_FAILED,
};

const known = <T extends string>(table: Record<T, unknown>, value: string | null): value is T => value !== null && Object.prototype.hasOwnProperty.call(table, value);

/** The page a callback returns to, with how it went: `oauth=success` or `oauth=error` with its `code`, and the provider. */
export function oauthReturnUrl(origin: string, provider: OAuthResultProvider, error: OAuthErrorCode | null): string {
    const query = new URLSearchParams({ tab: "destinations", oauth: error ? "error" : "success", ...(error ? { code: error } : {}), provider });
    return `${origin}/dashboard/connections?${query}`;
}

/** The query parameters `oauthReturnUrl` writes, which the page takes off the address again. */
export const OAUTH_RESULT_PARAMS = ["oauth", "code", "provider", "message"] as const;

/**
 * The toast of the result an address names, from its fixed codes. Null for anything else, like a
 * code it does not know or a `message` of the address, which is never shown.
 */
export function oauthResultToast(params: { get(name: string): string | null }): { kind: "success" | "error"; text: string } | null {
    const rawProvider = params.get("provider");
    const provider = known(OAUTH_PROVIDER_NAMES, rawProvider) ? rawProvider : null;
    const status = params.get("oauth");
    if (status === "success") return { kind: "success", text: provider ? `${OAUTH_PROVIDER_NAMES[provider]} authorized successfully.` : "Authorized successfully." };
    const code = params.get("code");
    if (status === "error" && known(ERROR_TEXTS, code)) return { kind: "error", text: ERROR_TEXTS[code](provider) };
    return null;
}
