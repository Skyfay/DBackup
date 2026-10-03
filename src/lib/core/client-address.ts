/**
 * The address a request came from, as the reverse proxy in front of DBackup passes it on: the
 * first entry of X-Forwarded-For, else X-Real-IP. Null when neither is there.
 */
export function clientAddress(headers: Pick<Headers, "get">): string | null {
    const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return forwarded;
    return headers.get("x-real-ip")?.trim() || null;
}
