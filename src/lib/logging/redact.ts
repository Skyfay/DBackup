/**
 * What the logger leaves out of a line: the values of keys that hold a secret, and the password of
 * a connection string wherever it appears in a text. Free of Node imports, since Client Components
 * log through the same logger.
 */

import { SENSITIVE_KEYS } from "@/lib/core/sensitive-keys";

export const REDACTED = "[REDACTED]";

const SENSITIVE = new Set(SENSITIVE_KEYS.map((key) => key.toLowerCase()));

/** Words that make a key hold a secret wherever they appear in it, like `dbPassword` or `x-auth-token`. */
const SECRET_WORDS = new Set(["password", "passwd", "pwd", "passphrase", "secret", "token", "authorization", "cookie", "credential", "credentials", "dsn"]);

/** A `key` after one of these is key material, like `masterKey` or `encryption_key`. */
const KEY_BEFORE = new Set(["api", "private", "master", "encryption", "secret", "access", "signing", "session", "auth", "hmac", "raw", "ssh", "kit"]);

/** A `key` before one of these is key material too, like `keyHex`. */
const KEY_AFTER = new Set(["hex", "material", "bytes", "base64"]);

/** A last word that makes the value a fact about a secret, never the secret, like `tokenId` or `passwordSet`. */
const DESCRIBING = new Set(["id", "ids", "name", "names", "count", "length", "type", "types", "at", "expires", "expired", "prefix", "set", "mode", "source", "hint", "status", "policy", "rules"]);

/** The words of a key in lower case, split at case changes and at anything but a letter or digit. */
function wordsOf(key: string): string[] {
    return key
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean)
        .map((word) => word.toLowerCase());
}

/** Whether the value of a key holds a secret: a key of `SENSITIVE_KEYS` or one named after a secret. */
export function isSecretKey(key: string): boolean {
    if (SENSITIVE.has(key.toLowerCase())) return true;
    const words = wordsOf(key);
    if (words.length === 0 || DESCRIBING.has(words[words.length - 1])) return false;
    return words.some((word, i) =>
        SECRET_WORDS.has(word)
        || (word === "key" && (KEY_BEFORE.has(words[i - 1] ?? "") || KEY_AFTER.has(words[i + 1] ?? "")))
        || (word === "connection" && words[i + 1] === "string"));
}

/** The password of `scheme://user:password@host`, the userinfo up to the last `@` before the path. */
const URI_PASSWORD = /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/?#@]*):[^\s/?#]*@/gi;

/** `Password=...` and `Pwd=...` of a connection string of SQL Server or ODBC. */
const KEY_VALUE_PASSWORD = /\b(password|pwd)(\s*=\s*)("[^"]*"|'[^']*'|[^;\s]*)/gi;

/** A text without the passwords of the connection strings in it. */
export function redactText(text: string): string {
    return text.replace(URI_PASSWORD, `$1:${REDACTED}@`).replace(KEY_VALUE_PASSWORD, `$1$2${REDACTED}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== "object") return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

/** How deep a context is followed. Deeper than this, a value is left out as it may be anything. */
const MAX_DEPTH = 8;

function redactValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
    if (typeof value === "string") return redactText(value);
    if (Array.isArray(value) || isPlainObject(value)) {
        if (seen.has(value)) return "[Circular]";
        if (depth >= MAX_DEPTH) return "[Too deep]";
        seen.add(value);
        if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1, seen));
        const result: Record<string, unknown> = {};
        for (const [key, inner] of Object.entries(value)) {
            // A flag or a number says whether or how much, never the secret itself.
            result[key] = isSecretKey(key) && inner !== null && inner !== undefined && typeof inner !== "boolean" && typeof inner !== "number"
                ? REDACTED
                : redactValue(inner, depth + 1, seen);
        }
        return result;
    }
    // An Error, a Date or a class instance goes on as it is, as the line has always shown it.
    return value;
}

/** A copy of a log context with the secrets left out, see `isSecretKey` and `redactText`. */
export function redactContext<T extends Record<string, unknown>>(context: T): T {
    return redactValue(context, 0, new WeakSet()) as T;
}
