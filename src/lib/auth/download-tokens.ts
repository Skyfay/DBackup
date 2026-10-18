/**
 * Temporary Download Token Store
 *
 * Stores short-lived tokens for file downloads.
 * Tokens are valid for 5 minutes and single-use.
 */

import crypto from "crypto";
import fs from "fs/promises";

/** Selected paths within a directory source, mirrored structurally to keep this layer standalone. */
export interface DownloadSelection {
    src: string;
    paths?: string[];
}

interface DownloadToken {
    /**
     * A link for a command on another host, from `generateLinkToken`. The public download serves
     * these alone, the other tokens belong to the session that asked for them.
     */
    kind?: "link";
    /**
     * The tenant the token was made in. A link is fetched without a session, so it is served in
     * this tenant, and no other one finds its destination. A token a session collects itself is
     * served in it too, and only to a request of the same tenant.
     */
    tenantId?: string;
    /**
     * The API key that made the token, none for a session. A token made with a key is collected
     * only with that key, and a link only while the key may still download.
     */
    apiKeyId?: string;
    storageId: string;
    file: string;
    decrypt: boolean;
    createdAt: number;
    expiresAt: number;
    used: boolean;
    /** Who made a link, the only user its status is shown to. */
    createdBy?: string;
    /** When a link was fetched in full, and from where, so the dialog that made it can say so. */
    fetchedAt?: number;
    fetchedFrom?: string;
    /** Set while a link is being served, so a second request cannot fetch it at the same time. */
    claimed?: boolean;
    /**
     * For a link to part of a seekable archive: the dumps and folders it holds, streamed as one
     * dump or a tar.gz like a browser download of the same pick.
     */
    pick?: {
        databases?: string[];
        selections?: DownloadSelection[];
        profileIdOverride?: string;
    };
    /**
     * For a decrypted download of a seekable archive, the database dump to extract. Absent
     * means the archive's only database, which is what a single-database job holds.
     */
    database?: string;
    /**
     * Present for archive-selection downloads, which extract chosen files out of a backup
     * rather than fetching one stored file.
     */
    selection?: {
        /** The token is only honoured for the session that created it. */
        userId: string;
        selections?: DownloadSelection[];
        /** Database dumps to include, by the name recorded in the archive. */
        databases?: string[];
        /** Carried with the token so the browser's GET applies the same exclusions. */
        excludePatterns?: string[];
        /**
         * Vault profile chosen after a key prompt. Carried too, because the GET opens the
         * archive again and would otherwise be asked for a key it has no way to answer.
         */
        profileIdOverride?: string;
        fileName: string;
        /** A single dump is sent as-is, anything else as a tar.gz. Absent on older tokens. */
        contentType?: string;
    };
    /**
     * Present for a download that was already fetched and decrypted into a temp file, so the
     * browser only has to collect the finished result.
     */
    localFile?: {
        /** The token is only honoured for the session that created it. */
        userId: string;
        tempFile: string;
        fileName: string;
        contentType: string;
    };
    /**
     * The dump of a database a customer holds on a shared server. Collected through
     * `/api/shared/download` alone, whose address names no destination, and only in the tenant
     * of `tenantId`. The download of a destination never serves it.
     */
    shared?: boolean;
}

// Token validity: 5 minutes
const TOKEN_TTL_MS = 5 * 60 * 1000;

// Cleanup interval: 1 minute
const CLEANUP_INTERVAL_MS = 60 * 1000;

// Use globalThis to persist store across hot reloads in development
const globalForTokens = globalThis as unknown as {
    downloadTokenStore: Map<string, DownloadToken> | undefined;
    downloadTokenCleanupStarted: boolean | undefined;
};

// Initialize store if not exists (survives hot reloads)
if (!globalForTokens.downloadTokenStore) {
    globalForTokens.downloadTokenStore = new Map<string, DownloadToken>();
}

const tokenStore = globalForTokens.downloadTokenStore;

/**
 * Generate a new download token
 */
export function generateDownloadToken(storageId: string, file: string, decrypt: boolean = true, database?: string): string {
    const token = crypto.randomBytes(32).toString("hex");
    const now = Date.now();

    tokenStore.set(token, {
        storageId,
        file,
        decrypt,
        ...(database ? { database } : {}),
        createdAt: now,
        expiresAt: now + TOKEN_TTL_MS,
        used: false
    });

    return token;
}

/**
 * A link for a command on another host: public, single-use and five minutes long. It records
 * who made it, so that user can ask whether it was fetched yet.
 */
export function generateLinkToken(params: {
    tenantId: string;
    storageId: string;
    file: string;
    userId: string;
    /** The API key of the request, none for a session. */
    apiKeyId?: string;
    decrypt: boolean;
    database?: string;
    pick?: DownloadToken["pick"];
}): { token: string; expiresAt: number } {
    const token = crypto.randomBytes(32).toString("hex");
    const now = Date.now();

    tokenStore.set(token, {
        kind: "link",
        tenantId: params.tenantId,
        ...(params.apiKeyId ? { apiKeyId: params.apiKeyId } : {}),
        storageId: params.storageId,
        file: params.file,
        decrypt: params.decrypt,
        ...(params.database ? { database: params.database } : {}),
        ...(params.pick ? { pick: params.pick } : {}),
        createdBy: params.userId,
        createdAt: now,
        expiresAt: now + TOKEN_TTL_MS,
        used: false,
    });

    return { token, expiresAt: now + TOKEN_TTL_MS };
}

/** Who asks for a token: the tenant of the request and its API key, none for a session. */
export interface TokenMaker {
    tenantId: string | null;
    apiKeyId?: string;
}

/**
 * Whether a token was made by a request like this one: in the same tenant and with the same API
 * key, or with none for a session. A token is collected by the request that asked for it, so one
 * made in another tenant or with another key reads like one that ran out.
 */
export function madeBy(data: Pick<DownloadToken, "tenantId" | "apiKeyId">, maker: TokenMaker): boolean {
    return (data.tenantId ?? null) === (maker.tenantId ?? null) && (data.apiKeyId ?? null) === (maker.apiKeyId ?? null);
}

/** A link with the tenant it is served in and the user who made it, which every link carries. */
export type LinkToken = DownloadToken & { kind: "link"; tenantId: string; createdBy: string };

function isLinkToken(data: DownloadToken): data is LinkToken {
    return data.kind === "link" && typeof data.tenantId === "string" && typeof data.createdBy === "string";
}

/**
 * Takes a link for one request. It stays taken until that request ends: fetched in full it is
 * spent with `markTokenUsed`, broken off it is released for another try with `releaseLinkToken`.
 * Any other token, which a download hands to the session that asked for it, reads like one that
 * ran out.
 */
export function claimLinkToken(token: string): LinkToken | null {
    const data = consumeDownloadToken(token);
    if (!data || data.claimed || !isLinkToken(data)) return null;
    data.claimed = true;
    return data;
}

/** Hands a link back after a download that broke off, so the same command can run again. */
export function releaseLinkToken(token: string): void {
    const data = tokenStore.get(token);
    if (data) data.claimed = false;
}

export type LinkState = "open" | "fetched" | "expired";

/** Whether a link was fetched, for the user who made it and nobody else. */
export function linkStatus(token: string, userId: string): { state: LinkState; expiresAt: number; fetchedAt?: number; fetchedFrom?: string } | null {
    const data = tokenStore.get(token);
    if (!data || data.createdBy !== userId) return null;
    const state: LinkState = data.used ? "fetched" : Date.now() > data.expiresAt ? "expired" : "open";
    return { state, expiresAt: data.expiresAt, ...(data.fetchedAt ? { fetchedAt: data.fetchedAt } : {}), ...(data.fetchedFrom ? { fetchedFrom: data.fetchedFrom } : {}) };
}

/**
 * Validate and consume a download token
 * Returns the token data if valid, null otherwise
 * Token is marked as used after validation
 */
export function consumeDownloadToken(token: string): DownloadToken | null {
    const data = tokenStore.get(token);

    if (!data) {
        return null;
    }

    // Check if expired
    if (Date.now() > data.expiresAt) {
        tokenStore.delete(token);
        return null;
    }

    // Check if already used
    if (data.used) {
        return null;
    }

    // Note: Token is NOT marked as used here anymore
    // Call markTokenUsed() after successful download

    return data;
}

/**
 * Parks a validated file selection so the browser can fetch it as a plain GET.
 *
 * A selection is far too large for a query string, but the download has to be a normal
 * navigation for the browser's own download manager to take it - which is the point: the
 * response is written straight to disk instead of being buffered in the tab, so a selection
 * larger than the machine's RAM stays downloadable.
 */
export function generateSelectionDownloadToken(params: {
    storageId: string;
    file: string;
    userId: string;
    /** The tenant of the request, which serves the download. */
    tenantId?: string;
    /** The API key of the request, none for a session. */
    apiKeyId?: string;
    fileName: string;
    contentType?: string;
    selections?: DownloadSelection[];
    databases?: string[];
    excludePatterns?: string[];
    profileIdOverride?: string;
}): string {
    const token = crypto.randomBytes(32).toString("hex");
    const now = Date.now();

    tokenStore.set(token, {
        storageId: params.storageId,
        file: params.file,
        ...(params.tenantId ? { tenantId: params.tenantId } : {}),
        ...(params.apiKeyId ? { apiKeyId: params.apiKeyId } : {}),
        decrypt: false,
        createdAt: now,
        expiresAt: now + TOKEN_TTL_MS,
        used: false,
        selection: {
            userId: params.userId,
            selections: params.selections,
            databases: params.databases,
            excludePatterns: params.excludePatterns,
            profileIdOverride: params.profileIdOverride,
            fileName: params.fileName,
            contentType: params.contentType,
        },
    });

    return token;
}

/**
 * Resolves a selection token for the session presenting it.
 *
 * Deliberately not consumed on use - a browser that retries or resumes the download would
 * otherwise fail on the second attempt. The short TTL and the owner check bound it instead,
 * so a leaked token is worthless without that user's session. With `maker`, only a request in
 * the tenant and with the API key that made it collects it, see `madeBy`.
 */
export function consumeSelectionDownloadToken(
    token: string,
    userId: string,
    maker?: TokenMaker
): (DownloadToken & { selection: NonNullable<DownloadToken["selection"]> }) | null {
    const data = consumeDownloadToken(token);
    if (!data?.selection || data.selection.userId !== userId) return null;
    if (maker && !madeBy(data, maker)) return null;
    return data as DownloadToken & { selection: NonNullable<DownloadToken["selection"]> };
}

/**
 * Parks a file that has already been fetched and decrypted, for the browser to collect.
 *
 * The decrypting download has to know up front whether a key is needed - that answer only
 * exists after the attempt - which is why it used to run through the page and buffer the
 * whole backup in the tab. Doing the work first and handing over a token moves the decision
 * to a step that returns nothing but JSON, leaving the transfer itself a plain GET the
 * browser writes straight to disk.
 */
export function generateFileDownloadToken(params: {
    storageId: string;
    file: string;
    userId: string;
    /** The tenant of the request that prepared the file. */
    tenantId?: string;
    /** The API key of the request, none for a session. */
    apiKeyId?: string;
    tempFile: string;
    fileName: string;
    contentType: string;
}): string {
    const token = crypto.randomBytes(32).toString("hex");
    const now = Date.now();

    tokenStore.set(token, {
        storageId: params.storageId,
        file: params.file,
        ...(params.tenantId ? { tenantId: params.tenantId } : {}),
        ...(params.apiKeyId ? { apiKeyId: params.apiKeyId } : {}),
        decrypt: true,
        createdAt: now,
        expiresAt: now + TOKEN_TTL_MS,
        used: false,
        localFile: {
            userId: params.userId,
            tempFile: params.tempFile,
            fileName: params.fileName,
            contentType: params.contentType,
        },
    });

    return token;
}

/**
 * Resolves a prepared-file token for the session presenting it. With `maker`, only a request in
 * the tenant and with the API key that prepared it collects it, see `madeBy`, so the permission
 * check of that request holds for the tenant of the file.
 */
export function consumeFileDownloadToken(
    token: string,
    userId: string,
    maker?: TokenMaker
): (DownloadToken & { localFile: NonNullable<DownloadToken["localFile"]> }) | null {
    const data = consumeDownloadToken(token);
    if (!data?.localFile || data.shared || data.localFile.userId !== userId) return null;
    if (maker && !madeBy(data, maker)) return null;
    return data as DownloadToken & { localFile: NonNullable<DownloadToken["localFile"]> };
}

/**
 * Parks the dump of a shared database, already pulled out of the backup, for the customer to
 * collect through `/api/shared/download?token=`. The destination stays in the token on the
 * server, the address carries nothing but the token.
 */
export function generateSharedDownloadToken(params: {
    storageId: string;
    file: string;
    tenantId: string;
    userId: string;
    tempFile: string;
    fileName: string;
    contentType: string;
}): string {
    const { tenantId, ...file } = params;
    const token = generateFileDownloadToken(file);
    const data = tokenStore.get(token);
    if (data) Object.assign(data, { tenantId, shared: true });
    return token;
}

/** Resolves a shared dump's token for the user and the tenant presenting it, never any other token. */
export function consumeSharedDownloadToken(
    token: string,
    userId: string,
    tenantId: string
): (DownloadToken & { localFile: NonNullable<DownloadToken["localFile"]> }) | null {
    const data = consumeDownloadToken(token);
    if (!data?.shared || !data.localFile || data.localFile.userId !== userId || data.tenantId !== tenantId) return null;
    return data as DownloadToken & { localFile: NonNullable<DownloadToken["localFile"]> };
}

/**
 * Mark a token as used (call after successful download), with where it was fetched from.
 */
export function markTokenUsed(token: string, from?: string): void {
    const data = tokenStore.get(token);
    if (data) {
        data.used = true;
        data.claimed = false;
        data.fetchedAt = Date.now();
        if (from) data.fetchedFrom = from;
    }
}

/**
 * Cleanup expired tokens
 */
function cleanupExpiredTokens(): void {
    const now = Date.now();
    for (const [token, data] of tokenStore.entries()) {
        // A used token stays until it expires, so the dialog that made a link can still show
        // when it was fetched.
        if (now > data.expiresAt) {
            tokenStore.delete(token);
            // A prepared download that was never collected - the user closed the tab, or the
            // browser never followed the link - would otherwise leave its decrypted temp file
            // behind for good.
            if (data.localFile) fs.unlink(data.localFile.tempFile).catch(() => { });
        }
    }
}

// Start cleanup interval (only once, survives hot reloads)
if (typeof setInterval !== "undefined" && !globalForTokens.downloadTokenCleanupStarted) {
    globalForTokens.downloadTokenCleanupStarted = true;
    setInterval(cleanupExpiredTokens, CLEANUP_INTERVAL_MS);
}

/**
 * Get token store size (for debugging)
 */
export function getTokenStoreSize(): number {
    return tokenStore.size;
}
