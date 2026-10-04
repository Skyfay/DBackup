import type { CredentialType } from "./credentials";

/** What a credential profile holds, in words that name no secret. */
export interface CredentialHolds {
    /** Like "user backup" or "ed25519 · SHA256:9f2c…4a1e". */
    holds: string;
    /** Why the profile needs a look, like an OAuth app that was never authorized. */
    attention: string | null;
}

/** The first word of an `authorized_keys` line, as people call the kind of key. */
const KEY_TYPES: Record<string, string> = {
    "ssh-ed25519": "ed25519",
    "sk-ssh-ed25519@openssh.com": "ed25519-sk",
    "ssh-rsa": "RSA",
    "ecdsa-sha2-nistp256": "ECDSA P-256",
    "ecdsa-sha2-nistp384": "ECDSA P-384",
    "ecdsa-sha2-nistp521": "ECDSA P-521",
};

/** The kind of an SSH public key, like "ed25519", or null for a line that is not one. */
export function sshKeyType(publicKey: string | undefined): string | null {
    const kind = publicKey?.trim().split(/\s+/)[0];
    return kind ? KEY_TYPES[kind] ?? kind : null;
}

/** A fingerprint cut to its start and end, like "SHA256:9f2c…4a1e", which still tells keys apart at a glance. */
export function shortFingerprint(fingerprint: string): string {
    const [algorithm, hash] = fingerprint.includes(":") ? fingerprint.split(":", 2) : ["", fingerprint];
    const short = hash.length > 10 ? `${hash.slice(0, 4)}…${hash.slice(-4)}` : hash;
    return algorithm ? `${algorithm}:${short}` : short;
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

function hostOf(url: string): string | null {
    try {
        return new URL(url).host || null;
    } catch {
        return null;
    }
}

/**
 * What a decrypted payload holds, for the list of the Vault. It names a user and the host of a
 * webhook, which are no secrets, and says only that the rest is set. An access key ID counts as
 * a secret here, like everywhere its field is masked.
 */
export function holdsOf(type: CredentialType, payload: unknown, fingerprint?: string): CredentialHolds {
    const data = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
    const user = text(data.username) || text(data.user);
    const ok = (holds: string): CredentialHolds => ({ holds, attention: null });

    switch (type) {
        case "USERNAME_PASSWORD":
        case "SMTP":
            return ok(user ? `user ${user}` : "user and password");
        case "SSH_KEY": {
            if (data.authType === "privateKey") {
                const kind = sshKeyType(text(data.publicKey) || undefined);
                if (kind && fingerprint) return ok(`${kind} · ${shortFingerprint(fingerprint)}`);
                return ok(user ? `user ${user}, private key` : "private key");
            }
            if (data.authType === "agent") return ok(user ? `user ${user}, SSH agent` : "SSH agent");
            return ok(user ? `user ${user}, password` : "password");
        }
        case "ACCESS_KEY":
            return ok("key ID and secret");
        case "OAUTH":
            return text(data.refreshToken)
                ? ok("authorized")
                : { holds: "not authorized yet", attention: "The app was never authorized, so its connections cannot log in." };
        case "TOKEN":
            return ok("token");
        case "WEBHOOK": {
            const host = hostOf(text(data.url));
            const header = text(data.authHeader) ? ", auth header" : "";
            return ok(host ? `${host}${header}` : `URL${header}`);
        }
    }
}
